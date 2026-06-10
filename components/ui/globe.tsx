"use client";
// components/ui/globe.tsx — v8.1
// Added: Hoàng Sa + Trường Sa pink blobs (VN maritime territories not in world-atlas)
//   [1] Full sphere visible — radius = min(W,H) × 0.46, translate to canvas center
//   [2] CSS starfield — 60 deterministic radial-gradient stars on parent div
//   [3] Shelby-pink continents — LAND_FILL = "#e91e8c" (was near-transparent)
//   [4] SP marker pulse animation — scale 0→1 (ease-in), hold, 1→0 (ease-out)
//   [5] No sovereignty text labels on globe (labels only on flat map)
//   [6] Drag direction fix — rot[0] + dx·SENS (was rot[0] − dx·SENS)

import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
} from "react";
import { geoOrthographic, geoPath, geoGraticule } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";

/* ── Visual constants ─────────────────────────────────────────────────────── */

const LAND_FILL      = "#e91e8c";                  // [3] Shelby pink continents
const LAND_STROKE    = "rgba(255,255,255,0.12)";
const OCEAN_FILL     = "#06061a";                  // Deep space ocean
const OUTLINE_GLOW   = "rgba(233,30,140,0.22)";   // Subtle pink halo on sphere edge
const GRATICULE_CLR  = "rgba(255,255,255,0.04)";

const HEALTH_COLOR: Record<string, string> = {
  Healthy:    "#22c55e",
  Faulty:     "#ef4444",
  Waitlisted: "#a855f7",
  Leaving:    "#f97316",
  Unknown:    "#6b7280",
};

const SENSITIVITY  = 0.45;   // degrees per CSS-pixel drag
const AUTO_RPM     = 0.06;   // auto-rotation degrees per frame
const CYCLE_MS     = 2800;   // [4] one full marker appear/disappear cycle (ms)
const GOLDEN       = 0.618;  // marker phase offset (golden ratio spread)

/* ── [2] Starfield — 60 deterministic stars via radial-gradient ───────────── */

const STARFIELD = Array.from({ length: 60 }, (_, i) => {
  const x  = ((i * 137.508) % 100).toFixed(2);   // Sunflower distribution
  const y  = ((i * 91.274 + 17) % 100).toFixed(2);
  const sz = (0.5 + (i % 3) * 0.35).toFixed(1);
  const op = (0.25 + (i % 7) * 0.08).toFixed(2);
  return `radial-gradient(${sz}px ${sz}px at ${x}% ${y}%, rgba(255,255,255,${op}) 0%, transparent 100%)`;
}).join(",\n");

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface GlobeMarker {
  address: string;
  lat: number;
  lng: number;
  health: string;
  az: string;
  // NOTE: sovereignty markers (Paracel/Spratly) must NOT be passed here.
  // Globe only receives real SP nodes. Sovereignty labels live in world-map-inner.tsx only.
}

interface GlobeProps {
  markers?: GlobeMarker[];
  autoRotate?: boolean;
  onMarkerClick?: (marker: GlobeMarker) => void;
  className?: string;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Returns true if the geographic point (lng, lat) is on the visible hemisphere
 * of the orthographic projection at the given rotation [lambda, phi].
 * Uses the spherical dot-product: center of visible face is at (−λ, −φ).
 */
function isVisible(lng: number, lat: number, rot: [number, number]): boolean {
  const toR = (d: number) => d * (Math.PI / 180);
  const cLng = -rot[0];
  const cLat = -rot[1];
  const dot =
    Math.sin(toR(lat)) * Math.sin(toR(cLat)) +
    Math.cos(toR(lat)) * Math.cos(toR(cLat)) * Math.cos(toR(lng - cLng));
  return dot > 0.01; // small positive threshold avoids limb jitter
}

/** Convert 6-char hex color + alpha to rgba string for canvas gradients */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Smooth ease-in-out curve (cubic) */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/* ── Component ────────────────────────────────────────────────────────────── */

export default function Globe({
  markers = [],
  autoRotate = true,
  onMarkerClick,
  className = "",
}: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);

  // World topology (loaded once)
  const worldRef = useRef<FeatureCollection<Geometry, GeoJsonProperties> | null>(null);

  // [1] Rotation state — stored in ref to avoid re-render on each frame
  const rotRef = useRef<[number, number]>([-20, -25]);

  // [6] Drag state
  const dragRef = useRef({
    active: false,
    sx: 0,
    sy: 0,
    sr: [-20, -25] as [number, number],
  });

