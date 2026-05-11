"use client";
// components/ui/globe.tsx — v7.0
//
// Implements the official cobe Next.js sizing pattern:
// https://github.com/shuding/cobe#usage
//
// Key rules that eliminate "drawArrays: no buffer is bound":
//   1. Read canvas.offsetWidth BEFORE createGlobe (via onResize)
//   2. Set canvas.width = width (HTML pixel attr) before init
//   3. Pass width*dpr / height*dpr in initial config
//   4. Inside onRender update state.width/state.height every frame
//      so cobe resizes its own WebGL buffers when the container changes
//   5. Keep phi, width in plain closure vars — NOT in refs inside onRender
//      (refs can read stale values during the sync render loop)
//   6. Never destroy+recreate on theme change — use a darkRef so onRender
//      reads the current value each frame without a re-init
//
// Flicker fix:
//   - The spring only starts after globe.onRender fires for the first time
//     (setReady(true) inside onRender's first call), not on a timeout
//
// npm install cobe @react-spring/web

import { useEffect, useRef, useState } from "react";
import { useSpring, animated }         from "@react-spring/web";
import createGlobe                     from "cobe";
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
  const { isDark }    = useTheme();
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const isDragging    = useRef(false);
  const lastX         = useRef(0);
  const [ready, setReady] = useState(false);

  // React Spring: smooth fade-in driven by setReady
  const spring = useSpring({
    opacity: ready ? 1 : 0,
    config:  { tension: 55, friction: 18 },
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 2, 2);

    // ── Step 1: closure vars (NOT refs) for values used inside onRender ──
    // Plain vars avoid the stale-ref problem inside cobe's sync render loop.
    let phi   = 0;
    let width = 0;
    let firstFrame = true;

    // ── Step 2: resize handler sets canvas.width BEFORE createGlobe ──────
    // This is the official pattern — without it WebGL defaults to 300×150.
    const onResize = () => {
      width = canvas.offsetWidth;
      // Setting canvas.width as HTML attribute resizes the WebGL drawing buffer
      canvas.width  = Math.round(width * dpr);
      canvas.height = Math.round(width * dpr);
    };
    window.addEventListener("resize", onResize);
    onResize(); // run immediately so width > 0 before createGlobe

    // ── Step 3: createGlobe with correct initial dimensions ───────────────
    // onRender absent from some cobe .d.ts → spread + cast `as any`
    // state typed as Record<string,unknown> → satisfies TS(7006)
    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr,
      width:            Math.round(width * dpr),
      height:           Math.round(width * dpr),
      phi:              0,
      theta:            0.15,
      dark:             isDark ? 1 : 0,
      diffuse:          isDark ? 1.4 : 1.2,
      mapSamples:       20_000,
      mapBrightness:    isDark ? 1.4 : 8,
      baseColor:        (isDark ? [0.06, 0.04, 0.03] : [0.88, 0.88, 0.90]) as [number,number,number],
      markerColor,
      glowColor:        (isDark ? [1, 0.47, 0.79] : [0.90, 0.85, 0.92]) as [number,number,number],
      markers:          markers.map(m => ({ location: m.location, size: m.size })),
      // onRender absent from some cobe .d.ts builds → use `as any`
      ...({
        onRender(state: Record<string, unknown>) {
          // ── Step 4: update size every frame so WebGL buffer stays in sync ──
          state["width"]  = Math.round(width * dpr);
          state["height"] = Math.round(width * dpr);

          // Rotate
          if (autoRotate && !isDragging.current) phi += 0.0025;
          state["phi"] = phi;

          // Signal ready on first real frame (eliminates flicker/timeout)
          if (firstFrame) {
            firstFrame = false;
            setReady(true);
          }
        },
      } as any),
    } as any);

    // Pointer interaction
    const onPointerDown = (e: PointerEvent) => {
      if (!interactive) return;
      isDragging.current = true;
      lastX.current = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!interactive || !isDragging.current) return;
      phi += (e.clientX - lastX.current) / 300;
      lastX.current = e.clientX;
    };
    const onPointerUp = () => { isDragging.current = false; };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup",   onPointerUp);
    canvas.addEventListener("pointerleave", onPointerUp);

    return () => {
      globe.destroy();
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup",   onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerUp);
    };
    // Only re-init when props that affect the WebGL config change.
    // isDark is intentionally included — a full reinit is needed to
    // pass new dark/baseColor/glowColor values to createGlobe.
  }, [isDark, markers, autoRotate, interactive, markerColor]);

  return (
    <div className={className} style={{ position: "relative", ...style }}>
      {!ready && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--shelby-pink, #ff77c9)", animation: "gspin 1s linear infinite" }} />
          <style>{`@keyframes gspin{to{transform:rotate(360deg)}}`}</style>
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
      />
    </div>
  );
}