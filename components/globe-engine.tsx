"use client";
// components/globe-engine.tsx — v3.0 (Phase 4)
// ═══════════════════════════════════════════════════════════════
// Dot-matrix Globe + Arc FX System
//
// Layer stack (bottom → top):
//   0. Pitch-black space + star field
//   1. Globe sphere (radial gradient + rim glow)
//   2. Grid lines (lat/lon, neon dim)
//   3. Dot-matrix continents (edge-fade opacity)
//   4. GHOSTING TRAIL arcs  ← NEW Phase 4
//   5. SYNC arcs (Nodes↔Hubs, thick, slow, cyan/purple)
//   6. TX sparks (User→Node, thin, fast, random)
//   7. SP node glow (double-render)
//   8. Sovereignty layer (gold, always on top)
//   9. Scanline overlay (CSS)
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import type { StorageProvider } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────────────
interface GlobeEngineProps {
  providers: StorageProvider[];
  network: "shelbynet" | "testnet";
  accentColor: string;
  onProviderClick?: (provider: StorageProvider) => void;
}

interface GlobeDots {
  type: string;
  count: number;
  points: [number, number][];
}

/** Một arc đang bay trên globe */
interface Arc {
  id:         number;
  srcLon:     number;
  srcLat:     number;
  dstLon:     number;
  dstLat:     number;
  /** 0→1 tiến trình di chuyển */
  progress:   number;
  /** px/frame */
  speed:      number;
  /** neon màu dòng: "sync" | "tx" */
  kind:       "sync" | "tx";
  /** opacity khi sinh ra */
  alpha:      number;
  /** độ dày */
  width:      number;
  /** trail: mảng các điểm lịch sử [screenX, screenY, opacity] */
  trail:      Array<[number, number, number]>;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const SOVEREIGNTY_POINTS = [
  { id: "hoangsa",  label: "Hoàng Sa (VN)",  coords: [112.0,  16.5] as [number, number] },
  { id: "truongsa", label: "Trường Sa (VN)", coords: [114.17, 10.0] as [number, number] },
];

// Hub coordinates — global internet exchange points (nơi arc "sync" xuất phát)
const HUBS: [number, number][] = [
  [2.35,   48.85],   // Paris
  [-74.0,  40.71],   // New York
  [139.69, 35.69],   // Tokyo
  [103.82,  1.35],   // Singapore
  [151.21, -33.87],  // Sydney
  [-122.33, 37.78],  // San Francisco
  [8.68,   50.11],   // Frankfurt
  [28.95,  41.01],   // Istanbul
];

const TRAIL_MAX_LEN = 28;  // điểm lịch sử tối đa cho ghosting effect
const MAX_SYNC_ARCS = 8;
const MAX_TX_ARCS   = 20;

let _arcId = 0;

// ── Projection ─────────────────────────────────────────────────────────────────
function lonLatToCanvas(
  lon: number, lat: number,
  viewLon: number, viewLat: number,
  zoom: number, W: number, H: number
): [number, number] | null {
  const dLon     = ((lon - viewLon) * Math.PI) / 180;
  const latR     = (lat  * Math.PI) / 180;
  const viewLatR = (viewLat * Math.PI) / 180;
  const cosC = Math.sin(viewLatR) * Math.sin(latR) +
               Math.cos(viewLatR) * Math.cos(latR) * Math.cos(dLon);
  if (cosC < 0.02) return null;
  const scale = (W * zoom) / (2 * Math.PI);
  return [
    W / 2 + scale * dLon * Math.cos(latR),
    H / 2 - scale * (latR - viewLatR),
  ];
}

/** Interpolate geodesic point between two lon/lat at fraction t */
function geodesicPoint(
  lon0: number, lat0: number,
  lon1: number, lat1: number,
  t: number
): [number, number] {
  // Simple slerp on sphere
  const toRad = Math.PI / 180;
  const φ0 = lat0 * toRad, λ0 = lon0 * toRad;
  const φ1 = lat1 * toRad, λ1 = lon1 * toRad;
  const x0 = Math.cos(φ0) * Math.cos(λ0), y0 = Math.cos(φ0) * Math.sin(λ0), z0 = Math.sin(φ0);
  const x1 = Math.cos(φ1) * Math.cos(λ1), y1 = Math.cos(φ1) * Math.sin(λ1), z1 = Math.sin(φ1);
  const dot = Math.min(1, x0*x1 + y0*y1 + z0*z1);
  const Ω   = Math.acos(dot);
  let xi, yi, zi;
  if (Ω < 0.001) {
    xi = x0 + t * (x1 - x0);
    yi = y0 + t * (y1 - y0);
    zi = z0 + t * (z1 - z0);
  } else {
    const s = Math.sin(Ω);
    const a = Math.sin((1 - t) * Ω) / s;
    const b = Math.sin(t * Ω) / s;
    xi = a*x0 + b*x1; yi = a*y0 + b*y1; zi = a*z0 + b*z1;
  }
  const lat = Math.atan2(zi, Math.sqrt(xi*xi + yi*yi)) / toRad;
  const lon = Math.atan2(yi, xi) / toRad;
  return [lon, lat];
}

// ── Hex → RGB ──────────────────────────────────────────────────────────────────
function hexToRGB(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function GlobeEngine({
  providers, network, accentColor, onProviderClick,
}: GlobeEngineProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const animRef    = useRef<number>(0);
  const isDragging = useRef(false);
  const lastMouse  = useRef<{ x: number; y: number } | null>(null);

  // Globe state
  const [dots,      setDots]      = useState<[number, number][]>([]);
  const [viewState, setViewState] = useState({ lon: 110, lat: 15, zoom: 1.0, autoRotate: true });

  // Interaction state
  const [hoveredSP,  setHoveredSP]  = useState<StorageProvider | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Arc system state — mutable ref để tránh re-render loop
  const arcsRef     = useRef<Arc[]>([]);
  const frameRef    = useRef(0);     // frame counter cho spawn timing
  const viewRef     = useRef(viewState);

  // Sync viewRef với viewState (để draw callback đọc được mới nhất)
  useEffect(() => { viewRef.current = viewState; }, [viewState]);

  // Parse accent color
  const rgb = useMemo(() => hexToRGB(accentColor), [accentColor]);

  // ── Load globe dots ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/geo/globe-dots.json")
      .then(r => r.json())
      .then((d: GlobeDots) => setDots(d.points))
      .catch(() => {
        const fb: [number, number][] = [];
        for (let lon = -170; lon < 180; lon += 8)
          for (let lat = -80; lat < 80; lat += 8)
            fb.push([lon + (Math.random()-.5)*6, lat + (Math.random()-.5)*6]);
        setDots(fb);
      });
  }, []);

