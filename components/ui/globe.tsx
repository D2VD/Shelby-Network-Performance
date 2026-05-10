"use client";
// components/ui/globe.tsx — v6.0
//
// Root cause of persistent "drawArrays: no buffer" error:
//   cobe INTERNALLY sets canvas.width / canvas.height from config.width /
//   config.height. Pre-setting them ourselves caused a race where cobe's
//   WebGL context was created against a 0-sized buffer.
//
// Correct pattern (from official cobe docs):
//   1. Pass width/height = 0 initially (or skip — cobe defaults gracefully)
//   2. In onRender, update state.width and state.height every frame from
//      the live canvas.offsetWidth * dpr so cobe resizes its own buffer.
//   3. Never manually set canvas.width or canvas.height.
//
// npm install cobe @react-spring/web

import { useEffect, useRef, useState } from "react";
import { useSpring, animated }         from "@react-spring/web";
import createGlobe                     from "cobe";
import type { COBEOptions }            from "cobe";
import { useTheme }                    from "@/components/theme-context";

export interface GlobeMarker {
  location: [number, number];
  size:     number;
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
  markerColor?: [number, number, number];
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
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const phiRef       = useRef(0);
  const isDragging   = useRef(false);
  const lastX        = useRef(0);
  const globeRef     = useRef<{ destroy: () => void } | null>(null);
  const [ready, setReady] = useState(false);

  const spring = useSpring({
    opacity: ready ? 1 : 0,
    config:  { tension: 60, friction: 20 },
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (globeRef.current) {
      try { globeRef.current.destroy(); } catch { /* ignore */ }
      globeRef.current = null;
      setReady(false);
    }

    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 2, 2);

    // ── CORRECT COBE PATTERN ────────────────────────────────────────
    // Pass an initial size so cobe has something to work with.
    // Then update width/height every frame inside onRender so cobe's
    // internal WebGL buffer always matches the live canvas size.
    // NEVER set canvas.width / canvas.height manually.
    const initialSize = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 500;

    const baseConfig: COBEOptions = {
      devicePixelRatio: dpr,
      width:            initialSize * dpr,
      height:           initialSize * dpr,
      phi:              phiRef.current,
      theta:            0.15,
      dark:             isDark ? 1 : 0,
      diffuse:          isDark ? 1.4 : 1.2,
      mapSamples:       20_000,
      mapBrightness:    isDark ? 1.4 : 8,
      baseColor:        (isDark
        ? [0.06, 0.04, 0.03]
        : [0.88, 0.88, 0.90]) as [number, number, number],
      markerColor,
      glowColor:        (isDark
        ? [1, 0.47, 0.79]
        : [0.90, 0.85, 0.92]) as [number, number, number],
      markers: markers.map(m => ({ location: m.location, size: m.size })),
    };

    // onRender absent from some cobe .d.ts → cast via `as any`
    // state typed as Record<string,unknown> to satisfy TS(7006)
    const config = {
      ...baseConfig,
      onRender: (state: Record<string, unknown>) => {
        // Live size update every frame — this is what prevents drawArrays errors
        const w = canvas.offsetWidth || initialSize;
        state["width"]  = w * dpr;
        state["height"] = w * dpr;

        if (autoRotate && !isDragging.current) phiRef.current += 0.0025;
        state["phi"] = phiRef.current;
      },
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    try {
      globeRef.current = createGlobe(canvas, config);
      setTimeout(() => setReady(true), 150);
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
    <div className={className} style={{ position: "relative", ...style }}>
      {!ready && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--shelby-pink, #ff77c9)", animation: "globe-spin 1s linear infinite" }} />
          <style>{`@keyframes globe-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      <animated.canvas
        ref={canvasRef}
        style={{
          display:  "block",
          width:    "100%",
          height:   "100%",
          cursor:   interactive ? "grab" : "default",
          opacity:  spring.opacity,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </div>
  );
}