"use client";
// components/ui/globe.tsx — v9.0
//
// Strategy: destroy + reinitialize cobe on every size change.
// No state.width/state.height mutation inside onRender.
//
// Why this is more reliable in production:
//   Mutating state.width/height inside onRender works in dev (single React
//   root, predictable RAF timing) but in production builds cobe's internal
//   WebGL program can be compiled before the first onRender fires, leaving
//   the VAO in a mismatched state → "drawArrays: no buffer is bound".
//   Destroy + reinit means createGlobe always receives the exact, measured
//   canvas size so its WebGL context is created correctly from frame zero.
//
// Sizing guarantee:
//   We read size ONLY from ResizeObserver.contentRect (never offsetWidth on
//   mount), so the value is always post-layout and always > 0.
//
// npm install cobe @react-spring/web

import { useEffect, useRef, useState, useCallback } from "react";
import { useSpring, animated }                       from "@react-spring/web";
import createGlobe                                   from "cobe";
import { useTheme }                                  from "@/components/theme-context";

// ── Public types ───────────────────────────────────────────────────
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
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const spring = useSpring({
    opacity: ready ? 1 : 0,
    config: { tension: 55, friction: 18 },
  });

  // Stable refs so the destroy+reinit callback always sees fresh prop values
  const phiRef         = useRef(0);          // preserved across reinits
  const isDragging     = useRef(false);
  const lastX          = useRef(0);
  const isDarkRef      = useRef(isDark);
  const markersRef     = useRef(markers);
  const markerColorRef = useRef(markerColor);
  const autoRotateRef  = useRef(autoRotate);
  isDarkRef.current      = isDark;
  markersRef.current     = markers;
  markerColorRef.current = markerColor;
  autoRotateRef.current  = autoRotate;

  // ── Core: create one cobe instance for a given pixel size ─────────
  // Returns a cleanup function. Called by ResizeObserver and theme effect.
  const createInstance = useCallback((canvas: HTMLCanvasElement, cssSize: number) => {
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 2, 2);
    const px  = Math.round(cssSize * dpr);

    // Set canvas HTML pixel attributes BEFORE createGlobe.
    // This is what sizes the WebGL framebuffer — CSS alone does nothing.
    canvas.width  = px;
    canvas.height = px;

    let phi       = phiRef.current; // resume from last known rotation
    let firstFrame = true;

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
      markers: markersRef.current.map(m => ({ location: m.location, size: m.size })),
      // NO state.width/state.height mutation — dimensions are fixed at init
      ...({
        onRender(state: Record<string, unknown>) {
          if (autoRotateRef.current && !isDragging.current) phi += 0.0025;
          state["phi"] = phi;
          // Save so next instance resumes from here
          phiRef.current = phi;

          if (firstFrame) {
            firstFrame = false;
            setReady(true);
          }
        },
      } as any), // eslint-disable-line @typescript-eslint/no-explicit-any
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Pointer listeners
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

    // Return cleanup
    return () => {
      globe.destroy();
      canvas.removeEventListener("pointerdown",  onDown);
      canvas.removeEventListener("pointermove",  onMove);
      canvas.removeEventListener("pointerup",    onUp);
      canvas.removeEventListener("pointerleave", onUp);
    };
  }, []); // intentionally empty — reads all values via refs

  // ── Effect 1: ResizeObserver drives init + resize ─────────────────
  // Fires AFTER layout is computed → cssSize always > 0
  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;

    let cleanup: (() => void) | null = null;
    let lastSize = 0;

    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const cssSize = Math.round(entry.contentRect.width);
      if (cssSize <= 0) return;
      // Debounce: only reinit if size changed meaningfully
      if (Math.abs(cssSize - lastSize) < 2) return;
      lastSize = cssSize;

      // Destroy previous, create new
      if (cleanup) { cleanup(); cleanup = null; }
      setReady(false);
      cleanup = createInstance(canvas, cssSize);
    });

    ro.observe(container);

    return () => {
      ro.disconnect();
      if (cleanup) cleanup();
      setReady(false);
    };
  }, [createInstance]);

  // ── Effect 2: reinit on theme / markers / markerColor change ──────
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const cssSize = Math.round(container.getBoundingClientRect().width);
    if (cssSize <= 0) return; // ResizeObserver hasn't fired yet — it will handle init

    setReady(false);
    const cleanup = createInstance(canvas, cssSize);
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
      <animated.canvas
        ref={canvasRef}
        style={{
          display: "block",
          width:   "100%",
          height:  "100%",
          cursor:  interactive ? "grab" : "default",
          opacity: spring.opacity, // Bây giờ 'spring' đã được định nghĩa
        }}
      />
    </div>
  );
}

