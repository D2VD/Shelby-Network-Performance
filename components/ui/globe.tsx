"use client";
// components/ui/globe.tsx — v4.0
//
// Root cause of TS(2353):
//   The version of cobe installed defines COBEOptions WITHOUT onRender.
//   onRender is accepted at runtime but absent from the shipped .d.ts.
//   Fix: build config without onRender, then spread-cast with `as any`
//   so TypeScript doesn't validate the extra property.
//
// Fix for TS(7006): onRender state is typed as `Record<string,unknown>`
//   and we write to it with a plain property assignment — no cast needed.
//
// React Spring: useSpring drives a smooth opacity 0→1 fade once cobe
//   fires its first frame (setReady(true)).
//
// npm install cobe @react-spring/web   ← both required

import { useLayoutEffect, useEffect, useRef, useState } from "react";
import { useSpring, animated }                          from "@react-spring/web";
import createGlobe                                      from "cobe";
import type { COBEOptions }                             from "cobe";
import { useTheme }                                     from "@/components/theme-context";

// ── Public types ───────────────────────────────────────────────────
export interface GlobeMarker {
  location: [number, number]; // [lat, lng]
  size:     number;           // 0.02 – 0.12
}

export const SHELBY_SP_MARKERS: GlobeMarker[] = [
  { location: [ 52.37,    4.90 ], size: 0.07 }, // Amsterdam Jump-0
  { location: [ 52.37,    4.92 ], size: 0.05 }, // Amsterdam Jump-1
  { location: [ 51.51,   -0.13 ], size: 0.07 }, // London Jump-0
  { location: [ 51.51,   -0.15 ], size: 0.05 }, // London Jump-1
  { location: [ 50.11,    8.68 ], size: 0.06 }, // Frankfurt Stakely
  { location: [ 38.72,   -9.14 ], size: 0.06 }, // Lisbon Duoro
  { location: [ 40.41,   -3.70 ], size: 0.06 }, // Madrid Nova
  { location: [ 40.71,  -74.01 ], size: 0.06 }, // New York Republic
  { location: [ 37.77, -122.42 ], size: 0.07 }, // San Francisco AR-0
  { location: [ 37.77, -122.44 ], size: 0.05 }, // San Francisco AR-1
];

interface GlobeProps {
  markers?:     GlobeMarker[];
  autoRotate?:  boolean;
  interactive?: boolean;
  className?:   string;
  style?:       React.CSSProperties;
  markerColor?: [number, number, number];
}

