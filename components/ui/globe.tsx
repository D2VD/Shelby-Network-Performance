"use client";
// components/ui/globe.tsx — v12.0
//
// Uses d3-geo orthographic projection + TopoJSON world topology.
// Renders land polygons (dots-on-land style) matching the reference image.
// Marker chips float above each SP location.
// Pure Canvas 2D + react-spring fade-in. No WebGL. No cobe.
//
// Dependencies already in project:
//   npm install d3 topojson-client @react-spring/web
//   (d3 and topojson-client are already used by react-simple-maps)

import {
  useEffect, useRef, useState, useCallback,
} from "react";
import { useSpring, animated } from "@react-spring/web";
import { useTheme }            from "@/components/theme-context";

export interface GlobeMarker {
  location: [number, number]; // [lat, lng]
  size:     number;
  label?:   string;
}

export const SHELBY_SP_MARKERS: GlobeMarker[] = [
  { location: [ 52.37,    4.90 ], size: 0.07, label: "Jump-AMS" },
  { location: [ 51.51,   -0.13 ], size: 0.07, label: "Jump-LON" },
  { location: [ 50.11,    8.68 ], size: 0.06, label: "Stakely" },
  { location: [ 38.72,   -9.14 ], size: 0.06, label: "Duoro" },
  { location: [ 40.41,   -3.70 ], size: 0.06, label: "Nova" },
  { location: [ 40.71,  -74.01 ], size: 0.06, label: "Republic" },
  { location: [ 37.77, -122.42 ], size: 0.07, label: "AR" },
];

interface GlobeProps {
  markers?:     GlobeMarker[];
  autoRotate?:  boolean;
  interactive?: boolean;
  className?:   string;
  style?:       React.CSSProperties;
  markerColor?: [number, number, number];
}

// ── World topology cache (fetched once per session) ────────────────
let worldCache: any = null;

async function fetchWorld() {
  if (worldCache) return worldCache;
  try {
    // Uses cdn.jsdelivr.net — already in CSP connect-src
    const res = await fetch(
      "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"
    );
    const topo = await res.json();
    // Lazy-import topojson-client
    const { feature } = await import("topojson-client" as any);
    worldCache = feature(topo, topo.objects.land);
    return worldCache;
  } catch {
    return null;
  }
}

