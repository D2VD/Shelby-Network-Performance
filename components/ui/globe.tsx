"use client";
// components/ui/globe.tsx — v14.0
//
// CHANGES vs v13.0:
//  1. Square diamond markers (rotated rect) instead of circles
//  2. Starfield dots rendered in dark mode background layer
//  3. Hoàng Sa / Trường Sa sovereignty markers (gold diamonds + label)
//  4. Hover tooltip shows marker label on mouse proximity
//  5. Full XY drag preserved from v13

import { useEffect, useRef, useState, useCallback } from "react";
import { useTheme }                                  from "@/components/theme-context";

export interface GlobeMarker {
  location: [number, number]; // [lat, lng]
  size:     number;
  label?:   string;
  color?:   string;
}

interface GlobeProps {
  markers?:     GlobeMarker[];
  autoRotate?:  boolean;
  interactive?: boolean;
  className?:   string;
  style?:       React.CSSProperties;
  markerColor?: string;
}

// ── World topology cache ──────────────────────────────────────────────────────
let _worldCache: unknown = null;
let _worldFetch: Promise<unknown> | null = null;

async function getWorld(): Promise<unknown> {
  if (_worldCache) return _worldCache;
  if (_worldFetch) return _worldFetch;
  _worldFetch = (async () => {
    try {
      const res  = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
      const topo = await res.json() as Record<string, unknown>;
      const { feature } = await import("topojson-client" as any);
      _worldCache = feature(topo, (topo as any).objects.land);
      return _worldCache;
    } catch { return null; }
  })();
  return _worldFetch;
}

// ── d3-geo lazy load ──────────────────────────────────────────────────────────
let _d3: unknown = null;
async function getD3(): Promise<unknown> {
  if (_d3) return _d3;
  _d3 = await import("d3-geo" as any);
  return _d3;
}

// ── Sovereignty markers (always rendered) ────────────────────────────────────
const SOVEREIGNTY_MARKERS: GlobeMarker[] = [
  { location: [16.5,  112.0 ], size: 0.06, label: "🇻🇳 Hoàng Sa", color: "#fbbf24" },
  { location: [10.0,  114.17], size: 0.06, label: "🇻🇳 Trường Sa", color: "#fbbf24" },
];

// ── Draw square diamond ───────────────────────────────────────────────────────
function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  halfSize: number,
  fillColor: string,
  strokeColor: string,
  strokeWidth = 1.5
) {
  ctx.beginPath();
  ctx.moveTo(cx,               cy - halfSize); // top
  ctx.lineTo(cx + halfSize,    cy);            // right
  ctx.lineTo(cx,               cy + halfSize); // bottom
  ctx.lineTo(cx - halfSize,    cy);            // left
  ctx.closePath();
  ctx.fillStyle   = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth   = strokeWidth;
  ctx.stroke();
}

// ── Starfield (pre-generate random star positions once) ───────────────────────
const STAR_COUNT = 180;
const STARS = Array.from({ length: STAR_COUNT }, () => ({
  x:    Math.random(),
  y:    Math.random(),
  r:    0.4 + Math.random() * 1.0,
  a:    0.25 + Math.random() * 0.55,
}));

