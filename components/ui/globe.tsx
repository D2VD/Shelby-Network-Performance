"use client";
// components/ui/globe.tsx — v11.0
//
// Drops cobe/WebGL entirely.
// Pure Canvas 2D dot-sphere — identical visual, zero WebGL errors.
// Uses requestAnimationFrame for rotation and react-spring for fade-in.
//
// No extra npm installs needed beyond @react-spring/web.

import {
  useEffect, useRef, useState, useCallback,
} from "react";
import { useSpring, animated } from "@react-spring/web";
import { useTheme }            from "@/components/theme-context";

// ── Public types ───────────────────────────────────────────────────
export interface GlobeMarker {
  location: [number, number]; // [lat, lng] degrees
  size:     number;           // 0.02–0.12 (scaled to canvas radius)
}

export const SHELBY_SP_MARKERS: GlobeMarker[] = [
  { location: [ 52.37,    4.90 ], size: 0.07 },
  { location: [ 52.37,    4.92 ], size: 0.05 },
  { location: [ 51.51,   -0.13 ], size: 0.07 },
  { location: [ 51.51,   -0.15 ], size: 0.05 },
  { location: [ 50.11,    8.68 ], size: 0.06 },
  { location: [ 38.72,   -9.14 ], size: 0.06 },
  { location: [ 40.41,   -3.70 ], size: 0.06 },
  { location: [ 40.71,  -74.01 ], size: 0.06 },
  { location: [ 37.77, -122.42 ], size: 0.07 },
  { location: [ 37.77, -122.44 ], size: 0.05 },
];

interface GlobeProps {
  markers?:     GlobeMarker[];
  autoRotate?:  boolean;
  interactive?: boolean;
  className?:   string;
  style?:       React.CSSProperties;
  markerColor?: [number, number, number]; // 0-1 RGB, kept for API compat
}

// ── Math helpers ───────────────────────────────────────────────────
const DEG = Math.PI / 180;

function latLngToVec3(lat: number, lng: number): [number, number, number] {
  const phi   = (90 - lat)  * DEG;
  const theta = (lng + 180) * DEG;
  return [
     Math.sin(phi) * Math.cos(theta),
     Math.cos(phi),
    -Math.sin(phi) * Math.sin(theta),
  ];
}

function rotateY(x: number, y: number, z: number, angle: number): [number, number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos + z * sin, y, -x * sin + z * cos];
}

// ── Pre-generate dot grid ──────────────────────────────────────────
interface Dot { x: number; y: number; z: number; }

function generateDots(spacing = 4): Dot[] {
  const dots: Dot[] = [];
  for (let lat = -90; lat <= 90; lat += spacing) {
    const ringR  = Math.cos(lat * DEG);
    const nDots  = Math.max(1, Math.round((360 * ringR) / spacing));
    const step   = 360 / nDots;
    for (let i = 0; i < nDots; i++) {
      const lng = i * step - 180;
      const [x, y, z] = latLngToVec3(lat, lng);
      dots.push({ x, y, z });
    }
  }
  return dots;
}

const DOTS = generateDots(4);