  const rafRef  = useRef<number>(0);
  const t0Ref   = useRef(Date.now());           // animation start time
  const [loaded, setLoaded] = useState(false);

  /* ── Load world atlas TopoJSON ─────────────────────────────────────────── */
  useEffect(() => {
    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
      .then((r) => r.json())
      .then((topo: Topology) => {
        const countries = topo.objects.countries;
        worldRef.current = feature(
          topo,
          countries as Parameters<typeof feature>[1]
        ) as FeatureCollection<Geometry, GeoJsonProperties>;
        setLoaded(true);
      })
      .catch((err) => console.error("[Globe] world-atlas load failed:", err));
  }, []);

  /* ── Canvas draw ───────────────────────────────────────────────────────── */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctr    = containerRef.current;
    const world  = worldRef.current;
    if (!canvas || !ctr || !world) return;

    const W = ctr.clientWidth;
    const H = ctr.clientHeight;

    // [1] Resize canvas to match container exactly
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width  = W;
      canvas.height = H;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // [1] Radius: fit full sphere in both dimensions
    const radius = Math.min(W, H) * 0.46;
    const rot    = rotRef.current;

    const proj = geoOrthographic()
      .scale(radius)
      .translate([W / 2, H / 2])   // [1] center the sphere in the canvas
      .rotate([rot[0], rot[1], 0])
      .clipAngle(90);

    const pathGen = geoPath(proj, ctx);
    const grat    = geoGraticule();
    const sphere  = { type: "Sphere" } as Parameters<typeof pathGen>[0];

    ctx.clearRect(0, 0, W, H);

    /* Ocean base */
    ctx.beginPath();
    pathGen(sphere);
    ctx.fillStyle = OCEAN_FILL;
    ctx.fill();

    /* Sphere edge glow */
    ctx.beginPath();
    pathGen(sphere);
    ctx.strokeStyle = OUTLINE_GLOW;
    ctx.lineWidth   = 2;
    ctx.stroke();

    /* Graticule grid */
    ctx.beginPath();
    pathGen(grat());
    ctx.strokeStyle = GRATICULE_CLR;
    ctx.lineWidth   = 0.5;
    ctx.stroke();

    /* [3] Land — Shelby pink */
    ctx.beginPath();
    pathGen(world);
    ctx.fillStyle   = LAND_FILL;
    ctx.fill();
    ctx.strokeStyle = LAND_STROKE;
    ctx.lineWidth   = 0.4;
    ctx.stroke();

    /* Vietnamese maritime territories — drawn on top of ocean, same pink as land.
       world-atlas 110m TopoJSON does not include these; we paint them manually.
         Hoàng Sa (Paracel Is.) : ~16.5°N 112.2°E
         Trường Sa (Spratly Is.): ~11.5°N 114.3°E                               */
    const VN_TERRITORIES = [
      { lat: 16.5, lng: 112.2, rFrac: 0.009 },  // Hoàng Sa  ~150 km wide
      { lat: 11.5, lng: 114.3, rFrac: 0.018 },  // Trường Sa ~800 km span
    ];
    VN_TERRITORIES.forEach(({ lat, lng, rFrac }) => {
      if (!isVisible(lng, lat, rot)) return;
      const pt = proj([lng, lat]);
      if (!pt) return;
      const [tx, ty] = pt;
      const tr = Math.max(5, radius * rFrac);
      ctx.beginPath();
      ctx.arc(tx, ty, tr, 0, Math.PI * 2);
      ctx.fillStyle   = LAND_FILL;
      ctx.fill();
      ctx.strokeStyle = LAND_STROKE;
      ctx.lineWidth   = 0.4;
      ctx.stroke();
    });

    /* [4] SP Markers — animated diamonds ─────────────────────────────────── */
    const elapsed = Date.now() - t0Ref.current;

