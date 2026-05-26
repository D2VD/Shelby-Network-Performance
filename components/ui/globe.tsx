"use client";
// components/ui/globe.tsx — v15.0
// Changes:
// 1. Pink continents (#ff77c9) with glow + dark ocean matching Shelby brand video
// 2. Canvas fills 100% of container width AND height (was forced square — globe was cut off)
// 3. Zoom via wheel + exposed GlobeHandle ref (zoomIn / zoomOut / reset)
// 4. Drag: right=right (fixed in v14, preserved)

import {
  useEffect, useRef, useState, useCallback,
  forwardRef, useImperativeHandle,
} from "react";
import { useTheme } from "@/components/theme-context";

export interface GlobeMarker {
  location: [number, number]; // [lat, lng]
  size:     number;
  label?:   string;
  color?:   string;
}

export interface GlobeHandle {
  zoomIn:  () => void;
  zoomOut: () => void;
  reset:   () => void;
}

interface GlobeProps {
  markers?:     GlobeMarker[];
  autoRotate?:  boolean;
  interactive?: boolean;
  className?:   string;
  style?:       React.CSSProperties;
  markerColor?: string;
}

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

let _d3: any = null;
async function getD3() {
  if (_d3) return _d3;
  _d3 = await import("d3-geo" as any);
  return _d3;
}

const MIN_SF = 0.26;
const MAX_SF = 0.72;

