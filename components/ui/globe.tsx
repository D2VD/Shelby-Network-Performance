"use client";
// components/ui/globe.tsx — v10.0
//
// BUG FOUND (v8/v9): `spring` was referenced in JSX but `useSpring` was called
// inside `useLocalSpring()` which was defined AFTER the `return` statement.
// Hooks after `return` never execute → `spring` = undefined → runtime crash
// in production → globe never renders, spinner stays forever.
//
// Fix: `useSpring` called at the top level of the component, before `return`.
//
// Architecture:
//   - ResizeObserver fires after layout (guarantees cssSize > 0)
//   - On first fire: createGlobe with measured size
//   - On resize: destroy + recreate (no frame-level state mutation)
//   - On theme/markers change: destroy + recreate via separate effect
//   - phi preserved across recreations so globe doesn't snap
//
// npm install cobe @react-spring/web

import { useEffect, useRef, useState, useCallback } from "react";
import { useSpring, animated }                       from "@react-spring/web";
import createGlobe                                   from "cobe";
import { useTheme }                                  from "@/components/theme-context";

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

  // ── CORRECT: useSpring at top level, before return ────────────────
  const [ready, setReady] = useState(false);
  const spring = useSpring({
    opacity: ready ? 1 : 0,
    config:  { tension: 55, friction: 18 },
  });

  // Stable refs so createInstance closure always reads latest props
  const isDarkRef      = useRef(isDark);
  const markersRef     = useRef(markers);
  const markerColorRef = useRef(markerColor);
  const autoRotateRef  = useRef(autoRotate);
  isDarkRef.current      = isDark;
  markersRef.current     = markers;
  markerColorRef.current = markerColor;
  autoRotateRef.current  = autoRotate;

  // ── Create one cobe instance for a given CSS pixel size ───────────
  // Returns a cleanup fn. cssSize must be > 0 (enforced by callers).
  const createInstance = useCallback(
    (canvas: HTMLCanvasElement, cssSize: number): (() => void) => {
      const dpr = Math.min(
        typeof window !== "undefined" ? window.devicePixelRatio : 2,
        2
      );
      const px = Math.round(cssSize * dpr);

      // Set HTML attributes before createGlobe — sizes the WebGL framebuffer.
      // CSS width/height alone does NOT resize the WebGL drawing buffer.
      canvas.width  = px;
      canvas.height = px;

      // Closure var for phi — NOT a ref, so onRender reads it synchronously
      let phi       = phiRef.current;
      let firstFrame = true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const globe = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width:            px,
        height:           px,
        phi,
        theta:            0.15,
        dark:             isDarkRef.current ? 1 : 0,
        diffuse:          isDarkRef.current ? 1.4 : 1.2,
        mapSamples:       20_000,
        mapBrightness:    isDarkRef.current ? 1.4 : 8,
        baseColor:        (isDarkRef.current
          ? [0.06, 0.04, 0.03]
          : [0.88, 0.88, 0.90]) as [number, number, number],
        markerColor:      markerColorRef.current,
        glowColor:        (isDarkRef.current
          ? [1, 0.47, 0.79]
          : [0.90, 0.85, 0.92]) as [number, number, number],
        markers:          markersRef.current.map(m => ({
          location: m.location,
          size:     m.size,
        })),
        // onRender: only update phi — NO width/height mutation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ onRender(state: Record<string, unknown>) {
          if (autoRotateRef.current && !isDragging.current) phi += 0.0025;
          state["phi"]  = phi;
          phiRef.current = phi; // persist across reinits

          if (firstFrame) {
            firstFrame = false;
            setReady(true);
          }
        } } as any),
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      // Pointer events
      const onDown = (e: PointerEvent) => {
        if (!interactive) return;
        isDragging.current = true;
        lastX.current = e.clientX;
        canvas.setPointerCapture(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        if (!interactive || !isDragging.current) return;
        phi += (e.clientX - lastX.current) / 300;
        lastX.current = e.clientX;
      };
      const onUp = () => { isDragging.current = false; };

      canvas.addEventListener("pointerdown",  onDown);
      canvas.addEventListener("pointermove",  onMove);
      canvas.addEventListener("pointerup",    onUp);
      canvas.addEventListener("pointerleave", onUp);

      return () => {
        globe.destroy();
        canvas.removeEventListener("pointerdown",  onDown);
        canvas.removeEventListener("pointermove",  onMove);
        canvas.removeEventListener("pointerup",    onUp);
        canvas.removeEventListener("pointerleave", onUp);
      };
    },
    [] // stable — all values via refs
  );

  // ── Effect 1: ResizeObserver — init + handle resizes ─────────────
  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;

    let cleanup:  (() => void) | null = null;
    let lastSize: number = 0;

    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w <= 0 || Math.abs(w - lastSize) < 2) return;
      lastSize = w;

      // Destroy previous, create new with correct size
      if (cleanup) { cleanup(); cleanup = null; setReady(false); }
      cleanup = createInstance(canvas, w);
    });

    ro.observe(container);

    return () => {
      ro.disconnect();
      if (cleanup) cleanup();
      setReady(false);
    };
  }, [createInstance]);

  // ── Effect 2: reinit on theme / markers / markerColor ─────────────
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const w = Math.round(container.getBoundingClientRect().width);
    if (w <= 0) return; // ResizeObserver will handle first init

    setReady(false);
    const cleanup = createInstance(canvas, w);
    return cleanup;
  }, [isDark, markers, markerColor, createInstance]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className={className} style={{ position: "relative", ...style }}>
      {!ready && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            border: "2px solid var(--border)",
            borderTopColor: "var(--shelby-pink, #ff77c9)",
            animation: "gspin 1s linear infinite",
          }} />
          <style>{`@keyframes gspin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      {/* spring.opacity is always defined — useSpring called at top level */}
      <animated.canvas
        ref={canvasRef}
        style={{
          display: "block",
          width:   "100%",
          height:  "100%",
          cursor:  interactive ? "grab" : "default",
          opacity: spring.opacity,
        }}
      />
    </div>
  );
}