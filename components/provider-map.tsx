// components/provider-map.tsx — SVG world map showing SP distribution by region
"use client";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

interface ProviderMapProps {
  providers: StorageProvider[];
  width?: number;
  height?: number;
}

// Simple dot-matrix world map approximation using SVG paths
// Positions calculated from ZONE_META percentage values
const WORLD_OUTLINE = `M 30 95 Q 25 80 20 70 Q 15 55 18 45 Q 22 35 30 30 Q 38 28 45 32
  Q 55 28 65 30 Q 75 25 85 28 Q 95 30 105 35 Q 120 38 135 42
  Q 150 40 160 45 Q 170 42 178 48 Q 182 55 180 65 Q 175 75 170 85
  Q 165 90 158 92 Q 145 88 135 85 Q 125 82 115 80 Q 105 82 95 85
  Q 85 88 75 92 Q 65 95 55 97 Q 45 98 35 97 Z`;

interface ZoneGroup {
  zone: string;
  label: string;
  shortLabel: string;
  count: number;
  mapX: number;
  mapY: number;
  providers: StorageProvider[];
}

export function ProviderMap({ providers, width = 700, height = 320 }: ProviderMapProps) {
  // Group providers by zone
  const zoneMap = new Map<string, ZoneGroup>();

  providers.forEach(p => {
    const zone = p.availabilityZone ?? "unknown";
    const meta = ZONE_META[zone] ?? { label: zone, shortLabel: "??", mapX: 50, mapY: 50 };

    if (!zoneMap.has(zone)) {
      zoneMap.set(zone, {
        zone,
        label: meta.label,
        shortLabel: meta.shortLabel,
        count: 0,
        mapX: (meta.mapX / 100) * width,
        mapY: (meta.mapY / 100) * height,
        providers: [],
      });
    }
    const g = zoneMap.get(zone)!;
    g.count++;
    g.providers.push(p);
  });

  const zones = Array.from(zoneMap.values());
  const maxCount = Math.max(...zones.map(z => z.count), 1);

  const ACCENT = "#059669";
  const REGION_COLORS = ["#059669", "#3B82F6", "#8B5CF6", "#D97706", "#F97316"];

  return (
    <div style={{ position: "relative", width: "100%", overflow: "hidden" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }}>
        {/* World map background — simple stylized path */}
        <defs>
          <pattern id="dots" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="3" r="1.2" fill="#F0F0F0" />
          </pattern>
        </defs>

        {/* Stylized continents as filled rectangles / ellipses */}
        {/* North America */}
        <ellipse cx={160} cy={130} rx={95} ry={60} fill="url(#dots)" />
        {/* South America */}
        <ellipse cx={205} cy={230} rx={45} ry={60} fill="url(#dots)" />
        {/* Europe */}
        <ellipse cx={360} cy={100} rx={50} ry={40} fill="url(#dots)" />
        {/* Africa */}
        <ellipse cx={365} cy={210} rx={50} ry={70} fill="url(#dots)" />
        {/* Asia */}
        <ellipse cx={520} cy={115} rx={120} ry={60} fill="url(#dots)" />
        {/* Australia */}
        <ellipse cx={565} cy={230} rx={55} ry={38} fill="url(#dots)" />

        {/* Connection lines between zones */}
        {zones.map((z, i) =>
          zones.slice(i + 1).map((z2, j) => (
            <line key={`${i}-${j}`}
              x1={z.mapX} y1={z.mapY} x2={z2.mapX} y2={z2.mapY}
              stroke="#E0E0E0" strokeWidth={1} strokeDasharray="4,4"
            />
          ))
        )}

        {/* Zone markers */}
        {zones.map((z, i) => {
          const color = REGION_COLORS[i % REGION_COLORS.length];
          const radius = 12 + (z.count / maxCount) * 16;

          return (
            <g key={z.zone}>
              {/* Pulse ring */}
              <circle cx={z.mapX} cy={z.mapY} r={radius + 8} fill={color} fillOpacity={0.08} />
              <circle cx={z.mapX} cy={z.mapY} r={radius} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={1.5} />

              {/* Provider dots arranged in a mini-cluster */}
              {z.providers.slice(0, 6).map((_, pi) => {
                const angle = (pi / Math.max(z.providers.length, 1)) * Math.PI * 2 - Math.PI / 2;
                const dr = z.count > 1 ? 6 : 0;
                const dx = Math.cos(angle) * dr;
                const dy = Math.sin(angle) * dr;
                return (
                  <circle key={pi}
                    cx={z.mapX + dx} cy={z.mapY + dy} r={3}
                    fill={color} stroke="#fff" strokeWidth={1}
                  />
                );
              })}

              {/* Count badge */}
              <circle cx={z.mapX + radius - 4} cy={z.mapY - radius + 4} r={9} fill={color} />
              <text x={z.mapX + radius - 4} y={z.mapY - radius + 4}
                textAnchor="middle" dominantBaseline="central"
                fontSize={9} fontWeight={700} fill="#fff"
                fontFamily="'DM Mono', monospace">
                {z.count}
              </text>

              {/* Zone label */}
              <text x={z.mapX} y={z.mapY + radius + 16}
                textAnchor="middle" fontSize={10} fontWeight={600}
                fill={color} fontFamily="'Outfit', sans-serif">
                {z.label}
              </text>
            </g>
          );
        })}

        {/* Empty state */}
        {zones.length === 0 && (
          <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={14} fill="#CCC">
            No provider data available
          </text>
        )}
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "12px 0 0" }}>
        {zones.map((z, i) => (
          <div key={z.zone} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: REGION_COLORS[i % REGION_COLORS.length] }} />
            <span style={{ fontSize: 12, color: "#555" }}>{z.label}</span>
            <span style={{ fontSize: 11, color: "#AAA", fontFamily: "'DM Mono', monospace" }}>×{z.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}