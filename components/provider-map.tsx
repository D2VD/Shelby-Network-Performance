// components/provider-map.tsx
"use client";
import type { StorageProvider } from "@/lib/types";

interface ProviderMapProps {
  providers: StorageProvider[];
  width?: number;
  height?: number;
}

// Định nghĩa kiểu dữ liệu rõ ràng để tránh lỗi implicit 'any'
interface ZoneGroup {
  zone: string;
  label: string;
  count: number;
  mapX: number;
  mapY: number;
  providers: StorageProvider[];
}

// Tọa độ chuẩn hóa cho ViewBox 1000x500 của bản đồ SVG mới
const MAP_COORDS: Record<string, { label: string; x: number; y: number }> = {
  dc_asia:       { label: "Asia",      x: 770, y: 260 },
  dc_australia:  { label: "Australia", x: 860, y: 390 },
  dc_europe:     { label: "Europe",    x: 490, y: 140 },
  dc_us_east:    { label: "US East",   x: 270, y: 170 },
  dc_us_west:    { label: "US West",   x: 160, y: 170 },
};

export function ProviderMap({ providers, width = 1000, height = 500 }: ProviderMapProps) {
  // Sử dụng Interface đã định nghĩa thay vì 'any'
  const zoneMap = new Map<string, ZoneGroup>();

  providers.forEach(p => {
    const zone = p.availabilityZone ?? "unknown";
    const meta = MAP_COORDS[zone] ?? { label: zone, x: 500, y: 250 };

    if (!zoneMap.has(zone)) {
      zoneMap.set(zone, {
        zone, 
        label: meta.label, 
        count: 0,
        mapX: meta.x,
        mapY: meta.y,
        providers:[],
      });
    }
    const g = zoneMap.get(zone)!;
    g.count++;
    g.providers.push(p);
  });

  const zones = Array.from(zoneMap.values());
  const maxCount = Math.max(...zones.map(z => z.count), 1);
  const REGION_COLORS =["#059669", "#3B82F6", "#8B5CF6", "#D97706", "#F97316"];

  return (
    <div style={{ position: "relative", width: "100%", overflow: "hidden", background: "#F8FAFC", borderRadius: 16, border: "1px solid #E2E8F0" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
        
        {/* Bản đồ Thế giới (World Map SVG Path - Simplified & Lightweight) */}
        <g fill="#CBD5E1" stroke="#F8FAFC" strokeWidth="0.5">
          {/* North America */}
          <path d="M100,80 Q150,50 250,60 T350,100 Q320,150 280,200 T200,220 Q150,180 120,150 Z" />
          {/* South America */}
          <path d="M250,230 Q300,250 320,300 T280,450 Q250,400 230,300 Z" />
          {/* Europe & Asia */}
          <path d="M400,120 Q450,80 550,60 T750,50 T850,100 Q880,150 800,200 T650,250 T500,200 T420,180 Z" />
          {/* Africa */}
          <path d="M420,200 Q480,180 550,220 T520,350 Q480,400 450,300 Z" />
          {/* Australia */}
          <path d="M800,350 Q850,320 900,350 T880,420 Q820,400 800,350 Z" />
          {/* Japan & Islands */}
          <path d="M850,150 Q860,130 870,160 Z" />
          <path d="M750,280 Q780,270 800,300 Z" />
        </g>

        {/* 🇻🇳 KHẲNG ĐỊNH CHỦ QUYỀN: Quần đảo Hoàng Sa và Trường Sa */}
        <g>
          {/* Hoàng Sa (Paracel Islands) */}
          <circle cx="765" cy="235" r="2" fill="#059669" />
          <circle cx="768" cy="237" r="1.5" fill="#059669" />
          <text x="772" y="238" fontSize="8" fill="#64748B" fontFamily="sans-serif">Hoàng Sa (VN)</text>
          
          {/* Trường Sa (Spratly Islands) */}
          <circle cx="772" cy="255" r="2" fill="#059669" />
          <circle cx="775" cy="258" r="1.5" fill="#059669" />
          <circle cx="770" cy="260" r="1.5" fill="#059669" />
          <text x="778" y="260" fontSize="8" fill="#64748B" fontFamily="sans-serif">Trường Sa (VN)</text>
        </g>

        {/* Các đường nối giữa các Data Center */}
        {zones.map((z, i) =>
          zones.slice(i + 1).map((z2, j) => (
            <path key={`${i}-${j}`}
              d={`M ${z.mapX} ${z.mapY} Q ${(z.mapX + z2.mapX)/2} ${(z.mapY + z2.mapY)/2 - 50} ${z2.mapX} ${z2.mapY}`}
              fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="4,4" opacity="0.4"
            />
          ))
        )}

        {/* Các Node (Storage Providers) */}
        {zones.map((z, i) => {
          const color = REGION_COLORS[i % REGION_COLORS.length];
          const radius = 16 + (z.count / maxCount) * 12;

          return (
            <g key={z.zone} style={{ cursor: "pointer" }}>
              {/* Vòng tỏa sáng (Pulse) */}
              <circle cx={z.mapX} cy={z.mapY} r={radius + 12} fill={color} opacity="0.1" />
              <circle cx={z.mapX} cy={z.mapY} r={radius} fill={color} opacity="0.2" stroke={color} strokeWidth="1.5" />

              {/* Các chấm nhỏ đại diện cho Node. Khai báo kiểu tường minh cho _ và pi */}
              {z.providers.slice(0, 8).map((_: StorageProvider, pi: number) => {
                const angle = (pi / Math.max(z.providers.length, 1)) * Math.PI * 2 - Math.PI / 2;
                const dr = z.count > 1 ? 8 : 0;
                return (
                  <circle key={pi}
                    cx={z.mapX + Math.cos(angle) * dr} cy={z.mapY + Math.sin(angle) * dr} r="3"
                    fill={color} stroke="#fff" strokeWidth="1"
                  />
                );
              })}

              {/* Badge đếm số lượng */}
              <circle cx={z.mapX + radius - 4} cy={z.mapY - radius + 4} r="10" fill={color} stroke="#fff" strokeWidth="2" />
              <text x={z.mapX + radius - 4} y={z.mapY - radius + 5} textAnchor="middle" dominantBaseline="middle" fontSize="10" fontWeight="bold" fill="#fff" fontFamily="'DM Mono', monospace">
                {z.count}
              </text>

              {/* Tên Region */}
              <rect x={z.mapX - 30} y={z.mapY + radius + 8} width="60" height="18" rx="9" fill="#fff" stroke="#E2E8F0" />
              <text x={z.mapX} y={z.mapY + radius + 17} textAnchor="middle" dominantBaseline="middle" fontSize="10" fontWeight="600" fill={color} fontFamily="'Outfit', sans-serif">
                {z.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}