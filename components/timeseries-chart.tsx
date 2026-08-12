"use client";
/**
 * components/timeseries-chart.tsx — v1.1
 *
 * v1.1 CHANGES (this session):
 *   1. FIX (flat-chart bug): yAxis was missing `scale: true`. Without it,
 *      eCharts' value axis defaults to always including 0 in its range. For
 *      series like activeBlobs — moving between e.g. 1,199,900 and
 *      1,200,800 (a real ~900-unit swing) — the axis was forced to span
 *      roughly [0, 1.2M], making the actual variation ~0.07% of the
 *      visible chart height and rendering as a flat line even though the
 *      underlying data was moving normally. Confirmed via direct Redis
 *      dump of ts:shelbynet:5m showing real incrementing values across
 *      5-minute snapshots. scale:true lets the axis fit tightly to
 *      [min, max] of the actual series instead of forcing a 0 baseline.
 *   2. Axis label font bumped 9px → 10px on both axes (legibility
 *      complaint — labels were reported as too small/faint).
 *   3. NEW: optional `range` prop drives explicit, human-meaningful tick
 *      spacing instead of eCharts' auto interval, per spec:
 *        1h  → 10-minute ticks
 *        24h → 4-hour ticks
 *        7d  → 2-day ticks (falls back to 1-day if the actual point span
 *              is under 4 days, so short/sparse series don't end up with
 *              only 1-2 ticks total)
 *        30d → 1-week ticks
 *      Implemented via xAxis.minInterval/maxInterval pinned to the same
 *      value, which forces exactly that spacing rather than eCharts'
 *      nearest-nice-number heuristic. If `range` is omitted, behavior is
 *      unchanged (eCharts auto-picks interval) — this is purely additive,
 *      existing call sites that don't pass `range` are unaffected.
 *   4. Mobile overlap guard: added axisLabel.hideOverlap:true on the time
 *      axis. eCharts' auto label density is width-aware but can still
 *      double up labels at narrow viewports when combined with a fixed
 *      dataZoom; hideOverlap drops the colliding ones rather than letting
 *      them render on top of each other. Combined with #3 (explicit
 *      interval control), this should also reduce how often overlap is
 *      attempted in the first place — but kept as an explicit backstop
 *      since it wasn't verified against every possible narrow-width case.
 *
 * Everything else below (theme color resolution, resize handling, series/
 * tooltip/dataZoom config, the axisLabelFormatter K/M/G fix) is unchanged
 * from v1.0 — see prior comments preserved inline where still relevant.
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
 * Bug fixed in passing (v1.0): the old call sites did
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

/** Matches the TimeRange type used by call sites (network/page.tsx, dashboard/charts/page.tsx). Duplicated here rather than imported to keep this a standalone, dependency-light component. */
export type TsRange = "1h" | "24h" | "7d" | "30d";

interface TimeseriesChartProps {
  points: TsChartPoint[];
  color: string;
  height?: number;
  /** Formats values for the tooltip (full precision). Defaults to en-US toLocaleString per project convention. */
  valueFormatter?: (v: number) => string;
  /** Formats values for the Y-axis labels specifically (compact, since axis width scales with label length). Defaults to K/M/G abbreviation. */
  axisLabelFormatter?: (v: number) => string;
  /**
   * Optional. When provided, pins the x-axis tick spacing to a fixed,
   * human-meaningful interval for that range instead of eCharts' auto
   * interval (see RANGE_TICK_MS below). Omit to keep eCharts' default
   * auto-interval behavior (used by any call site that doesn't care about
   * this, e.g. ad-hoc mini charts with no fixed range concept).
   */
  range?: TsRange;
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

// ── Tick interval logic (v1.1) ──────────────────────────────────────────
// Base spacing per range, in ms. "7d" has a documented special case below.
const RANGE_TICK_MS: Record<TsRange, number> = {
  "1h": 10 * 60 * 1000,              // 10 minutes
  "24h": 4 * 60 * 60 * 1000,         // 4 hours
  "7d": 2 * 24 * 60 * 60 * 1000,     // 2 days (see fallback below)
  "30d": 7 * 24 * 60 * 60 * 1000,    // 1 week
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves the tick spacing (ms) for a given range + actual data span.
 * Returns undefined when `range` isn't provided, meaning "let eCharts
 * auto-decide" (preserves old behavior for any caller that omits it).
 */
function resolveTickInterval(range: TsRange | undefined, points: TsChartPoint[]): number | undefined {
  if (!range) return undefined;
  let ms = RANGE_TICK_MS[range];
  // Spec: 7d falls back to 1-day ticks when the actual point span is under
  // 4 days — otherwise a sparse/short 7d series could end up with only
  // 1-2 ticks total, which isn't useful.
  if (range === "7d" && points.length > 1) {
    const span = points[points.length - 1].tsMs - points[0].tsMs;
    if (span < 4 * DAY_MS) ms = DAY_MS;
  }
  return ms;
}

/**
 * Axis label date/time format, chosen per range so short ranges show
 * time-of-day (HH:mm) and longer ranges show a date (M/D) — matches the
 * existing tLbl() convention used elsewhere in the project for the same
 * range buckets.
 */
function resolveAxisLabelFormat(range: TsRange | undefined): string {
  if (range === "1h" || range === "24h") return "{HH}:{mm}";
  return "{M}/{d}";
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

export function TimeseriesChart({
  points,
  color,
  height = 130,
  valueFormatter = defaultFormatter,
  axisLabelFormatter = defaultAxisFormatter,
  range,
}: TimeseriesChartProps) {
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

  // FIX: eCharts' default yAxis.splitNumber (~5) was crowding short charts —
  // the Pending/Deleted mini charts render at height:80, so 5-6 gridlines
  // (each with a label) left almost no vertical gap between them. Scale tick
  // count to actual pixel height instead of using one fixed number for every
  // chart size on the page.
  const ySplitNumber = height < 100 ? 2 : height < 150 ? 3 : 4;

  const tickInterval = resolveTickInterval(range, points);
  const axisLabelFormat = resolveAxisLabelFormat(range);

  const option: EChartsOption = {
    backgroundColor: "transparent",
    grid: { left: 4, right: 8, top: 8, bottom: 4, containLabel: true },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { show: false },
      axisLabel: {
        color: theme.text,
        fontSize: 10,           // was 9 — legibility fix
        fontFamily: "monospace",
        formatter: axisLabelFormat,
        hideOverlap: true,      // mobile overlap guard — drops colliding labels instead of stacking them
      },
      splitLine: { show: false },
      // Pinning min and max interval to the same value forces exactly that
      // spacing rather than eCharts' nearest-nice-number auto heuristic.
      // Omitted entirely (both stay undefined) when `range` isn't passed,
      // preserving old auto-interval behavior for those callers.
      ...(tickInterval ? { minInterval: tickInterval, maxInterval: tickInterval } : {}),
    },
    yAxis: {
      type: "value",
      scale: true,   // FIX (flat-chart bug): without this, eCharts forces the axis
                      // to include 0, making small deltas on large absolute values
                      // (e.g. active blob count moving by a few hundred out of 1.2M)
                      // render as a flat line. scale:true fits the axis tightly to
                      // the real [min, max] of the series instead.
      splitNumber: ySplitNumber,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: theme.text,
        fontSize: 10,           // was 9 — legibility fix
        fontFamily: "monospace",
        formatter: (v: number) => axisLabelFormatter(v),
      },
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