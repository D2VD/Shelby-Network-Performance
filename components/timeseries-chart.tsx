"use client";
/**
 * components/timeseries-chart.tsx — v1.0
 *
 * Replaces the homegrown SVG `SparkLine` component for TabTimeseries only
 * (app/network/page.tsx's OverviewTab and EpochTab-adjacent sparklines are
 * NOT touched by this — scoped intentionally so this is a reviewable,
 * self-contained change rather than a site-wide rewrite).
 *
 * Why eCharts here specifically (not site-wide): this is exactly the case
 * eCharts is built for — real timeseries with zoom/pan/tooltip. It is NOT
 * used for the topology graph (stays D3, already working), the map (stays
 * canvas-based, has its own CF Pages constraints), or any status
 * indicator/table (Quorum-by-AZ, Epoch Countdown, SP Leaderboard) — none of
 * those are chart-grade data and don't need canvas rendering weight.
 *
 * Bug fixed in passing: the old call sites did
 *   data={cd.map(p => p.someField).filter(v => v > 0)}
 * against a SEPARATELY computed `labels = ts.map(p => tLbl(p.tsMs, range))`
 * that was never filtered the same way — so the "first/last" label shown
 * under a sparkline did not reliably correspond to the actually-plotted
 * first/last point whenever any zero values existed in the series. This
 * component takes {tsMs, value} pairs directly, so each plotted point
 * carries its own real timestamp — no parallel array to drift out of sync.
 *
 * Behavior change (disclosed, not silent): previously zero-value points
 * were silently dropped before plotting. This component plots them as real
 * zero dips instead. This is more chronologically honest, but it IS a
 * visible difference from the old sparklines — flagging so it isn't
 * mistaken for a data regression after deploy.
 *
 * Rendered only via next/dynamic(..., { ssr:false }) from page.tsx, matching
 * this project's existing convention for other browser-only visual libs
 * (the map component uses the same pattern for the same CF Pages reasons).
 *
 * Known limitation: CSS theme variables (var(--text-muted) etc.) are
 * resolved via getComputedStyle ONCE on mount, since eCharts renders to
 * canvas and can't consume CSS custom properties directly. If the site's
 * light/dark theme toggle flips at runtime without remounting this
 * component, chart axis/label colors will go stale until next mount. Not
 * fixed here because the actual theme-toggle mechanism (class vs
 * data-attribute vs something else) wasn't in any file provided this
 * session — flagging rather than guessing at it.
 */

import { useEffect, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

export interface TsChartPoint {
  tsMs: number;
  value: number;
}

interface TimeseriesChartProps {
  points: TsChartPoint[];
  color: string;
  height?: number;
  /** Formats values for the tooltip (full precision). Defaults to en-US toLocaleString per project convention. */
  valueFormatter?: (v: number) => string;
  /** Formats values for the Y-axis labels specifically (compact, since axis width scales with label length). Defaults to K/M/G abbreviation. */
  axisLabelFormatter?: (v: number) => string;
}

function defaultFormatter(v: number): string {
  return v.toLocaleString("en-US");
}

// FIX: Y-axis was reusing valueFormatter (full "1,200,000"-style numbers),
// and with grid.containLabel:true that forced eCharts to reserve a wide
// left margin to fit the longest label — the "thick Y-axis" look. Axis
// labels now use a compact K/M/G formatter (matching the old SparkLine's
// fmtV), while the tooltip keeps full-precision valueFormatter — you still
// see the exact number on hover, just not crammed into the axis gutter.
function defaultAxisFormatter(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

/** Reads theme CSS vars once at mount — see "Known limitation" in file header. */
function readThemeColors() {
  if (typeof window === "undefined") {
    return { text: "#8b8b9a", border: "rgba(255,255,255,0.08)" };
  }
  const cs = getComputedStyle(document.documentElement);
  const text   = cs.getPropertyValue("--text-muted").trim()  || "#8b8b9a";
  const border = cs.getPropertyValue("--border").trim()      || "rgba(255,255,255,0.08)";
  return { text, border };
}

export function TimeseriesChart({ points, color, height = 130, valueFormatter = defaultFormatter, axisLabelFormatter = defaultAxisFormatter }: TimeseriesChartProps) {
  const [theme] = useState(readThemeColors); // resolved once on mount, see known limitation above
  const chartRef = useRef<ReactECharts | null>(null);

  useEffect(() => {
    // Resize the chart instance if its container changes size (e.g. sidebar toggle),
    // since echarts doesn't auto-observe layout shifts on its own.
    const handle = () => chartRef.current?.getEchartsInstance().resize();
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);

  if (points.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: theme.text, fontSize: 11 }}>
        No data yet
      </div>
    );
  }

  const option: EChartsOption = {
    backgroundColor: "transparent",
    grid: { left: 4, right: 8, top: 8, bottom: 4, containLabel: true },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { show: false },
      axisLabel: { color: theme.text, fontSize: 9, fontFamily: "monospace" },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.text, fontSize: 9, fontFamily: "monospace", formatter: (v: number) => axisLabelFormatter(v) },
      splitLine: { lineStyle: { color: theme.border, type: "dashed" } },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(20,20,28,0.92)",
      borderColor: theme.border,
      textStyle: { color: "#e5e5ea", fontSize: 11 },
      valueFormatter: (v) => valueFormatter(Number(v)),
    },
    dataZoom: [
      { type: "inside", throttle: 50 },
    ],
    series: [
      {
        type: "line",
        data: points.map((p) => [p.tsMs, p.value]),
        color,
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2 },
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: `${color}33` },
              { offset: 1, color: `${color}00` },
            ],
          },
        },
        emphasis: { focus: "series" },
      },
    ],
  };

  return (
    <ReactECharts
      ref={chartRef}
      option={option}
      style={{ height, width: "100%" }}
      notMerge={true}
      lazyUpdate={true}
      opts={{ renderer: "canvas" }}
    />
  );
}