// ── Component ──────────────────────────────────────────────────────
export default function Globe({
  markers      = SHELBY_SP_MARKERS,
  autoRotate   = true,
  interactive  = false,
  className,
  style,
  markerColor  = [1, 0.47, 0.79],
}: GlobeProps) {
  const { isDark }   = useTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const phiRef       = useRef(0);
  const rafRef       = useRef<number>(0);
  const isDragging   = useRef(false);
  const lastX        = useRef(0);
  const [ready, setReady] = useState(false);

  // React-spring fade-in — called at top level (no hook-after-return bug)
  const spring = useSpring({
    opacity: ready ? 1 : 0,
    config:  { tension: 55, friction: 18 },
  });

  // Marker color as CSS hex string
  const markerHex = `rgb(${Math.round(markerColor[0] * 255)},${Math.round(markerColor[1] * 255)},${Math.round(markerColor[2] * 255)})`;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W   = canvas.width;
    const H   = canvas.height;
    const cx  = W / 2;
    const cy  = H / 2;
    const R   = Math.min(W, H) * 0.44;
    const phi = phiRef.current;
    const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;

    ctx.clearRect(0, 0, W, H);

    // ── Dot grid ────────────────────────────────────────────────────
    const dotColor   = isDark ? "rgba(255,119,201,0.22)" : "rgba(50,35,19,0.12)";
    const dotColorFg = isDark ? "rgba(255,119,201,0.55)" : "rgba(50,35,19,0.28)";
    const dotR = Math.max(1, R * 0.012);

    for (const d of DOTS) {
      const [rx, ry, rz] = rotateY(d.x, d.y, d.z, phi);
      if (rz < 0) continue; // back hemisphere — skip
      const depth   = (rz + 1) / 2;       // 0=edge 1=center
      const sx      = cx + rx * R;
      const sy      = cy - ry * R;
      ctx.globalAlpha = 0.3 + depth * 0.7;
      ctx.fillStyle   = depth > 0.5 ? dotColorFg : dotColor;
      ctx.beginPath();
      ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Atmosphere glow ─────────────────────────────────────────────
    const grd = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.12);
    const glowA = isDark ? "rgba(255,119,201,0.08)" : "rgba(255,119,201,0.05)";
    grd.addColorStop(0, glowA);
    grd.addColorStop(1, "rgba(255,119,201,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle   = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
    ctx.fill();

    // ── SP markers ──────────────────────────────────────────────────
    for (const m of markers) {
      const [vx, vy, vz] = latLngToVec3(m.location[0], m.location[1]);
      const [rx, ry, rz] = rotateY(vx, vy, vz, phi);
      if (rz < 0) continue; // behind the globe

      const sx    = cx + rx * R;
      const sy    = cy - ry * R;
      const mR    = R * m.size * 0.7;
      const depth = (rz + 1) / 2;

      // Outer glow
      const gm = ctx.createRadialGradient(sx, sy, 0, sx, sy, mR * 3);
      gm.addColorStop(0, markerHex.replace("rgb(", "rgba(").replace(")", ",0.5)"));
      gm.addColorStop(1, markerHex.replace("rgb(", "rgba(").replace(")", ",0)"));
      ctx.globalAlpha = depth;
      ctx.fillStyle   = gm;
      ctx.beginPath();
      ctx.arc(sx, sy, mR * 3, 0, Math.PI * 2);
      ctx.fill();

      // Core
      ctx.globalAlpha = 0.7 + depth * 0.3;
      ctx.fillStyle   = markerHex;
      ctx.beginPath();
      ctx.arc(sx, sy, mR, 0, Math.PI * 2);
      ctx.fill();

      // Ring
      ctx.globalAlpha = depth * 0.6;
      ctx.strokeStyle = markerHex;
      ctx.lineWidth   = Math.max(1, mR * 0.4);
      ctx.beginPath();
      ctx.arc(sx, sy, mR * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

    if (!ready) setReady(true);
  }, [isDark, markers, markerHex, ready]);

  // ── Animation loop ─────────────────────────────────────────────
  useEffect(() => {
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); // cap at 50ms
      last = now;
      if (autoRotate && !isDragging.current) phiRef.current += dt * 0.4;
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [autoRotate, draw]);

  // ── ResizeObserver — sync canvas pixel size ────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;

    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 2, 2);

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

  // ── Pointer interaction ────────────────────────────────────────
  useEffect(() => {
    if (!interactive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (e: PointerEvent) => {
      isDragging.current = true;
      lastX.current = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      phiRef.current += (e.clientX - lastX.current) / 300;
      lastX.current = e.clientX;
    };
    const onUp = () => { isDragging.current = false; };

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
        style={{
          display: "block",
          cursor:  interactive ? "grab" : "default",
          opacity: spring.opacity,
        }}
      />
    </div>
  );
}