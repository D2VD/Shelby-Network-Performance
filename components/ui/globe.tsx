"use client";
// components/ui/globe.tsx — v8.0
//
// DEFINITIVE FIX for "drawArrays: no buffer is bound to enabled attribute"
//
// Root cause (confirmed):
//   canvas.offsetWidth = 0 when the element uses CSS % sizing and layout
//   hasn't been computed yet. createGlobe receives width=0, WebGL creates
//   a 0-size framebuffer, every drawArrays call fails.
//
// The fix: NEVER read offsetWidth synchronously on mount.
//   Instead, call createGlobe ONLY inside the ResizeObserver callback,
//   which fires AFTER the browser has computed layout (guaranteed > 0).
//   Set canvas.width / canvas.height as HTML attributes before init.
//   Update state.width / state.height every frame via onRender.
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
  const { isDark }     = useTheme();
  const containerRef   = useRef<HTMLDivElement>(null);
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const isDragging     = useRef(false);
  const lastX          = useRef(0);
  const globeRef       = useRef<{ destroy: () => void } | null>(null);
  const [ready, setReady] = useState(false);

  const spring = useSpring({
    opacity: ready ? 1 : 0,
    config:  { tension: 55, friction: 18 },
  });

  // Keep latest prop values accessible inside the closure without re-creating globe
  const autoRotateRef  = useRef(autoRotate);
  const isDarkRef      = useRef(isDark);
  const markerColorRef = useRef(markerColor);
  const markersRef     = useRef(markers);
  autoRotateRef.current  = autoRotate;
  isDarkRef.current      = isDark;
  markerColorRef.current = markerColor;
  markersRef.current     = markers;

  const initGlobe = useCallback(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;

    // Destroy previous instance
    if (globeRef.current) {
      try { globeRef.current.destroy(); } catch { /* ignore */ }
      globeRef.current = null;
    }

    const dpr   = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 2, 2);
    // Use container rect — guaranteed non-zero inside ResizeObserver
    const rect  = container.getBoundingClientRect();
    const size  = Math.round(rect.width || rect.height || 500);
    const px    = Math.round(size * dpr);

    // Set HTML pixel attributes BEFORE createGlobe — this sizes the WebGL buffer
    canvas.width  = px;
    canvas.height = px;

    // Closure vars for onRender (no stale refs)
    let phi         = 0;
    let currentPx   = px;
    let firstFrame  = true;

    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr,
      width:            px,
      height:           px,
      phi:              0,
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
      markers:          markersRef.current.map(m => ({ location: m.location, size: m.size })),
      // onRender absent from some cobe .d.ts → `as any`
      ...({
        onRender(state: Record<string, unknown>) {
          // Keep WebGL buffer size in sync with canvas
          state["width"]  = currentPx;
          state["height"] = currentPx;

          if (autoRotateRef.current && !isDragging.current) phi += 0.0025;
          state["phi"] = phi;

          if (firstFrame) { firstFrame = false; setReady(true); }
        },
      } as any),
    } as any);

    globeRef.current = globe;

    // Expose currentPx updater so ResizeObserver can update it without re-init
    (globeRef as any)._updateSize = (newPx: number) => { currentPx = newPx; };

    // Pointer interaction
    const onDown  = (e: PointerEvent) => {
      if (!interactive) return;
      isDragging.current = true;
      lastX.current = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove  = (e: PointerEvent) => {
      if (!interactive || !isDragging.current) return;
      phi += (e.clientX - lastX.current) / 300;
      lastX.current = e.clientX;
    };
    const onUp    = () => { isDragging.current = false; };

    canvas.addEventListener("pointerdown",  onDown);
    canvas.addEventListener("pointermove",  onMove);
    canvas.addEventListener("pointerup",    onUp);
    canvas.addEventListener("pointerleave", onUp);

    // Store cleanup in a way the ResizeObserver teardown can call it
    (globeRef as any)._cleanup = () => {
      canvas.removeEventListener("pointerdown",  onDown);
      canvas.removeEventListener("pointermove",  onMove);
      canvas.removeEventListener("pointerup",    onUp);
      canvas.removeEventListener("pointerleave", onUp);
    };
  }, []); // stable — reads all props via refs

  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;

    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 2, 2);
    let initialized = false;

    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const size  = Math.round(entry.contentRect.width);
      if (size <= 0) return;
      const px = Math.round(size * dpr);

      if (!initialized) {
        // First real size — init globe
        initialized = true;
        canvas.width  = px;
        canvas.height = px;
        initGlobe();
      } else {
        // Subsequent resize — update canvas attrs and notify onRender
        canvas.width  = px;
        canvas.height = px;
        if ((globeRef as any)._updateSize) (globeRef as any)._updateSize(px);
      }
    });

    ro.observe(container);

    return () => {
      ro.disconnect();
      if ((globeRef as any)._cleanup) (globeRef as any)._cleanup();
      if (globeRef.current) {
        try { globeRef.current.destroy(); } catch { /* ignore */ }
        globeRef.current = null;
      }
      setReady(false);
    };
  }, [initGlobe]);

  // Re-init when theme or markers change (need new cobe config values)
  useEffect(() => {
    if (!globeRef.current) return; // not initialized yet, ResizeObserver will handle it
    // Destroy + re-init with new dark/markers config
    if ((globeRef as any)._cleanup) (globeRef as any)._cleanup();
    setReady(false);
    initGlobe();
  }, [isDark, markers, markerColor, initGlobe]);

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
          width:   "100%",
          height:  "100%",
          cursor:  interactive ? "grab" : "default",
          opacity: spring.opacity,
        }}
      />
    </div>
  );
}