const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(
  { markers = [], autoRotate = true, interactive = true, className, style, markerColor = "#ff77c9" },
  ref,
) {
  const { isDark }   = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const rotRef       = useRef<[number, number]>([0, -10]);
  const sfRef        = useRef(0.44); // scale = sfRef * min(W,H)
  const dragRef      = useRef<{ x: number; y: number; rot: [number, number] } | null>(null);
  const assetsRef    = useRef<{ d3: any; world: any } | null>(null);
  const [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    zoomIn:  () => { sfRef.current = Math.min(MAX_SF, sfRef.current + 0.06); },
    zoomOut: () => { sfRef.current = Math.max(MIN_SF, sfRef.current - 0.06); },
    reset:   () => { sfRef.current = 0.44; rotRef.current = [0, -10]; },
  }));

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !assetsRef.current) return;
    const { d3, world } = assetsRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R  = Math.min(W, H) * sfRef.current;

    ctx.clearRect(0, 0, W, H);

    const proj = d3.geoOrthographic()
      .scale(R).translate([cx, cy])
      .rotate(rotRef.current).clipAngle(90);
    const path = d3.geoPath(proj, ctx);

    // ── Ocean: very dark ──
    ctx.beginPath(); path({ type: "Sphere" });
    ctx.fillStyle = isDark ? "#08020e" : "#120418";
    ctx.fill();

    // ── Atmosphere pink glow ──
    const atm = ctx.createRadialGradient(cx, cy, R * 0.88, cx, cy, R * 1.14);
    atm.addColorStop(0,   "rgba(255,119,201,0.22)");
    atm.addColorStop(0.5, "rgba(255,80,180,0.07)");
    atm.addColorStop(1,   "rgba(200,40,160,0)");
    ctx.beginPath(); path({ type: "Sphere" });
    ctx.fillStyle = atm; ctx.fill();

    // ── Grid lines ──
    const grat = d3.geoGraticule().step([20, 20])();
    ctx.beginPath(); path(grat);
    ctx.strokeStyle = "rgba(255,119,201,0.07)";
    ctx.lineWidth   = 0.4; ctx.stroke();

    // ── Land: pink with glow ──
    if (world) {
      // Outer glow pass
      ctx.save();
      ctx.shadowColor = "#ff77c9";
      ctx.shadowBlur  = 22;
      ctx.beginPath(); path(world);
      ctx.fillStyle = "rgba(255,119,201,0.28)"; ctx.fill();
      ctx.restore();

      // Main fill
      ctx.beginPath(); path(world);
      ctx.fillStyle   = "#ff77c9";
      ctx.strokeStyle = "rgba(255,40,155,0.5)";
      ctx.lineWidth   = 0.5;
      ctx.fill(); ctx.stroke();

      // Highlight overlay
      const hl = ctx.createRadialGradient(cx - R * 0.18, cy - R * 0.22, 0, cx, cy, R * 1.1);
      hl.addColorStop(0, "rgba(255,210,235,0.22)");
      hl.addColorStop(1, "rgba(255,60,180,0.04)");
      ctx.beginPath(); path(world);
      ctx.fillStyle = hl; ctx.fill();
    }

    // ── Globe border ──
    ctx.beginPath(); path({ type: "Sphere" });
    ctx.strokeStyle = "rgba(255,119,201,0.40)";
    ctx.lineWidth   = 1.8; ctx.stroke();

    // ── 3D rim light ──
    const rim = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.38, 0, cx, cy, R);
    rim.addColorStop(0,   "rgba(255,190,230,0.18)");
    rim.addColorStop(0.55,"rgba(255,119,201,0)");
    rim.addColorStop(1,   "rgba(0,0,0,0.50)");
    ctx.beginPath(); path({ type: "Sphere" });
    ctx.fillStyle = rim; ctx.fill();

    // ── Markers ──
    const ls = R / 200;
    const chips: { sx: number; sy: number; label: string; color: string }[] = [];
    for (const m of markers) {
      const [lat, lng] = m.location;
      const pt = proj([lng, lat]);
      if (!pt) continue;
      const [sx, sy] = pt;
      const [lam, phi] = rotRef.current.map(d => d * Math.PI / 180);
      const latR = lat * Math.PI / 180, lngR = lng * Math.PI / 180;
      const vis =
        Math.cos(latR) * Math.cos(phi) * Math.cos(lngR - (-lam)) +
        Math.sin(latR) * Math.sin(-phi);
      if (vis < 0.05) continue;

      const col = m.color || markerColor;
      const mR  = R * m.size * 0.6;

      // Glow
      const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, mR * 3.2);
      grd.addColorStop(0, col + "99"); grd.addColorStop(1, col + "00");
      ctx.globalAlpha = 0.45 + vis * 0.55;
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(sx, sy, mR * 3.2, 0, Math.PI * 2); ctx.fill();

      // Core
      ctx.globalAlpha = 0.82 + vis * 0.18;
      ctx.fillStyle = col; ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = Math.max(1, mR * 0.28);
      ctx.beginPath(); ctx.arc(sx, sy, mR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;

      if (m.label && vis > 0.15) chips.push({ sx, sy, label: m.label, color: col });
    }

    for (const { sx, sy, label, color } of chips) {
      const fs = Math.max(9, Math.round(10 * ls));
      ctx.font = `700 ${fs}px 'Roboto Mono', monospace`;
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(label).width;
      const px = 6, py = 3, cw = tw + px * 2, ch = fs + py * 2;
      const bx = sx + Math.max(6, R * 0.05), by = sy - ch - Math.max(3, R * 0.03);
      ctx.fillStyle = color + "e0";
      ctx.beginPath(); ctx.roundRect(bx, by, cw, ch, ch * 0.35); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.strokeStyle = color + "aa"; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(sx, sy - Math.max(2, R * 0.012)); ctx.lineTo(bx + 4, by + ch); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff"; ctx.fillText(label, bx + px, by + ch / 2);
    }
  }, [isDark, markers, markerColor]);

  // Load assets
  useEffect(() => {
    Promise.all([getD3(), getWorld()]).then(([d3, world]) => {
      assetsRef.current = { d3, world }; setReady(true);
    });
  }, []);

  // Animation loop
  useEffect(() => {
    let rafId: number, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      if (autoRotate && !dragRef.current) rotRef.current = [rotRef.current[0] + dt * 10, rotRef.current[1]];
      draw();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [autoRotate, draw]);

  // ResizeObserver — uses BOTH width AND height
  useEffect(() => {
    const container = containerRef.current, canvas = canvasRef.current;
    if (!container || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ro = new ResizeObserver(entries => {
      const { width: w, height: h } = entries[0]?.contentRect ?? { width: 0, height: 0 };
      if (w <= 0 || h <= 0) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Pointer + wheel events
  useEffect(() => {
    if (!interactive) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const onDown = (e: PointerEvent) => {
      dragRef.current = { x: e.clientX, y: e.clientY, rot: [...rotRef.current] as [number, number] };
      canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = (e.clientX - dragRef.current.x) * 0.35;
      const dy = -(e.clientY - dragRef.current.y) * 0.35;
      rotRef.current = [
        dragRef.current.rot[0] + dx,
        Math.max(-80, Math.min(80, dragRef.current.rot[1] + dy)),
      ];
    };
    const onUp = () => { dragRef.current = null; canvas.style.cursor = "grab"; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      sfRef.current = Math.max(MIN_SF, Math.min(MAX_SF, sfRef.current + (e.deltaY > 0 ? -0.04 : 0.04)));
    };
    canvas.addEventListener("pointerdown",  onDown);
    canvas.addEventListener("pointermove",  onMove);
    canvas.addEventListener("pointerup",    onUp);
    canvas.addEventListener("pointerleave", onUp);
    canvas.addEventListener("wheel",        onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown",  onDown);
      canvas.removeEventListener("pointermove",  onMove);
      canvas.removeEventListener("pointerup",    onUp);
      canvas.removeEventListener("pointerleave", onUp);
      canvas.removeEventListener("wheel",        onWheel);
    };
  }, [interactive]);

  return (
    <div ref={containerRef} className={className}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}>
      {!ready && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#08020e" }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid #2a0a1e", borderTopColor: "#ff77c9", animation: "gspin 1s linear infinite" }} />
          <style>{`@keyframes gspin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", cursor: interactive ? "grab" : "default", opacity: ready ? 1 : 0, transition: "opacity 0.6s" }} />
    </div>
  );
});

export default Globe;