export default function Globe({
  markers       = [],
  autoRotate    = true,
  interactive   = true,
  className,
  style,
  markerColor   = "#ff77c9",
}: GlobeProps) {
  const { isDark }   = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);

  const rotRef    = useRef<[number, number]>([0, -10]);
  const dragStart = useRef<{ x: number; y: number; rot: [number, number] } | null>(null);
  const assetsRef = useRef<{ d3: unknown; world: unknown } | null>(null);

  const [ready,    setReady]    = useState(false);
  const [hoverLbl, setHoverLbl] = useState<string | null>(null);

  // ── Draw one frame ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !assetsRef.current) return;
    const { d3, world } = assetsRef.current as any;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W  = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R  = Math.min(W, H) * 0.44;

    ctx.clearRect(0, 0, W, H);

    const proj = d3.geoOrthographic()
      .scale(R).translate([cx, cy])
      .rotate(rotRef.current).clipAngle(90);
    const path = d3.geoPath(proj, ctx);

    // ── Starfield (dark mode only) ──────────────────────────────────────────
    if (isDark) {
      for (const star of STARS) {
        ctx.beginPath();
        ctx.arc(star.x * W, star.y * H, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${star.a})`;
        ctx.fill();
      }
    }

    // ── Ocean ───────────────────────────────────────────────────────────────
    ctx.beginPath();
    path({ type: "Sphere" });
    ctx.fillStyle = isDark ? "#151010" : "#f2f2f4";
    ctx.fill();

    // ── Atmosphere ──────────────────────────────────────────────────────────
    const atm = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.10);
    atm.addColorStop(0, isDark ? "rgba(255,119,201,0.06)" : "rgba(180,180,200,0.35)");
    atm.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath(); path({ type: "Sphere" });
    ctx.fillStyle = atm; ctx.fill();

    // ── Graticule ────────────────────────────────────────────────────────────
    const grat = d3.geoGraticule().step([20, 20])();
    ctx.beginPath(); path(grat);
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)";
    ctx.lineWidth   = 0.5; ctx.stroke();

    // ── Land ─────────────────────────────────────────────────────────────────
    if (world) {
      ctx.beginPath(); path(world as any);
      ctx.fillStyle   = isDark ? "rgba(255,255,255,0.11)" : "rgba(40,30,20,0.14)";
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(40,30,20,0.07)";
      ctx.lineWidth   = 0.4; ctx.fill(); ctx.stroke();
    }

    // ── Globe border ─────────────────────────────────────────────────────────
    ctx.beginPath(); path({ type: "Sphere" });
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)";
    ctx.lineWidth   = 1.5; ctx.stroke();

    // ── All markers (user + sovereignty) ────────────────────────────────────
    const allMarkers = [...markers, ...SOVEREIGNTY_MARKERS];
    const labelScale = R / 200;
    const labels: { sx: number; sy: number; label: string; color: string }[] = [];

    for (const m of allMarkers) {
      const [lat, lng] = m.location;
      const pt = proj([lng, lat]);
      if (!pt) continue;
      const [sx, sy] = pt;

      // Visibility
      const [lam, phi] = rotRef.current.map(d => d * Math.PI / 180);
      const latR = lat * Math.PI / 180, lngR = lng * Math.PI / 180;
      const vis  =
        Math.cos(latR) * Math.cos(phi) * Math.cos(lngR - (-lam)) +
        Math.sin(latR) * Math.sin(-phi);
      if (vis < 0.05) continue;

      const col      = m.color || markerColor;
      const halfSize = R * m.size * 0.7;
      const alpha    = 0.4 + vis * 0.6;

      // Glow
      const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, halfSize * 3.5);
      grd.addColorStop(0, col + "55");
      grd.addColorStop(1, col + "00");
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle   = grd;
      ctx.beginPath();
      ctx.arc(sx, sy, halfSize * 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Diamond marker
      ctx.globalAlpha = 0.7 + vis * 0.3;
      drawDiamond(
        ctx, sx, sy, halfSize,
        col,
        isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.15)",
        Math.max(1, halfSize * 0.25)
      );
      ctx.globalAlpha = 1;

      if (m.label && vis > 0.15) labels.push({ sx, sy, label: m.label, color: col });
    }

    // ── Label chips ───────────────────────────────────────────────────────────
    for (const { sx, sy, label, color } of labels) {
      const fs  = Math.max(9, Math.round(10 * labelScale));
      ctx.font  = `700 ${fs}px 'Roboto Mono', monospace`;
      ctx.textBaseline = "middle";
      const tw  = ctx.measureText(label).width;
      const px  = 7, py = 3;
      const cw  = tw + px * 2, ch = fs + py * 2;
      const lx  = sx + Math.max(7, R * 0.055);
      const ly  = sy - ch - Math.max(4, R * 0.04);

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(lx, ly, cw, ch, ch * 0.35);
      ctx.fill();

      ctx.strokeStyle = isDark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.15)";
      ctx.lineWidth   = 0.5; ctx.stroke();

      // Connector
      ctx.strokeStyle = color + "cc"; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx, sy - Math.max(2, R * 0.015));
      ctx.lineTo(lx + 4, ly + ch);
      ctx.stroke(); ctx.setLineDash([]);

      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, lx + px, ly + ch / 2);
    }
  }, [isDark, markers, markerColor]);

  // ── Load assets ───────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([getD3(), getWorld()]).then(([d3, world]) => {
      assetsRef.current = { d3, world };
      setReady(true);
    });
  }, []);

  // ── Animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    let rafId: number;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (autoRotate && !dragStart.current) {
        rotRef.current = [rotRef.current[0] - dt * 12, rotRef.current[1]];
      }
      draw();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [autoRotate, draw]);

  // ── ResizeObserver ────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w <= 0) return;
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(w * dpr);
      canvas.style.width  = `${w}px`;
      canvas.style.height = `${w}px`;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Pointer events ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!interactive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (e: PointerEvent) => {
      dragStart.current = { x: e.clientX, y: e.clientY, rot: [...rotRef.current] as [number, number] };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!dragStart.current) return;
      const dx =  (e.clientX - dragStart.current.x) * 0.35;
      const dy = -(e.clientY - dragStart.current.y) * 0.35;
      rotRef.current = [
        dragStart.current.rot[0] - dx,
        Math.max(-80, Math.min(80, dragStart.current.rot[1] + dy)),
      ];
    };
    const onUp = () => { dragStart.current = null; canvas.style.cursor = "grab"; };

    canvas.addEventListener("pointerdown",  onDown);
    canvas.addEventListener("pointermove",  onMove);
    canvas.addEventListener("pointerup",    onUp);
    canvas.addEventListener("pointerleave", onUp);
    return () => {
      canvas.removeEventListener("pointerdown",  onDown);
      canvas.removeEventListener("pointermove",  onMove);
      canvas.removeEventListener("pointerup",    onUp);
      canvas.removeEventListener("pointerleave", onUp);
    };
  }, [interactive]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", ...style }}
    >
      {!ready && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--shelby-pink, #ff77c9)", animation: "gspin 1s linear infinite" }} />
          <style>{`@keyframes gspin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{ display: "block", cursor: interactive ? "grab" : "default", opacity: ready ? 1 : 0, transition: "opacity 0.5s" }}
      />
      {/* Sovereignty footer badge */}
      {ready && (
        <div style={{ position: "absolute", bottom: 4, right: 6, fontSize: 8, fontFamily: "monospace", color: isDark ? "rgba(251,191,36,0.7)" : "rgba(161,120,0,0.7)", pointerEvents: "none" }}>
          🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
        </div>
      )}
    </div>
  );
}