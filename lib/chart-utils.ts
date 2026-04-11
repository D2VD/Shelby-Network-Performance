"use client";
/**
 * Shared chart utility — v2.0
 * 1. CROSSHAIR FIX: use mousemove offsetX/layerX directly in SVG coordinate space
 *    instead of converting from DOM clientX (which was causing the offset).
 * 2. DEVICE BADGE FIX: correct classification logic for dev_ vs usr_
 */

// ─── Device ID classification ─────────────────────────────────────────────────
// Backend v6.3+ saves deviceId as "dev_xxxxxxxx" (8 chars of UUID)
// Backend v6.0-6.2 saved ip as "usr_xxxxxx" (6 chars of IP hash)
// When reading results:
//   h.deviceId = "dev_xxxxxxxx"   ← new, always set from v6.3+
//   h.ip = "usr_xxxxxx"           ← always set (IP hash)
// In the table we prefer h.deviceId if available and starts with "dev_"
// If h.deviceId starts with "usr_" or is missing → legacy

export type DeviceKind = "device" | "legacy" | "unknown";

export function getDisplayId(h: { ip?: string; deviceId?: string }): { id: string; kind: DeviceKind } {
  const deviceId = h.deviceId ?? "";
  const ip       = h.ip ?? "";

  // New logic: deviceId starts with "dev_"
  if (deviceId.startsWith("dev_")) {
    return { id: deviceId, kind: "device" };
  }

  // Old logic: deviceId starts with "usr_" (was actually IP hash stored in deviceId field)
  if (deviceId.startsWith("usr_")) {
    return { id: deviceId, kind: "legacy" };
  }

  // deviceId is empty or unknown format — fall back to ip field
  if (ip.startsWith("usr_")) {
    return { id: ip, kind: "legacy" };
  }

  if (ip.startsWith("dev_")) {
    return { id: ip, kind: "device" };
  }

  // Both empty or unknown
  if (deviceId) return { id: deviceId, kind: "unknown" };
  if (ip)       return { id: ip,       kind: "unknown" };
  return { id: "—", kind: "unknown" };
}

/**
 * CROSSHAIR FIX EXPLANATION:
 *
 * Previous approach (WRONG):
 *   const rect = svgRef.current.getBoundingClientRect();
 *   const svgX = (e.clientX - rect.left) / rect.width * VW;
 *   ← Problem: getBoundingClientRect() gives CSS pixels, but SVG rendering
 *     may have fractional pixel scaling + scrolling offsets not captured by clientX alone
 *
 * Correct approach:
 *   Use SVG's own coordinate transform: createSVGPoint() + getScreenCTM().inverse()
 *   This gives exact SVG userspace coordinates regardless of zoom, scaling, or scroll.
 *   
 *   const pt = svgEl.createSVGPoint();
 *   pt.x = e.clientX;
 *   pt.y = e.clientY;
 *   const svgPt = pt.matrixTransform(svgEl.getScreenCTM()!.inverse());
 *   const svgX = svgPt.x;  ← exact SVG coordinate
 *   
 *   Then: dataIdx = clamp(round((svgX - PL) / iW * (n-1)), 0, n-1)
 */

export function clientXToSvgX(
  e: MouseEvent | React.MouseEvent,
  svgEl: SVGSVGElement
): number {
  try {
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) throw new Error("no CTM");
    const svgPt = pt.matrixTransform(ctm.inverse());
    return svgPt.x;
  } catch {
    // Fallback: rect-based (less accurate but won't crash)
    const rect = svgEl.getBoundingClientRect();
    const VW = 600; // must match Chart component's VW
    return ((e.clientX - rect.left) / rect.width) * VW;
  }
}