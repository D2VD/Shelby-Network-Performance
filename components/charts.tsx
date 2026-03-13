// components/charts.tsx — Reusable SVG chart components (no dependencies)
"use client";

// ── Line Chart ────────────────────────────────────────────────────────────────
interface LineChartProps {
  data: number[];
  color?: string;
  height?: number;
  fill?: boolean;
  unit?: string;
}

export function LineChart({ data, color = "#059669", height = 140, fill = true }: LineChartProps) {
  if (data.length < 2) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#CCC", fontSize: 13 }}>
        Collecting data…
      </div>
    );
  }

  const W = 560, H = height;
  const pad = { t: 12, b: 8, l: 40, r: 10 };
  const iW = W - pad.l - pad.r;
  const iH = H - pad.t - pad.b;

  const min   = Math.min(...data);
  const max   = Math.max(...data);
  const range = max - min || 1;

  const xs = data.map((_, i) => pad.l + (i / (data.length - 1)) * iW);
  const ys = data.map(v => pad.t + iH - ((v - min) / range) * iH);

  const linePts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const areaPts = `${pad.l},${pad.t + iH} ${linePts} ${(pad.l + iW).toFixed(1)},${pad.t + iH}`;
  const gradId  = `g${color.replace("#", "")}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height, display: "block" }}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0}    />
        </linearGradient>
      </defs>

      {/* Grid */}
      {[0, 0.5, 1].map(f => {
        const y = pad.t + iH - f * iH;
        return (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#F4F4F4" />
            <text x={pad.l - 5} y={y + 3} textAnchor="end" fontSize={9} fill="#CCC">
              {Math.round(min + f * range)}
            </text>
          </g>
        );
      })}

      {/* Fill */}
      {fill && <polygon points={areaPts} fill={`url(#${gradId})`} />}

      {/* Line */}
      <polyline points={linePts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />

      {/* Last point dot */}
      {xs.length > 0 && (
        <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={4} fill={color} stroke="#fff" strokeWidth={2} />
      )}
    </svg>
  );
}

// ── Mini Sparkline Bar ────────────────────────────────────────────────────────
interface MiniBarProps {
  data: number[];
  color?: string;
}

export function MiniBar({ data, color = "#059669" }: MiniBarProps) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 22 }}>
      {data.map((v, i) => (
        <div key={i} style={{
          width: 3,
          height: `${(v / max) * 100}%`,
          minHeight: 2,
          background: color,
          borderRadius: 1,
          opacity: 0.4 + (i / data.length) * 0.6,
        }} />
      ))}
    </div>
  );
}

// ── Radar Chart ───────────────────────────────────────────────────────────────
interface RadarSeries {
  label: string;
  color: string;
  values: number[]; // 0–100 for each dimension
}

interface RadarChartProps {
  dimensions: string[];
  series: RadarSeries[];
  size?: number;
}

export function RadarChart({ dimensions, series, size = 220 }: RadarChartProps) {
  if (!dimensions.length || !series.length) return null;

  const cx = size / 2, cy = size / 2, R = size * 0.38;
  const n = dimensions.length;
  const angle = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2;

  const pt = (i: number, val: number) => {
    const r = (val / 100) * R;
    return `${(cx + Math.cos(angle(i)) * r).toFixed(1)},${(cy + Math.sin(angle(i)) * r).toFixed(1)}`;
  };

  const gridPt = (i: number, frac: number) => {
    const r = frac * R;
    return `${(cx + Math.cos(angle(i)) * r).toFixed(1)},${(cy + Math.sin(angle(i)) * r).toFixed(1)}`;
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", height: size }}>
      {/* Grid rings */}
      {[0.25, 0.5, 0.75, 1].map(g => (
        <polygon key={g}
          points={Array.from({ length: n }, (_, i) => gridPt(i, g)).join(" ")}
          fill="none" stroke="#F0F0F0" strokeWidth={1}
        />
      ))}

      {/* Axis lines */}
      {dimensions.map((_, i) => (
        <line key={i}
          x1={cx} y1={cy}
          x2={parseFloat(gridPt(i, 1).split(",")[0])}
          y2={parseFloat(gridPt(i, 1).split(",")[1])}
          stroke="#E8E8E8" strokeWidth={1}
        />
      ))}

      {/* Series polygons */}
      {series.map((s, si) => (
        <polygon key={si}
          points={s.values.map((v, i) => pt(i, v)).join(" ")}
          fill={s.color + "18"} stroke={s.color} strokeWidth={si === 0 ? 2 : 1.5}
        />
      ))}

      {/* Dimension labels */}
      {dimensions.map((dim, i) => {
        const labelR = R + 16;
        const x = (cx + Math.cos(angle(i)) * labelR).toFixed(1);
        const y = (cy + Math.sin(angle(i)) * labelR).toFixed(1);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#888">
            {dim}
          </text>
        );
      })}
    </svg>
  );
}

// ── Score History ─────────────────────────────────────────────────────────────
interface HistoryPoint { run: number; score: number }

export function ScoreHistoryChart({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) {
    return (
      <div style={{ height: 170, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#CCC" }}>
        <span style={{ fontSize: 28 }}>📈</span>
        <span style={{ fontSize: 13 }}>Run again to see trend</span>
      </div>
    );
  }

  const W = 400, H = 170;
  const pad = { t: 10, b: 24, l: 28, r: 8 };
  const iW = W - pad.l - pad.r;
  const iH = H - pad.t - pad.b;

  const xs = history.map((_, i) => pad.l + (i / (history.length - 1)) * iW);
  const ys = history.map(d => pad.t + iH - (d.score / 100) * iH);

  const linePts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const areaPts = `${pad.l},${pad.t + iH} ${linePts} ${(pad.l + iW).toFixed(1)},${pad.t + iH}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 170 }}>
      <defs>
        <linearGradient id="score-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor="#059669" stopOpacity={0.15} />
          <stop offset="100%" stopColor="#059669" stopOpacity={0}    />
        </linearGradient>
      </defs>

      {[0, 25, 50, 75, 100].map(v => {
        const y = pad.t + iH - (v / 100) * iH;
        return (
          <g key={v}>
            <line x1={pad.l} x2={pad.l + iW} y1={y} y2={y} stroke="#F4F4F4" />
            <text x={pad.l - 4} y={y + 3} textAnchor="end" fontSize={8} fill="#CCC">{v}</text>
          </g>
        );
      })}

      <polygon points={areaPts} fill="url(#score-grad)" />
      <polyline points={linePts} fill="none" stroke="#059669" strokeWidth={2} strokeLinejoin="round" />

      {xs.map((x, i) => (
        <g key={i}>
          <circle cx={x} cy={ys[i]} r={4} fill="#059669" stroke="#fff" strokeWidth={2} />
          <text x={x} y={pad.t + iH + 13} textAnchor="middle" fontSize={8} fill="#CCC">
            #{history[i].run}
          </text>
        </g>
      ))}
    </svg>
  );
}