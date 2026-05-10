"use client";
// components/ui/globe.tsx — v5.0
//
// Root cause of "drawArrays: no buffer is bound to enabled attribute":
//   cobe reads canvas.width / canvas.height (HTML pixel attributes) to
//   create its WebGL framebuffer. Setting only canvas.style.width/height
//   (CSS) does NOT resize the WebGL drawing buffer — cobe still sees the
//   default 300×150 canvas and renders into a mismatched buffer.
//
// Fix: set canvas.width = size * dpr  AND  canvas.height = size * dpr
//      as HTML attributes BEFORE calling createGlobe().
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
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const phiRef       = useRef(0);
  const isDragging   = useRef(false);
  const lastX        = useRef(0);
  const globeRef     = useRef<{ destroy: () => void } | null>(null);
  const [ready, setReady] = useState(false);

  // React Spring: smooth 0→1 opacity on first render
  const spring = useSpring({
    opacity: ready ? 1 : 0,
    config:  { tension: 60, friction: 20 },
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;

    // Destroy previous instance
    if (globeRef.current) {
      try { globeRef.current.destroy(); } catch { /* ignore */ }
      globeRef.current = null;
      setReady(false);
    }

    // Wait one frame so the container has its final layout dimensions
    const raf = requestAnimationFrame(() => {
      const size = container.getBoundingClientRect().width || container.offsetWidth || 400;
      const dpr  = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 2, 2);
      const px   = Math.round(size * dpr);

      // ── KEY FIX ───────────────────────────────────────────────────
      // Set the HTML pixel attributes so WebGL framebuffer matches.
      // CSS size alone does NOT resize the WebGL drawing buffer.
      canvas.width  = px;
      canvas.height = px;
      // CSS size so it fills the container visually
      canvas.style.width  = `${size}px`;
      canvas.style.height = `${size}px`;

      const baseConfig: COBEOptions = {
        devicePixelRatio: dpr,
        width:            px,
        height:           px,
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

      // onRender absent from some cobe .d.ts versions → cast via any
      const config = {
        ...baseConfig,
        onRender: (state: Record<string, unknown>) => {
          if (autoRotate && !isDragging.current) phiRef.current += 0.0025;
          state["phi"] = phiRef.current;
        },
      } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      try {
        globeRef.current = createGlobe(canvas, config);
        setTimeout(() => setReady(true), 100);
      } catch (err) {
        console.error("[Globe] init error:", err);
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      if (globeRef.current) {
        try { globeRef.current.destroy(); } catch { /* ignore */ }
        globeRef.current = null;
      }
    };
  }, [isDark, markers, autoRotate, markerColor]);

  // ResizeObserver — re-init when container resizes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let prevW = 0;

    const ro = new ResizeObserver(() => {
      const w = Math.round(container.getBoundingClientRect().width);
      if (w > 0 && Math.abs(w - prevW) > 8) {
        prevW = w;
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (globeRef.current) {
          try { globeRef.current.destroy(); } catch { /* ignore */ }
          globeRef.current = null;
        }
        const dpr  = Math.min(window.devicePixelRatio, 2);
        const px   = Math.round(w * dpr);
        const dark = document.documentElement.getAttribute("data-theme") === "dark";

        // Set pixel attributes here too
        canvas.width  = px;
        canvas.height = px;
        canvas.style.width  = `${w}px`;
        canvas.style.height = `${w}px`;

        try {
          globeRef.current = createGlobe(canvas, {
            ...{
              devicePixelRatio: dpr,
              width:            px,
              height:           px,
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
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, [markers, autoRotate, markerColor]);

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
      {!ready && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--shelby-pink, #ff77c9)", animation: "globe-spin 1s linear infinite" }} />
          <style>{`@keyframes globe-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      <animated.canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", cursor: interactive ? "grab" : "default", opacity: spring.opacity }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </div>
  );
}