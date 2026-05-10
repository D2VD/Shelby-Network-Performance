"use client";
// components/globe-landing.tsx — v1.0
// Canvas dot-globe for landing hero section
// Uses cobe-style WebGL via canvas, falls back to CSS dot animation
// SP markers rendered as colored dots on sphere surface

import { useEffect, useRef, useState } from "react";

interface GlobeMarker {
  lat: number;
  lng: number;
  color: string;
  size: number;
  label?: string;
}

// Testnet SP locations (from shared-types AZ_LOCATION_MAP)
const DEFAULT_MARKERS: GlobeMarker[] = [
  { lat: 52.37,   lng:  4.90,  color: "#ff77c9", size: 6, label: "Jump-AMS" },
  { lat: 51.51,   lng: -0.13,  color: "#ff77c9", size: 6, label: "Jump-LON" },
  { lat: 50.11,   lng:  8.68,  color: "#ff77c9", size: 5, label: "Stakely" },
  { lat: 38.72,   lng: -9.14,  color: "#a78bfa", size: 5, label: "Duoro" },
  { lat: 40.41,   lng: -3.70,  color: "#a78bfa", size: 5, label: "Nova" },
  { lat: 40.71,   lng:-74.01,  color: "#60a5fa", size: 5, label: "Republic" },
  { lat: 37.77,   lng:-122.42, color: "#60a5fa", size: 5, label: "AR" },
];

const DEG = Math.PI / 180;

function latLngToXYZ(lat: number, lng: number, r: number) {
  const phi   = (90 - lat)  * DEG;
  const theta = (lng + 180) * DEG;
  return {
    x:  r * Math.sin(phi) * Math.cos(theta),
    y:  r * Math.cos(phi),
    z: -r * Math.sin(phi) * Math.sin(theta),
  };
}

// Project 3D → 2D
function project(x: number, y: number, z: number, cx: number, cy: number, scale: number) {
  const fov = 1.8;
  const pz  = z + fov;
  return {
    sx: cx + (x / pz) * scale,
    sy: cy - (y / pz) * scale,
    visible: z > -fov * 0.6,
  };
}

export default function GlobeLanding({ markers = DEFAULT_MARKERS }: { markers?: GlobeMarker[] }) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const angleRef   = useRef(0);
  const frameRef   = useRef<number>(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // HiDPI
    const dpr = window.devicePixelRatio || 1;
    const size = canvas.offsetWidth;
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const r  = size * 0.38;

    // Pre-generate dot positions on sphere
    const dots: { x: number; y: number; z: number; gx: number; gy: number }[] = [];
    const dotSpacing = 3.8; // degrees between dots
    for (let lat = -90; lat <= 90; lat += dotSpacing) {
      const ring   = Math.cos(lat * DEG);
      const nDots  = Math.max(1, Math.round(360 * ring / dotSpacing));
      const step   = 360 / nDots;
      for (let i = 0; i < nDots; i++) {
        const lng = i * step - 180;
        const { x, y, z } = latLngToXYZ(lat, lng, r);
        dots.push({ x, y, z, gx: 0, gy: 0 });
      }
    }

    setReady(true);

    // Get theme colors
    function getColors() {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      return {
        dot:  isDark ? "rgba(255,119,201,0.18)" : "rgba(50,35,19,0.09)",
        glow: isDark ? "rgba(255,119,201,0.04)"  : "rgba(255,119,201,0.05)",
        bg:   isDark ? "rgba(13,10,8,0)"          : "rgba(255,255,255,0)",
      };
    }

    function draw() {
  // [Fail Fast]: Thoát sớm nếu context không tồn tại
  if (!ctx) return;

  const S = size;
  ctx.clearRect(0, 0, S, S);
  const colors = getColors();

  // Rotate angle
  angleRef.current += 0.002;
  const angle = angleRef.current;
  const cosA  = Math.cos(angle);
  const sinA  = Math.sin(angle);

  // Vẽ các dots...
  ctx.fillStyle = colors.dot;
  for (const d of dots) {
    const rx = d.x * cosA - d.z * sinA;
    const rz = d.x * sinA + d.z * cosA;
    const { sx, sy, visible } = project(rx, d.y, rz, cx, cy, S * 0.5);
    if (!visible) continue;
    
    const depth = (rz + r) / (2 * r);
    const alpha = 0.3 + depth * 0.7;
    const dotR  = 1.5;
    ctx.globalAlpha = alpha * 0.85;
    ctx.beginPath();
    ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Vẽ SP markers...
  for (const m of markers) {
    const { x, y, z } = latLngToXYZ(m.lat, m.lng, r);
    const rx = x * cosA - z * sinA;
    const rz = x * sinA + z * cosA;
    const { sx, sy, visible } = project(rx, y, rz, cx, cy, S * 0.5);
    if (!visible) continue;

    const depth = (rz + r) / (2 * r);

    // Outer glow
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, m.size * 3);
    grad.addColorStop(0, m.color + "66");
    grad.addColorStop(1, m.color + "00");
    ctx.globalAlpha = depth * 0.9;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, m.size * 3, 0, Math.PI * 2);
    ctx.fill();

    // Core dot
    ctx.globalAlpha = 0.7 + depth * 0.3;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(sx, sy, m.size * 0.65, 0, Math.PI * 2);
    ctx.fill();

    // Ring
    ctx.globalAlpha = (0.5 + depth * 0.5) * 0.6;
    ctx.strokeStyle = m.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, m.size * 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  frameRef.current = requestAnimationFrame(draw);
}

draw();

    
    return () => cancelAnimationFrame(frameRef.current);
  }, [markers]);

  return (
    <div style={{
      position: "relative",
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      {/* Gradient bg */}
      <div style={{
        position:     "absolute",
        inset:        0,
        borderRadius: "inherit",
        background:   "radial-gradient(circle at 60% 40%, rgba(255,119,201,0.08) 0%, transparent 65%)",
        pointerEvents: "none",
      }} />

      <canvas
        ref={canvasRef}
        style={{
          width:      "100%",
          height:     "100%",
          borderRadius: "inherit",
          opacity:    ready ? 1 : 0,
          transition: "opacity 0.6s",
          display:    "block",
        }}
      />
    </div>
  );
}