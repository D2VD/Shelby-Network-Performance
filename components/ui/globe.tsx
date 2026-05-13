"use client";
// components/ui/globe.tsx — v13.0
// Fixes:
//  - Full XY drag (latitude + longitude rotation)
//  - Correct drag direction: drag right → globe rotates right
//  - No hardcoded/default SP markers — callers always pass real data
//  - d3-geo orthographic with land polygons (no cobe/WebGL)

import { useEffect, useRef, useState, useCallback } from "react";
import { useSpring, animated }                       from "@react-spring/web";
import { useTheme }                                  from "@/components/theme-context";

export interface GlobeMarker {
  location: [number, number]; // [lat, lng]
  size:     number;
  label?:   string;
  color?:   string; // CSS hex e.g. "#ff77c9"
}

interface GlobeProps {
  markers?:     GlobeMarker[];
  autoRotate?:  boolean;
  interactive?: boolean;
  className?:   string;
  style?:       React.CSSProperties;
  markerColor?: string; // default marker color as CSS hex
}

// ── World topology (fetched once, cached in module scope) ──────────
let _worldCache: any = null;
let _worldFetch: Promise<any> | null = null;

async function getWorld() {
  if (_worldCache) return _worldCache;
  if (_worldFetch) return _worldFetch;
  _worldFetch = (async () => {
    try {
      const res  = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
      const topo = await res.json();
      const { feature } = await import("topojson-client" as any);
      _worldCache = feature(topo, topo.objects.land);
      return _worldCache;
    } catch { return null; }
  })();
  return _worldFetch;
}

// ── d3-geo (lazy) ─────────────────────────────────────────────────
let _d3: any = null;
async function getD3() {
  if (_d3) return _d3;
  _d3 = await import("d3-geo" as any);
  return _d3;
}