export default function Globe({
  markers      = SHELBY_SP_MARKERS,
  autoRotate   = true,
  interactive  = false,
  className,
  style,
  markerColor  = [1, 0.47, 0.79],
}: GlobeProps) {
  const { isDark }   = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const rotationRef  = useRef(0);   // longitude offset in degrees
  const isDragging   = useRef(false);
  const lastX        = useRef(0);
  const worldRef     = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // React-spring fade-in — top-level, before any return
  const spring = useSpring({
    opacity: ready ? 1 : 0,
    config:  { tension: 55, friction: 18 },
  });

  const markerHex =
    `#${Math.round(markerColor[0] * 255).toString(16).padStart(2, "0")}` +
    `${Math.round(markerColor[1] * 255).toString(16).padStart(2, "0")}` +
    `${Math.round(markerColor[2] * 255).toString(16).padStart(2, "0")}`;

  // ── Draw one frame ────────────────────────────────────────────────
  const draw = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Lazy load d3 + world on first draw
    if (!worldRef.current) {
      const [{ geoOrthographic, geoPath, geoGraticule }, world] =
        await Promise.all([
          import("d3-geo" as any),
          fetchWorld(),
        ]);

      // Store on ref so subsequent draws are synchronous
      worldRef.current = { geoOrthographic, geoPath, geoGraticule, world };
      if (!ready) setReady(true);
    }

    const { geoOrthographic, geoPath, geoGraticule, world } = worldRef.current;

    const W  = canvas.width;
    const H  = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const R  = Math.min(W, H) * 0.46;
    const dpr = canvas.width / (canvas.style.width
      ? parseFloat(canvas.style.width) : canvas.width) || 1;

    ctx.clearRect(0, 0, W, H);

    // ── Projection centered on current rotation ───────────────────
    const projection = geoOrthographic()
      .scale(R)
      .translate([cx, cy])
      .rotate([rotationRef.current, -15, 0]); // tilt 15° for better look

    const path = geoPath(projection, ctx);

    // ── Ocean fill ────────────────────────────────────────────────
    const sphere = { type: "Sphere" } as any;
    ctx.beginPath();
    path(sphere);
    ctx.fillStyle = isDark ? "#0d0a08" : "#f0f0f0";
    ctx.fill();

    // ── Subtle atmosphere ring ────────────────────────────────────
    const atm = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.08);
    atm.addColorStop(0, isDark ? "rgba(255,119,201,0.08)" : "rgba(200,200,220,0.4)");
    atm.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    path(sphere);
    ctx.fillStyle = atm;
    ctx.fill();

    // ── Graticule (grid lines) ────────────────────────────────────
    const graticule = geoGraticule().step([20, 20])();
    ctx.beginPath();
    path(graticule);
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)";
    ctx.lineWidth   = 0.5;
    ctx.stroke();

    // ── Land polygons ─────────────────────────────────────────────
    if (world) {
      ctx.beginPath();
      path(world);
      // Light theme: dark dots on land; dark theme: lighter land
      ctx.fillStyle   = isDark ? "rgba(255,255,255,0.12)" : "rgba(30,20,10,0.13)";
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.06)" : "rgba(30,20,10,0.06)";
      ctx.lineWidth   = 0.4;
      ctx.fill();
      ctx.stroke();
    }

    // ── Globe border ──────────────────────────────────────────────
    ctx.beginPath();
    path(sphere);
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)";
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // ── SP markers + label chips ──────────────────────────────────
    const chips: { sx: number; sy: number; label: string; visible: boolean }[] = [];

    for (const m of markers) {
      const [lng, lat] = [m.location[1], m.location[0]];
      const projected  = projection([lng, lat]);
      if (!projected) continue;

      const [sx, sy] = projected;

      // Check visibility (front hemisphere)
      const rot = rotationRef.current * Math.PI / 180;
      const tilt = -15 * Math.PI / 180;
      const latR  = lat  * Math.PI / 180;
      const lngR  = lng  * Math.PI / 180;
      const cosDot =
        Math.cos(latR) * Math.cos(tilt) * Math.cos(lngR + rot) +
        Math.sin(latR) * Math.sin(tilt);
      if (cosDot < 0) continue; // behind globe

      const mR = R * m.size * 0.55;

      // Outer glow
      const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, mR * 3.5);
      grd.addColorStop(0, `${markerHex}55`);
      grd.addColorStop(1, `${markerHex}00`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(sx, sy, mR * 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Core dot
      ctx.fillStyle   = markerHex;
      ctx.strokeStyle = isDark ? "#0d0a08" : "#ffffff";
      ctx.lineWidth   = Math.max(1.5, mR * 0.4);
      ctx.beginPath();
      ctx.arc(sx, sy, mR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (m.label) {
        chips.push({ sx, sy, label: m.label, visible: cosDot > 0.1 });
      }
    }

    // Draw chips AFTER all dots (so they're on top)
    for (const chip of chips) {
      if (!chip.visible) continue;
      const { sx, sy, label } = chip;

      ctx.font      = `bold ${Math.max(9, Math.round(R * 0.028))}px 'Roboto Mono', monospace`;
      ctx.textBaseline = "middle";
      const tw    = ctx.measureText(label).width;
      const pw    = 8 * dpr;
      const ph    = 5 * dpr;
      const cw    = tw + pw * 2;
      const ch    = Math.max(9, Math.round(R * 0.028)) + ph * 2;
      const chipX = sx + R * 0.04;
      const chipY = sy - ch / 2 - R * 0.04;

      // Chip background
      ctx.fillStyle   = markerHex;
      ctx.strokeStyle = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.1)";
      ctx.lineWidth   = 0.5;
      const crad = ch * 0.35;
      ctx.beginPath();
      ctx.roundRect(chipX, chipY, cw, ch, crad);
      ctx.fill();
      ctx.stroke();

      // Connector line
      ctx.strokeStyle = markerHex;
      ctx.lineWidth   = 1 * dpr;
      ctx.setLineDash([2 * dpr, 2 * dpr]);
      ctx.beginPath();
      ctx.moveTo(sx, sy - R * 0.02);
      ctx.lineTo(chipX, chipY + ch / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label text
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, chipX + pw, chipY + ch / 2);
    }
  }, [isDark, markers, markerHex, ready]);

  // ── Animation loop ────────────────────────────────────────────────
  useEffect(() => {
    let rafId: number;
    let last = performance.now();
    let initialized = false;

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (autoRotate && !isDragging.current) rotationRef.current -= dt * 15; // degrees/sec
      draw().then(() => {
        if (!initialized) { initialized = true; }
      });
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [autoRotate, draw]);

  // ── ResizeObserver ────────────────────────────────────────────────
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

  // ── Pointer interaction ───────────────────────────────────────────
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
      rotationRef.current -= (e.clientX - lastX.current) * 0.3;
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