    markers.forEach((m, i) => {
      // [5] Skip any marker that shouldn't appear on globe
      // (sovereignty markers should never be in the markers prop;
      //  this guard is a final safety net)
      if (!m.lat || !m.lng) return;
      if (!isVisible(m.lng, m.lat, rot)) return;

      const pt = proj([m.lng, m.lat]);
      if (!pt) return;
      const [px, py] = pt;

      /* Phase: offset each marker by golden-ratio fraction so they don't all
         appear/disappear in sync */
      const raw   = ((elapsed / CYCLE_MS) + i * GOLDEN) % 1; // 0..1

      /* Scale curve:
           0 – 20%  → ease-in  0→1  (appear / enlarge)
          20 – 75%  → hold at  1    (fully visible)
          75 – 100% → ease-out 1→0  (shrink / disappear)         */
      let scale: number;
      if (raw < 0.20) {
        scale = easeInOut(raw / 0.20);
      } else if (raw < 0.75) {
        scale = 1;
      } else {
        scale = easeInOut(1 - (raw - 0.75) / 0.25);
      }

      const alpha = Math.max(0.05, scale);
      const sz    = 10 * scale;                  // half-diagonal of the diamond
      const color = HEALTH_COLOR[m.health] ?? HEALTH_COLOR.Unknown;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px, py);

      /* Glow halo */
      const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, sz * 3.5);
      grd.addColorStop(0, hexToRgba(color, 0.45));
      grd.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(0, 0, sz * 3.5, 0, Math.PI * 2);
      ctx.fill();

      /* Diamond (square rotated 45°) */
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.rect(-sz / 2, -sz / 2, sz, sz);
      ctx.fillStyle   = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth   = Math.max(0.5, 0.8 / (scale || 0.01));
      ctx.stroke();

      ctx.restore();
    });
  }, [markers]);

  /* ── RAF animation loop ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!loaded) return;

    const loop = () => {
      // Auto-rotate when idle
      if (autoRotate && !dragRef.current.active) {
        rotRef.current = [rotRef.current[0] + AUTO_RPM, rotRef.current[1]];
      }
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loaded, autoRotate, draw]);

  /* ── Resize observer ───────────────────────────────────────────────────── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  /* ── [6] Drag: RIGHT drag → positive Δlambda → globe rotates RIGHT ──────
     Previous bug: rotRef.current[0] -= dx * SENSITIVITY  (inverted)
     Fixed:        rotRef.current[0] += dx * SENSITIVITY  (natural)        */

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = {
      active: true,
      sx: e.clientX,
      sy: e.clientY,
      sr: [...rotRef.current] as [number, number],
    };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    rotRef.current = [
      dragRef.current.sr[0] + dx * SENSITIVITY,                            // [6] + not −
      Math.max(-90, Math.min(90, dragRef.current.sr[1] - dy * SENSITIVITY)),
    ];
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  /* Touch equivalents */
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    dragRef.current = {
      active: true,
      sx: t.clientX,
      sy: t.clientY,
      sr: [...rotRef.current] as [number, number],
    };
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current.active) return;
    const t  = e.touches[0];
    const dx = t.clientX - dragRef.current.sx;
    const dy = t.clientY - dragRef.current.sy;
    rotRef.current = [
      dragRef.current.sr[0] + dx * SENSITIVITY,                            // [6] + not −
      Math.max(-90, Math.min(90, dragRef.current.sr[1] - dy * SENSITIVITY)),
    ];
  }, []);

  /* Click → hit-test markers */
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onMarkerClick) return;
      const canvas = canvasRef.current;
      const ctr    = containerRef.current;
      if (!canvas || !ctr) return;

      const rect   = canvas.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;
      const W      = ctr.clientWidth;
      const H      = ctr.clientHeight;
      const radius = Math.min(W, H) * 0.46;
      const rot    = rotRef.current;

      const proj = geoOrthographic()
        .scale(radius)
        .translate([W / 2, H / 2])
        .rotate([rot[0], rot[1], 0])
        .clipAngle(90);

      for (const m of markers) {
        if (!isVisible(m.lng, m.lat, rot)) continue;
        const pt = proj([m.lng, m.lat]);
        if (!pt) continue;
        const dx = mx - pt[0];
        const dy = my - pt[1];
        if (Math.sqrt(dx * dx + dy * dy) < 18) {
          onMarkerClick(m);
          break;
        }
      }
    },
    [markers, onMarkerClick]
  );

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none ${className}`}
      style={{
        // Deep-space background — radial so centre is lighter (galaxy core feel)
        background: "radial-gradient(ellipse at 50% 42%, #0d0d2b 0%, #050510 80%)",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={endDrag}
      onClick={onClick}
    >
      {/* [2] Starfield — pure CSS, no extra DOM cost */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: STARFIELD }}
      />

      {/* Globe canvas — absolutely positioned to fill container */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Loading indicator */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-sm text-pink-400 animate-pulse tracking-wide">
            Loading globe…
          </span>
        </div>
      )}
    </div>
  );
}