export default function Globe({
  markers      = [],
  autoRotate   = true,
  interactive  = true,
  className,
  style,
  markerColor  = "#ff77c9",
}: GlobeProps) {
  const { isDark }   = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);

  // Rotation state: [lambda (lng), phi (lat)] in degrees
  const rotRef    = useRef<[number, number]>([0, -10]);
  const dragStart = useRef<{ x: number; y: number; rot: [number, number] } | null>(null);
  const assetsRef = useRef<{ d3: any; world: any } | null>(null);

  const [ready, setReady] = useState(false);
  const spring = useSpring({ opacity: ready ? 1 : 0, config: { tension: 55, friction: 18 } });

  // ── Draw one frame ───────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !assetsRef.current) return;
    const { d3, world } = assetsRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W  = canvas.width;
    const H  = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const R  = Math.min(W, H) * 0.44;

    ctx.clearRect(0, 0, W, H);

    const proj = d3.geoOrthographic()
      .scale(R)
      .translate([cx, cy])
      .rotate(rotRef.current)
      .clipAngle(90);

    const path = d3.geoPath(proj, ctx);

    // Ocean
    ctx.beginPath();
    path({ type: "Sphere" });
    ctx.fillStyle = isDark ? "#151010" : "#f2f2f4";
    ctx.fill();

    // Atmosphere glow
    const atm = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.10);
    atm.addColorStop(0, isDark ? "rgba(255,119,201,0.06)" : "rgba(180,180,200,0.35)");
    atm.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    path({ type: "Sphere" });
    ctx.fillStyle = atm;
    ctx.fill();

    // Graticule
    const grat = d3.geoGraticule().step([20, 20])();
    ctx.beginPath();
    path(grat);
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)";
    ctx.lineWidth   = 0.5;
    ctx.stroke();

    // Land
    if (world) {
      ctx.beginPath();
      path(world);
      ctx.fillStyle   = isDark ? "rgba(255,255,255,0.11)" : "rgba(40,30,20,0.14)";
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(40,30,20,0.07)";
      ctx.lineWidth   = 0.4;
      ctx.fill();
      ctx.stroke();
    }

    // Globe border
    ctx.beginPath();
    path({ type: "Sphere" });
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)";
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Markers + chips
    const labelScale = R / 200; // scale fonts with globe size
    const chips: { sx: number; sy: number; label: string; color: string }[] = [];

    for (const m of markers) {
      const [lat, lng] = m.location;
      const pt = proj([lng, lat]);
      if (!pt) continue;

      // Visibility check — dot product with view center
      const [sx, sy] = pt;
      const [lam, phi] = rotRef.current.map(d => d * Math.PI / 180);
      const latR = lat * Math.PI / 180;
      const lngR = lng * Math.PI / 180;
      const vis  =
        Math.cos(latR) * Math.cos(phi) * Math.cos(lngR - (-lam)) +
        Math.sin(latR) * Math.sin(-phi);
      if (vis < 0.05) continue;

      const col = m.color || markerColor;
      const mR  = R * m.size * 0.6;
      const alpha = 0.4 + vis * 0.6;

      // Glow
      const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, mR * 3);
      grd.addColorStop(0, col + "66");
      grd.addColorStop(1, col + "00");
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = grd;
      ctx.beginPath();
      ctx.arc(sx, sy, mR * 3, 0, Math.PI * 2);
      ctx.fill();

      // Core
      ctx.globalAlpha = 0.7 + vis * 0.3;
      ctx.fillStyle   = col;
      ctx.strokeStyle = isDark ? "#151010" : "#ffffff";
      ctx.lineWidth   = Math.max(1.5, mR * 0.35);
      ctx.beginPath();
      ctx.arc(sx, sy, mR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (m.label && vis > 0.15) chips.push({ sx, sy, label: m.label, color: col });
    }

    // Label chips on top of dots
    for (const { sx, sy, label, color } of chips) {
      const fs  = Math.max(10, Math.round(11 * labelScale));
      ctx.font  = `700 ${fs}px 'Roboto Mono', monospace`;
      ctx.textBaseline = "middle";
      const tw  = ctx.measureText(label).width;
      const px  = 8, py = 4;
      const cw  = tw + px * 2;
      const ch  = fs + py * 2;
      const cx2 = sx + Math.max(8, R * 0.06);
      const cy2 = sy - ch - Math.max(4, R * 0.04);

      ctx.fillStyle   = color;
      ctx.beginPath();
      ctx.roundRect(cx2, cy2, cw, ch, ch * 0.35);
      ctx.fill();

      ctx.strokeStyle = isDark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.15)";
      ctx.lineWidth   = 0.5;
      ctx.stroke();

      // Connector
      ctx.strokeStyle = color + "cc";
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx, sy - Math.max(2, R * 0.015));
      ctx.lineTo(cx2 + 4, cy2 + ch);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, cx2 + px, cy2 + ch / 2);
    }
  }, [isDark, markers, markerColor]);

  // ── Load assets once ─────────────────────────────────────────────
  useEffect(() => {
    Promise.all([getD3(), getWorld()]).then(([d3, world]) => {
      assetsRef.current = { d3, world };
      setReady(true);
    });
  }, []);

  // ── Animation loop ────────────────────────────────────────────────
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

  // ── ResizeObserver ─────────────────────────────────────────────────
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

  // ── Pointer events — full XY drag ─────────────────────────────────
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
      const dx =  (e.clientX - dragStart.current.x) * 0.35; // drag right = rotate right
      const dy = -(e.clientY - dragStart.current.y) * 0.35; // drag up = rotate up
      rotRef.current = [
        dragStart.current.rot[0] - dx, // correct: subtract so drag right = positive λ
        Math.max(-80, Math.min(80, dragStart.current.rot[1] + dy)),
      ];
    };

    const onUp = () => {
      dragStart.current = null;
      canvas.style.cursor = "grab";
    };

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
    <div ref={containerRef} className={className} style={{ position: "relative", ...style }}>
      {!ready && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--shelby-pink, #ff77c9)", animation: "gspin 1s linear infinite" }} />
          <style>{`@keyframes gspin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      <animated.canvas
        ref={canvasRef}
        style={{ display: "block", cursor: interactive ? "grab" : "default", opacity: spring.opacity }}
      />
    </div>
  );
}