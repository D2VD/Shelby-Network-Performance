"use client";
// components/ui/globe.tsx — v16.0
// Changes from v15:
// 1. Square markers (rotated 45° diamonds) instead of circles
// 2. Markers animate: scale proportional to visibility (depth cue = shrink/grow as globe rotates)
// 3. Mobile touch: pointerdown/move/up work on touch devices
// 4. Canvas uses full container width AND height (no square constraint)
// 5. Pink continents, dark ocean, pink glow — unchanged from v15

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

const MIN_SF = 0.26;
const MAX_SF = 0.72;

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

// Draw a square (diamond orientation) at (cx,cy) with half-size s
// The square is axis-aligned but rotated 45° to look like a diamond.
// Scale factor `vis` (0–1) controls size → shrink as marker rotates away.
function drawSquareMarker(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  baseSize: number, vis: number,
  color: string
) {
  // Scale by visibility: 0.3 minimum so it never fully disappears before culling
  const s = baseSize * (0.3 + vis * 0.7);
  if (s < 1) return;

  // Outer glow
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur  = s * 3;
  ctx.globalAlpha = 0.25 + vis * 0.4;
  ctx.fillStyle   = color;
  ctx.beginPath();
  ctx.moveTo(cx,     cy - s * 2.2);
  ctx.lineTo(cx + s * 2.2, cy);
  ctx.lineTo(cx,     cy + s * 2.2);
  ctx.lineTo(cx - s * 2.2, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Core diamond (square rotated 45°)
  ctx.save();
  ctx.globalAlpha = 0.7 + vis * 0.3;
  ctx.fillStyle   = color;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth   = Math.max(1, s * 0.22);
  ctx.beginPath();
  ctx.moveTo(cx,     cy - s);
  ctx.lineTo(cx + s, cy);
  ctx.lineTo(cx,     cy + s);
  ctx.lineTo(cx - s, cy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Highlight — top-left facet
  ctx.globalAlpha = (0.3 + vis * 0.4);
  ctx.fillStyle   = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.moveTo(cx,         cy - s);
  ctx.lineTo(cx + s * 0.5, cy - s * 0.1);
  ctx.lineTo(cx,         cy + s * 0.1);
  ctx.lineTo(cx - s * 0.5, cy - s * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(
  { markers = [], autoRotate = true, interactive = true, className, style, markerColor = "#ff77c9" },
  ref,
) {
  const { isDark }   = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const rotRef       = useRef<[number, number]>([0, -10]);
  const sfRef        = useRef(0.44);
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

    // Ocean
    ctx.beginPath(); path({ type: "Sphere" });
    ctx.fillStyle = isDark ? "#08020e" : "#120418";
    ctx.fill();

    // Pink atmosphere glow
    const atm = ctx.createRadialGradient(cx, cy, R * 0.88, cx, cy, R * 1.14);
    atm.addColorStop(0,   "rgba(255,119,201,0.22)");
    atm.addColorStop(0.5, "rgba(255,80,180,0.07)");
    atm.addColorStop(1,   "rgba(200,40,160,0)");
    ctx.beginPath(); path({ type: "Sphere" });
    ctx.fillStyle = atm; ctx.fill();

    // Grid
    const grat = d3.geoGraticule().step([20, 20])();
    ctx.beginPath(); path(grat);
    ctx.strokeStyle = "rgba(255,119,201,0.06)";
    ctx.lineWidth = 0.4; ctx.stroke();

    // Land glow
    if (world) {
      ctx.save();
      ctx.shadowColor = "#ff77c9"; ctx.shadowBlur = 20;
      ctx.beginPath(); path(world);
      ctx.fillStyle = "rgba(255,119,201,0.25)"; ctx.fill();
      ctx.restore();
      // Main fill
      ctx.beginPath(); path(world);
      ctx.fillStyle   = "#ff77c9";
      ctx.strokeStyle = "rgba(255,40,155,0.45)";
      ctx.lineWidth   = 0.5;
      ctx.fill(); ctx.stroke();
      // Highlight
      const hl = ctx.createRadialGradient(cx - R*0.18, cy - R*0.22, 0, cx, cy, R*1.1);
      hl.addColorStop(0, "rgba(255,210,235,0.20)");
      hl.addColorStop(1, "rgba(255,60,180,0.03)");
      ctx.beginPath(); path(world);
      ctx.fillStyle = hl; ctx.fill();
    }

    // Globe border
    ctx.beginPath(); path({ type: "Sphere" });
    ctx.strokeStyle = "rgba(255,119,201,0.38)";
    ctx.lineWidth = 1.8; ctx.stroke();

    // 3D rim light
    const rim = ctx.createRadialGradient(cx - R*0.38, cy - R*0.38, 0, cx, cy, R);
    rim.addColorStop(0,    "rgba(255,190,230,0.16)");
    rim.addColorStop(0.55, "rgba(255,119,201,0)");
    rim.addColorStop(1,    "rgba(0,0,0,0.48)");
    ctx.beginPath(); path({ type: "Sphere" });
    ctx.fillStyle = rim; ctx.fill();

    // ── Square markers with depth-scaled animation ──
    const [lam, phi] = rotRef.current.map(d => d * Math.PI / 180);
    const chips: { sx: number; sy: number; label: string; color: string; vis: number }[] = [];

    for (const m of markers) {
      const [lat, lng] = m.location;
      const pt = proj([lng, lat]);
      if (!pt) continue;
      const [sx, sy] = pt;

      // Visibility (dot product with view center normal)
      const latR = lat * Math.PI / 180, lngR = lng * Math.PI / 180;
      const vis =
        Math.cos(latR) * Math.cos(phi) * Math.cos(lngR - (-lam)) +
        Math.sin(latR) * Math.sin(-phi);
      if (vis < 0.04) continue;

      const col      = m.color || markerColor;
      const baseSize = R * m.size * 0.55;

      drawSquareMarker(ctx, sx, sy, baseSize, vis, col);

      if (m.label && vis > 0.18) chips.push({ sx, sy, label: m.label, color: col, vis });
    }

    // Labels (drawn on top)
    const ls = R / 200;
    for (const { sx, sy, label, color, vis } of chips) {
      const fs = Math.max(9, Math.round(10 * ls));
      ctx.font = `700 ${fs}px 'Roboto Mono', monospace`;
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(label).width;
      const px = 6, py = 3, cw = tw + px*2, ch = fs + py*2;
      const bx = sx + Math.max(6, R*0.05), by = sy - ch - Math.max(3, R*0.03);
      ctx.globalAlpha = 0.4 + vis * 0.6;
      ctx.fillStyle = color + "e0";
      ctx.beginPath(); ctx.roundRect(bx, by, cw, ch, ch*0.35); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.strokeStyle = color + "88"; ctx.lineWidth = 1;
      ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(sx, sy - Math.max(2, R*0.01)); ctx.lineTo(bx+4, by+ch); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff"; ctx.fillText(label, bx+px, by+ch/2);
      ctx.globalAlpha = 1;
    }
  }, [isDark, markers, markerColor]);

  useEffect(() => {
    Promise.all([getD3(), getWorld()]).then(([d3, world]) => {
      assetsRef.current = { d3, world }; setReady(true);
    });
  }, []);

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

  // ResizeObserver — uses both W and H
  useEffect(() => {
    const container = containerRef.current, canvas = canvasRef.current;
    if (!container || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ro = new ResizeObserver(entries => {
      const { width: w, height: h } = entries[0]?.contentRect ?? {};
      if (!w || !h) return;
      canvas.width  = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Pointer events (works on touch via pointer events API)
  useEffect(() => {
    if (!interactive) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      dragRef.current = { x: e.clientX, y: e.clientY, rot: [...rotRef.current] as [number, number] };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx =  (e.clientX - dragRef.current.x) * 0.35;
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
    // Use pointer events (handles both mouse and touch)
    canvas.addEventListener("pointerdown",  onDown, { passive: false });
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
      style={{ position:"relative", width:"100%", height:"100%", overflow:"hidden", touchAction:"none", ...style }}>
      {!ready && (
        <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"#08020e" }}>
          <div style={{ width:36, height:36, borderRadius:"50%", border:"2px solid #2a0a1e", borderTopColor:"#ff77c9", animation:"gspin 1s linear infinite" }}/>
          <style>{`@keyframes gspin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      <canvas ref={canvasRef}
        style={{ display:"block", width:"100%", height:"100%", cursor:interactive?"grab":"default",
                 opacity:ready?1:0, transition:"opacity 0.6s",
                 touchAction:"none" }}
      />
    </div>
  );
});

export default Globe;