export default function Globe({
  markers      = SHELBY_SP_MARKERS,
  autoRotate   = true,
  interactive  = false,
  className,
  style,
  markerColor  = [1, 0.47, 0.79], // #ff77c9 Shelby pink
}: GlobeProps) {
  const { isDark }   = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const phiRef       = useRef(0);
  const isDragging   = useRef(false);
  const lastX        = useRef(0);
  const globeRef     = useRef<{ destroy: () => void } | null>(null);
  const [ready, setReady] = useState(false);

  // ── React Spring: smooth opacity fade-in on first render ──────────
  const springStyle = useSpring({
    opacity: ready ? 1 : 0,
    config:  { tension: 60, friction: 20 }, // slow, smooth reveal
  });

  // ── Globe init (useLayoutEffect → offsetWidth is always set) ──────
  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;

    // Destroy previous instance
    if (globeRef.current) {
      try { globeRef.current.destroy(); } catch { /* ignore */ }
      globeRef.current = null;
      setReady(false);
    }

    const size = container.offsetWidth || 400;
    const dpr  = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 2, 2);

    canvas.style.width  = `${size}px`;
    canvas.style.height = `${size}px`;

    // ── FIX TS(2353): onRender absent from installed cobe .d.ts ──────
    // Build the typed part of config without onRender:
    const baseConfig: COBEOptions = {
      devicePixelRatio: dpr,
      width:            size * dpr,
      height:           size * dpr,
      phi:              phiRef.current,
      theta:            0.15,
      dark:             isDark ? 1 : 0,
      diffuse:          isDark ? 1.4 : 1.2,
      mapSamples:       20_000,
      mapBrightness:    isDark ? 1.4 : 8,  // 8 = dots visible on white bg
      baseColor:        isDark
        ? [0.06, 0.04, 0.03] as [number, number, number]
        : [0.88, 0.88, 0.90] as [number, number, number],
      markerColor,
      glowColor:        isDark
        ? [1, 0.47, 0.79] as [number, number, number]
        : [0.90, 0.85, 0.92] as [number, number, number],
      markers: markers.map(m => ({ location: m.location, size: m.size })),
    };

    // Merge onRender via `as any` so TS doesn't validate the missing property.
    // cobe accepts it fine at runtime — it's only absent from the type defs.
    // ── FIX TS(7006): state typed as Record<string,unknown> ──────────
    const config = {
      ...baseConfig,
      onRender: (state: Record<string, unknown>) => {
        if (autoRotate && !isDragging.current) phiRef.current += 0.0025;
        // Write phi back so cobe picks up the rotation each frame
        state["phi"] = phiRef.current;
      },
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    try {
      globeRef.current = createGlobe(canvas, config);
      // Brief delay so first frame paints before spring starts
      setTimeout(() => setReady(true), 80);
    } catch (err) {
      console.error("[Globe] init error:", err);
    }

    return () => {
      if (globeRef.current) {
        try { globeRef.current.destroy(); } catch { /* ignore */ }
        globeRef.current = null;
      }
    };
  }, [isDark, markers, autoRotate, markerColor]);

  // ── ResizeObserver: re-init when container resizes ────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let prevW = container.offsetWidth;

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        if (w > 0 && Math.abs(w - prevW) > 4) {
          prevW = w;
          const canvas = canvasRef.current;
          if (!canvas) return;
          if (globeRef.current) {
            try { globeRef.current.destroy(); } catch { /* ignore */ }
            globeRef.current = null;
          }
          const dpr   = Math.min(window.devicePixelRatio, 2);
          const dark  = document.documentElement.getAttribute("data-theme") === "dark";
          canvas.style.width  = `${w}px`;
          canvas.style.height = `${w}px`;
          try {
            globeRef.current = createGlobe(canvas, {
              ...{
                devicePixelRatio: dpr,
                width:            w * dpr,
                height:           w * dpr,
                phi:              phiRef.current,
                theta:            0.15,
                dark:             dark ? 1 : 0,
                diffuse:          1.2,
                mapSamples:       20_000,
                mapBrightness:    dark ? 1.4 : 8,
                baseColor:        [0.88, 0.88, 0.90] as [number, number, number],
                markerColor,
                glowColor:        [0.90, 0.85, 0.92] as [number, number, number],
                markers:          markers.map(m => ({ location: m.location, size: m.size })),
              },
              onRender: (state: Record<string, unknown>) => {
                if (autoRotate && !isDragging.current) phiRef.current += 0.0025;
                state["phi"] = phiRef.current;
              },
            } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
          } catch { /* ignore */ }
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [markers, autoRotate, markerColor]);

  // ── Pointer drag interaction ──────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    isDragging.current = true;
    lastX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive || !isDragging.current) return;
    phiRef.current += (e.clientX - lastX.current) / 300;
    lastX.current = e.clientX;
  };
  const onPointerUp = () => { isDragging.current = false; };

  return (
    <div ref={containerRef} className={className} style={{ position: "relative", ...style }}>
      {/* Loading spinner — visible until spring fully fades in */}
      {!ready && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            border: "2px solid var(--border)",
            borderTopColor: "var(--shelby-pink, #ff77c9)",
            animation: "globe-spin 1s linear infinite",
          }} />
          <style>{`@keyframes globe-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* React Spring animated canvas — smooth opacity 0→1 */}
      <animated.canvas
        ref={canvasRef}
        style={{
          display:  "block",
          width:    "100%",
          height:   "100%",
          cursor:   interactive ? "grab" : "default",
          opacity:  springStyle.opacity, // driven by useSpring
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </div>
  );
}