  // ── Resize observer ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        canvas.width  = width  * window.devicePixelRatio;
        canvas.height = height * window.devicePixelRatio;
      }
    });
    obs.observe(canvas.parentElement!);
    return () => obs.disconnect();
  }, []);

  // ── Arc spawner ──────────────────────────────────────────────────────────────
  const spawnArcs = useCallback(() => {
    if (!providers.length) return;
    const arcs = arcsRef.current;

    // Spawn SYNC arc: Hub → random SP (thick, slow, trail 5-10s @ 30fps = 150-300 frames)
    const syncCount = arcs.filter(a => a.kind === "sync").length;
    if (syncCount < MAX_SYNC_ARCS) {
      const hub = HUBS[Math.floor(Math.random() * HUBS.length)];
      const sp  = providers[Math.floor(Math.random() * providers.length)];
      if (sp.coordinates) {
        arcs.push({
          id:       _arcId++,
          srcLon:   hub[0], srcLat: hub[1],
          dstLon:   sp.coordinates[0], dstLat: sp.coordinates[1],
          progress: 0,
          speed:    0.003 + Math.random() * 0.002,   // slow
          kind:     "sync",
          alpha:    0.7 + Math.random() * 0.3,
          width:    1.8 + Math.random() * 0.8,
          trail:    [],
        });
      }
    }

    // Spawn TX arc: random SP → another random SP (thin, fast)
    const txCount = arcs.filter(a => a.kind === "tx").length;
    if (txCount < MAX_TX_ARCS && providers.length >= 2) {
      const idxA = Math.floor(Math.random() * providers.length);
      let   idxB = Math.floor(Math.random() * providers.length);
      if (idxB === idxA) idxB = (idxA + 1) % providers.length;
      const spA = providers[idxA], spB = providers[idxB];
      if (spA.coordinates && spB.coordinates) {
        arcs.push({
          id:       _arcId++,
          srcLon:   spA.coordinates[0], srcLat: spA.coordinates[1],
          dstLon:   spB.coordinates[0], dstLat: spB.coordinates[1],
          progress: 0,
          speed:    0.012 + Math.random() * 0.018,  // fast
          kind:     "tx",
          alpha:    0.4 + Math.random() * 0.4,
          width:    0.7 + Math.random() * 0.5,
          trail:    [],
        });
      }
    }

    // Prune dead arcs
    arcsRef.current = arcs.filter(a => a.progress < 1.05);
  }, [providers]);

  // ── Main render + animation loop ─────────────────────────────────────────────
  useEffect(() => {
    const dotsSnap = dots; // capture stable ref

    const loop = (time: number) => {
      animRef.current = requestAnimationFrame(loop);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr  = window.devicePixelRatio;
      const W    = canvas.width  / dpr;
      const H    = canvas.height / dpr;
      const { lon: viewLon, lat: viewLat, zoom } = viewRef.current;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      const radius = Math.min(W, H) * 0.42 * zoom;
      const cx = W / 2, cy = H / 2;

      // ── 0. Star field ──────────────────────────────────────────────────────
      // Static stars (seeded by position, cheap)
      ctx.save();
      for (let i = 0; i < 180; i++) {
        const sx = ((i * 137.508 + 41) % W);
        const sy = ((i * 97.313  + 17) % H);
        // Skip inside globe
        const ddx = sx - cx, ddy = sy - cy;
        if (ddx*ddx + ddy*ddy < radius*radius*1.15) continue;
        const r = (i % 3 === 0) ? 1.2 : 0.7;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180,210,255,${0.1 + (i % 5) * 0.05})`;
        ctx.fill();
      }
      ctx.restore();

      // ── 1. Globe sphere ──────────────────────────────────────────────────
      const sg = ctx.createRadialGradient(cx - radius*0.2, cy - radius*0.2, 0, cx, cy, radius);
      sg.addColorStop(0, "#0e1825");
      sg.addColorStop(0.6, "#070c12");
      sg.addColorStop(1, "#020507");
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2);
      ctx.fillStyle = sg; ctx.fill();

      // Rim glow
      const rimG = ctx.createRadialGradient(cx, cy, radius*0.88, cx, cy, radius*1.1);
      rimG.addColorStop(0,   `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      rimG.addColorStop(0.7, `rgba(${rgb.r},${rgb.g},${rgb.b},0.07)`);
      rimG.addColorStop(1,   `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      ctx.beginPath(); ctx.arc(cx, cy, radius*1.1, 0, Math.PI*2);
      ctx.fillStyle = rimG; ctx.fill();

      // ── 2. Grid lines ────────────────────────────────────────────────────
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2); ctx.clip();
      ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.04)`;
      ctx.lineWidth = 0.5;
      for (let la = -60; la <= 60; la += 30) {
        const pts: [number,number][] = [];
        for (let lo = -180; lo <= 180; lo += 2) {
          const p = lonLatToCanvas(lo, la, viewLon, viewLat, zoom, W, H);
          if (p) pts.push(p);
        }
        if (pts.length > 2) {
          ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
          pts.slice(1).forEach(p => ctx.lineTo(p[0], p[1]));
          ctx.stroke();
        }
      }
      for (let lo = -180; lo < 180; lo += 30) {
        const pts: [number,number][] = [];
        for (let la = -85; la <= 85; la += 3) {
          const p = lonLatToCanvas(lo, la, viewLon, viewLat, zoom, W, H);
          if (p) pts.push(p);
        }
        if (pts.length > 2) {
          ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
          pts.slice(1).forEach(p => ctx.lineTo(p[0], p[1]));
          ctx.stroke();
        }
      }
      ctx.restore();

      // ── 3. Dot-matrix continents ──────────────────────────────────────────
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2); ctx.clip();
      for (const [dLon, dLat] of dotsSnap) {
        const pt = lonLatToCanvas(dLon, dLat, viewLon, viewLat, zoom, W, H);
        if (!pt) continue;
        const dx = pt[0] - cx, dy = pt[1] - cy;
        const edgeFade = Math.pow(1 - Math.max(0, Math.sqrt(dx*dx+dy*dy)/radius - 0.5)*2, 2);
        ctx.beginPath(); ctx.arc(pt[0], pt[1], 1.2, 0, Math.PI*2);
        ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${(0.5*edgeFade).toFixed(3)})`;
        ctx.fill();
      }
      ctx.restore();

      // ── 4+5+6. Arc system — GHOSTING TRAIL + SYNC + TX ────────────────────
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, radius*1.02, 0, Math.PI*2); ctx.clip();

      // Advance + draw each arc
      const arcs = arcsRef.current;
      for (const arc of arcs) {
        // Advance progress
        arc.progress = Math.min(1.02, arc.progress + arc.speed);

        // Current head position on geodesic
        const t = Math.min(1, arc.progress);
        const [headLon, headLat] = geodesicPoint(
          arc.srcLon, arc.srcLat, arc.dstLon, arc.dstLat, t
        );
        const headPt = lonLatToCanvas(headLon, headLat, viewLon, viewLat, zoom, W, H);

        if (headPt) {
          // Add to trail
          arc.trail.push([headPt[0], headPt[1], arc.alpha]);
          if (arc.trail.length > TRAIL_MAX_LEN) arc.trail.shift();
        }

        // Draw trail (ghosting effect)
        if (arc.trail.length >= 2) {
          for (let i = 1; i < arc.trail.length; i++) {
            const [x0, y0] = arc.trail[i-1];
            const [x1, y1] = arc.trail[i];
            // Fade from tail (0) to head (full)
            const trailAlpha = (i / arc.trail.length) * arc.alpha * 0.85;
            const w = arc.width * (i / arc.trail.length);

            if (arc.kind === "sync") {
              // Thick sync arc — cyan or purple based on network
              ctx.beginPath();
              ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
              ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${trailAlpha.toFixed(3)})`;
              ctx.lineWidth   = w;
              ctx.lineCap     = "round";
              ctx.stroke();
              // Glow core
              if (i === arc.trail.length - 1) {
                ctx.beginPath();
                ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
                ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${(trailAlpha * 0.6).toFixed(3)})`;
                ctx.lineWidth   = w * 3;
                ctx.filter      = "blur(2px)";
                ctx.stroke();
                ctx.filter = "none";
              }
            } else {
              // Thin TX arc — slightly shifted hue (complementary)
              // For cyan (0,245,255) → shift to slightly warm white; for purple → white
              const tr = Math.min(255, rgb.r + 120);
              const tg = Math.min(255, rgb.g + 40);
              const tb = Math.min(255, rgb.b);
              ctx.beginPath();
              ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
              ctx.strokeStyle = `rgba(${tr},${tg},${tb},${(trailAlpha * 0.7).toFixed(3)})`;
              ctx.lineWidth   = w;
              ctx.lineCap     = "round";
              ctx.stroke();
            }
          }

          // Head sparkle (bright dot at tip)
          if (headPt && arc.progress < 1) {
            const sparkR = arc.kind === "sync" ? 2.5 : 1.5;
            ctx.beginPath(); ctx.arc(headPt[0], headPt[1], sparkR, 0, Math.PI*2);
            ctx.fillStyle = arc.kind === "sync"
              ? `rgba(${rgb.r},${rgb.g},${rgb.b},0.95)`
              : `rgba(255,255,255,0.8)`;
            ctx.fill();

            // Halo at head
            const haloG = ctx.createRadialGradient(
              headPt[0], headPt[1], 0,
              headPt[0], headPt[1], sparkR * 5
            );
            haloG.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.5)`);
            haloG.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
            ctx.beginPath(); ctx.arc(headPt[0], headPt[1], sparkR*5, 0, Math.PI*2);
            ctx.fillStyle = haloG; ctx.fill();
          }
        }
      }
      ctx.restore();

      // ── 7. SP Nodes — neon double-render ─────────────────────────────────
      for (const sp of providers) {
        if (!sp.coordinates) continue;
        const pt = lonLatToCanvas(sp.coordinates[0], sp.coordinates[1], viewLon, viewLat, zoom, W, H);
        if (!pt) continue;

        const isHov = hoveredSP?.address === sp.address;
        const glowR = isHov ? 20 : 13;

        // Outer glow
        const gGrad = ctx.createRadialGradient(pt[0], pt[1], 0, pt[0], pt[1], glowR);
        gGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${isHov ? 0.55 : 0.28})`);
        gGrad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
        ctx.beginPath(); ctx.arc(pt[0], pt[1], glowR, 0, Math.PI*2);
        ctx.fillStyle = gGrad; ctx.fill();

        // Inner dot
        ctx.beginPath(); ctx.arc(pt[0], pt[1], isHov ? 5.5 : 3.5, 0, Math.PI*2);
        ctx.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`; ctx.fill();

        // Hover ring
        if (isHov) {
          // Animated pulse ring — use frameRef for offset
          const pulseScale = 1 + 0.4 * Math.sin(frameRef.current * 0.08);
          ctx.beginPath(); ctx.arc(pt[0], pt[1], 10 * pulseScale, 0, Math.PI*2);
          ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.6)`;
          ctx.lineWidth = 1; ctx.stroke();
        }
      }

      // ── 8. Sovereignty — gold, always on top ───────────────────────────────
      for (const s of SOVEREIGNTY_POINTS) {
        const pt = lonLatToCanvas(s.coords[0], s.coords[1], viewLon, viewLat, zoom, W, H);
        if (!pt) continue;

        // Gold glow
        const gg = ctx.createRadialGradient(pt[0], pt[1], 0, pt[0], pt[1], 18);
        gg.addColorStop(0, "rgba(255,215,0,0.55)");
        gg.addColorStop(1, "rgba(255,215,0,0)");
        ctx.beginPath(); ctx.arc(pt[0], pt[1], 18, 0, Math.PI*2);
        ctx.fillStyle = gg; ctx.fill();

        // Gold dot
        ctx.beginPath(); ctx.arc(pt[0], pt[1], 4, 0, Math.PI*2);
        ctx.fillStyle   = "#FFD700";
        ctx.shadowBlur  = 12;
        ctx.shadowColor = "#FFD700";
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label
        ctx.font      = "bold 9px 'DM Mono', monospace";
        ctx.fillStyle = "rgba(255,215,0,0.88)";
        ctx.fillText(s.label, pt[0] + 8, pt[1] + 3);
      }

      ctx.restore();

      // ── Advance frame + spawn arcs ─────────────────────────────────────────
      frameRef.current++;

      // Auto-rotate
      if (viewRef.current.autoRotate && !isDragging.current) {
        setViewState(v => ({ ...v, lon: v.lon + 0.05 }));
      }

      // Spawn new arcs every ~40 frames (~1.3s)
      if (frameRef.current % 40 === 0) spawnArcs();
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dots, providers, rgb, hoveredSP, spawnArcs]);

  // ── Mouse handlers ────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    lastMouse.current  = { x: e.clientX, y: e.clientY };
    setViewState(v => ({ ...v, autoRotate: false }));
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;

    if (isDragging.current && lastMouse.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setViewState(v => ({
        ...v,
        lon: v.lon - dx * 0.4,
        lat: Math.max(-80, Math.min(80, v.lat + dy * 0.3)),
      }));
      return;
    }

    // Hover detect
    const { lon: vLon, lat: vLat, zoom } = viewRef.current;
    const W = rect.width, H = rect.height;
    let found: StorageProvider | null = null;
    for (const sp of providers) {
      if (!sp.coordinates) continue;
      const pt = lonLatToCanvas(sp.coordinates[0], sp.coordinates[1], vLon, vLat, zoom, W, H);
      if (!pt) continue;
      if ((mx - pt[0])**2 + (my - pt[1])**2 < 196) { found = sp; break; }
    }
    setHoveredSP(found);
    setTooltipPos(found ? { x: mx, y: my } : null);
    canvas.style.cursor = found ? "pointer" : "grab";
  }, [providers]);

  const handleMouseUp    = useCallback(() => { isDragging.current = false; lastMouse.current = null; }, []);
  const handleMouseLeave = useCallback(() => {
    isDragging.current = false; lastMouse.current = null;
    setHoveredSP(null); setTooltipPos(null);
  }, []);

  const handleClick = useCallback(() => {
    if (hoveredSP && onProviderClick) onProviderClick(hoveredSP);
  }, [hoveredSP, onProviderClick]);

  const handleDblClick = useCallback(() => {
    setViewState(v => ({ ...v, lon: 110, lat: 15, autoRotate: true }));
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setViewState(v => ({ ...v, zoom: Math.max(0.6, Math.min(3.0, v.zoom - e.deltaY * 0.001)) }));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#030507", userSelect: "none" }}>

      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", cursor: "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onDoubleClick={handleDblClick}
        onWheel={handleWheel}
      />

      {/* Scanline overlay */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
        background: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.05) 3px,rgba(0,0,0,0.05) 4px)",
      }} />

      {/* SP hover tooltip */}
      {hoveredSP && tooltipPos && (
        <div style={{
          position: "absolute", left: tooltipPos.x + 16, top: tooltipPos.y - 10,
          zIndex: 20, pointerEvents: "none",
          background: "rgba(7,11,16,0.94)", backdropFilter: "blur(12px)",
          border: `1px solid ${accentColor}44`, borderRadius: 10,
          padding: "10px 14px", minWidth: 200,
          boxShadow: `0 8px 32px rgba(0,0,0,0.6)`,
        }}>
          <div style={{ fontSize: 9, color: "#3d5570", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
            Storage Provider
          </div>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: accentColor, marginBottom: 6 }}>
            {hoveredSP.addressShort}
          </div>
          <div style={{ display: "flex", gap: 10, fontSize: 10, color: "#7a9ab8", flexWrap: "wrap" }}>
            {hoveredSP.geo?.city && <span>{hoveredSP.geo.city}, {hoveredSP.geo.countryCode}</span>}
            <span style={{ color: hoveredSP.health === "Healthy" ? "#34d399" : "#f87171" }}>
              {hoveredSP.health}
            </span>
            {hoveredSP.capacityTiB && <span>{hoveredSP.capacityTiB.toFixed(2)} TiB</span>}
          </div>
        </div>
      )}

      {/* Legend — arc types */}
      <div style={{
        position: "absolute", bottom: 42, right: 16, zIndex: 10,
        pointerEvents: "none",
        display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end",
      }}>
        {[
          { label: "Sync arc (Node↔Hub)", thick: true,  color: accentColor },
          { label: "TX arc (Node→Node)",  thick: false, color: "#ffffff" },
        ].map(({ label, thick, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 8.5, color: "#3d5570", fontFamily: "'DM Mono',monospace" }}>{label}</span>
            <span style={{ width: thick ? 20 : 16, height: thick ? 2.5 : 1.2, background: color, borderRadius: 2, opacity: 0.7, boxShadow: `0 0 4px ${color}` }} />
          </div>
        ))}
      </div>

      {/* Controls hint */}
      <div style={{
        position: "absolute", bottom: 12, right: 16, zIndex: 10,
        fontSize: 9, fontFamily: "'DM Mono',monospace", color: "#3d5570",
        lineHeight: 1.7, textAlign: "right", pointerEvents: "none",
      }}>
        <div>drag · scroll · dbl-click reset</div>
      </div>

      {/* Node count */}
      {providers.length > 0 && (
        <div style={{
          position: "absolute", top: 12, left: 16, zIndex: 10,
          fontSize: 10, fontFamily: "'DM Mono',monospace",
          background: "rgba(0,0,0,0.6)", border: `1px solid ${accentColor}33`,
          borderRadius: 6, padding: "4px 10px", color: accentColor,
          backdropFilter: "blur(4px)",
        }}>
          {providers.length} nodes online
        </div>
      )}

      {/* Sovereignty badge */}
      <div style={{
        position: "absolute", top: 12, right: 16, zIndex: 10,
        fontSize: 9, fontFamily: "'DM Mono',monospace",
        background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,215,0,0.3)",
        borderRadius: 6, padding: "4px 10px", color: "#ffd700",
        backdropFilter: "blur(4px)",
      }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>
    </div>
  );
}