"use client";
// components/topology-chart.tsx — Phase 2 v1.2
//
// FIX ts(7016): Bỏ `import type * as D3Type from "d3"`
//   @types/d3 chưa install → ambient type import fails
//   Solution: tự định nghĩa mọi interface cần dùng + cast runtime d3 về `D3Lib`
//
// FIX ts(2339): `fx/fy` không tồn tại trên GNode
//   Nguyên nhân: khi không có @types/d3, SimulationNodeDatum không resolve
//   Solution: tự declare GNode với fx/fy/x/y/vx/vy explicitly — không extends gì cả
//
// NOTE: Sau khi chạy `npm install --save-dev @types/d3` thì file này vẫn hoạt động
//   vì mọi type đều self-contained, không conflict

import { useEffect, useRef, useCallback } from "react";

// ── Exported types ────────────────────────────────────────────────────────────
export interface SpNode {
  address:          string;
  addressShort:     string;
  availabilityZone: string;
  health:           string;
  designatedPgs?:   Array<{ pg_address: string; slot_index: number }>;
}

export interface TopologyChartProps {
  spList: SpNode[];
}

// ── Self-contained graph types (không extends D3) ─────────────────────────────
// Khai báo đủ fx/fy/x/y/vx/vy/index để D3 simulation có thể mutate
interface GNode {
  // identity
  id:      string;
  label:   string;
  type:    "sp" | "pg";
  az?:     string;
  health?: string;
  // D3 simulation-mutable fields — phải khai báo tường minh để tránh ts(2339)
  x?:      number;
  y?:      number;
  vx?:     number;
  vy?:     number;
  fx?:     number | null;
  fy?:     number | null;
  index?:  number;
}

interface GLink {
  source: string | GNode;
  target: string | GNode;
  slot:   number;
  // D3 simulation fills these
  index?: number;
}

// ── D3 runtime interface (minimal subset we actually call) ────────────────────
// Dùng thay cho `typeof D3Type` để tránh phụ thuộc vào @types/d3
interface D3Lib {
  select:          (el: SVGSVGElement | Element) => D3Selection;
  zoom:            <E extends Element, D>() => D3ZoomBehavior<E, D>;
  drag:            <E extends Element, D>() => D3DragBehavior<E, D>;
  forceSimulation: (nodes: GNode[]) => D3Simulation;
  forceLink:       (links: GLink[]) => D3ForceLink;
  forceManyBody:   () => D3ForceManyBody;
  forceCenter:     (x: number, y: number) => D3ForceCenter;
  forceCollide:    () => D3ForceCollide;
  forceX:          () => D3ForceX;
}

// Minimal D3 chain interfaces — chỉ những method ta dùng
interface D3Selection {
  selectAll:  <E extends Element, D>(sel: string) => D3Selection;
  append:     (tag: string) => D3Selection;
  attr:       (name: string, value: unknown) => D3Selection;
  data:       (data: unknown[]) => D3Selection;
  join:       (tag: string) => D3Selection;
  text:       (fn: (d: GNode) => string) => D3Selection;
  filter:     (fn: (d: GNode) => boolean) => D3Selection;
  call:       (behavior: unknown) => D3Selection;
  on:         (event: string, fn: (event: MouseEvent, d: GNode) => void) => D3Selection;
}
interface D3Simulation {
  force:      (name: string, force: unknown) => D3Simulation;
  on:         (event: string, fn: () => void) => D3Simulation;
  alpha:      (v: number) => D3Simulation;
  alphaTarget:(v: number) => D3Simulation;
  restart:    () => D3Simulation;
  stop:       () => void;
}
interface D3ForceLink {
  id:       (fn: (d: GNode) => string) => D3ForceLink;
  distance: (fn: (d: GLink) => number) => D3ForceLink;
  strength: (v: number) => D3ForceLink;
}
interface D3ForceManyBody { strength: (fn: (d: GNode) => number) => D3ForceManyBody; }
interface D3ForceCenter   { strength: (v: number) => D3ForceCenter; }
interface D3ForceCollide  { radius: (fn: (d: GNode) => number) => D3ForceCollide; strength: (v: number) => D3ForceCollide; }
interface D3ForceX        { x: (fn: (d: GNode) => number) => D3ForceX; strength: (v: number) => D3ForceX; }
interface D3ZoomBehavior<E extends Element, D> { scaleExtent: (r: [number, number]) => this; on: (event: string, fn: (event: { transform: { toString: () => string } }) => void) => this; }
interface D3DragBehavior<E extends Element, D> { on: (event: string, fn: (event: { active: boolean; x: number; y: number }, d: D) => void) => this; }

// ── Color helpers ─────────────────────────────────────────────────────────────
function healthColor(health: string): string {
  switch (health) {
    case "Healthy":              return "#22c55e";
    case "Faulty":
    case "Unhealthy":            return "#ef4444";
    case "Awaiting Activation":  return "#f59e0b";
    default:                     return "#94a3b8";
  }
}

const AZ_COLORS: Record<string, string> = {
  "Jump-AMS-0": "#3b82f6", "Jump-AMS-1": "#60a5fa",
  "Jump-LON-0": "#06b6d4", "Jump-LON-1": "#22d3ee",
  "Stakely-0":  "#f59e0b", "Duoro-0":    "#ec4899",
  "Nova-0":     "#a78bfa", "Republic-0": "#fb923c",
  "AR-0":       "#34d399", "AR-1":       "#6ee7b7",
};

// ── Build graph ───────────────────────────────────────────────────────────────
function buildGraph(spList: SpNode[]): { nodes: GNode[]; links: GLink[] } {
  const nodeMap = new Map<string, GNode>();
  const links: GLink[] = [];

  for (const sp of spList) {
    if (!nodeMap.has(sp.address)) {
      nodeMap.set(sp.address, {
        id: sp.address, label: sp.addressShort,
        type: "sp", az: sp.availabilityZone, health: sp.health,
      });
    }
    for (const pg of sp.designatedPgs ?? []) {
      if (!nodeMap.has(pg.pg_address)) {
        nodeMap.set(pg.pg_address, {
          id:    pg.pg_address,
          label: `${pg.pg_address.slice(0, 5)}…${pg.pg_address.slice(-3)}`,
          type:  "pg",
        });
      }
      links.push({ source: sp.address, target: pg.pg_address, slot: pg.slot_index });
    }
  }
  return { nodes: Array.from(nodeMap.values()), links };
}

// ── Safe position readers ─────────────────────────────────────────────────────
const gx = (d: GNode): number => d.x ?? 0;
const gy = (d: GNode): number => d.y ?? 0;

function linkNode(endpoint: string | GNode): GNode {
  return typeof endpoint === "string"
    ? { id: endpoint, label: "", type: "sp" }
    : endpoint;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TopologyChart({ spList }: TopologyChartProps) {
  const svgRef     = useRef<SVGSVGElement>(null);
  // Use unknown to avoid any D3 ambient type dependency
  const simRef     = useRef<{ stop: () => void } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const render = useCallback(async () => {
    const svgEl = svgRef.current;
    if (!svgEl || spList.length === 0) return;

    // Dynamic import — cast to our self-defined D3Lib interface
    const d3 = (await import("d3")) as unknown as D3Lib;

    const W = svgEl.clientWidth  || 800;
    const H = svgEl.clientHeight || 420;

    simRef.current?.stop();
    d3.select(svgEl).selectAll("*").append("g"); // clear via selectAll trick
    // Proper clear:
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

    const { nodes, links } = buildGraph(spList);
    if (nodes.length === 0) return;

    const azList = [...new Set(spList.map(s => s.availabilityZone))];

    // ── Defs: arrowhead ───────────────────────────────────────────────────────
    const svgSel = d3.select(svgEl);
    svgSel.append("defs")
      .append("marker")
      .attr("id", "arr")
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", 14).attr("refY", 0)
      .attr("markerWidth", 5).attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-4L8,0L0,4")
      .attr("fill", "rgba(148,163,184,0.35)");

    // ── Zoom container ────────────────────────────────────────────────────────
    const g = svgSel.append("g");

    svgSel.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.25, 4])
        .on("zoom", (event: { transform: { toString: () => string } }) => {
          g.attr("transform", event.transform.toString());
        }),
    );

    // ── Simulation ────────────────────────────────────────────────────────────
    const simulation: D3Simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3.forceLink(links)
          .id((d: GNode) => d.id)
          .distance((d: GLink) => {
            const s = linkNode(d.source);
            const t = linkNode(d.target);
            return s.type === "sp" && t.type === "pg" ? 80 : 120;
          })
          .strength(0.4),
      )
      .force("charge",  d3.forceManyBody().strength((d: GNode) => (d.type === "pg" ? -70 : -170)))
      .force("center",  d3.forceCenter(W / 2, H / 2).strength(0.05))
      .force("collide", d3.forceCollide().radius((d: GNode) => (d.type === "sp" ? 22 : 14)).strength(0.8))
      .force(
        "az-x",
        d3.forceX().x((d: GNode) => {
          if (d.type !== "sp" || !d.az) return W / 2;
          const idx = azList.indexOf(d.az);
          return W * 0.1 + (idx / Math.max(azList.length - 1, 1)) * W * 0.8;
        }).strength(0.08),
      );

    simRef.current = simulation;

    // ── Links ─────────────────────────────────────────────────────────────────
    const linkSel = g.append("g")
      .selectAll<SVGLineElement, GLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", "rgba(148,163,184,0.18)")
      .attr("stroke-width", 1)
      .attr("marker-end", "url(#arr)");

    // ── Drag ─────────────────────────────────────────────────────────────────
    // GNode khai báo fx/fy? explicitly → không còn ts(2339)
    type DragEv = { active: boolean; x: number; y: number };

    const dragBeh = d3
      .drag<SVGGElement, GNode>()
      .on("start", (event: DragEv, d: GNode) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x ?? 0;
        d.fy = d.y ?? 0;
      })
      .on("drag", (event: DragEv, d: GNode) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event: DragEv, d: GNode) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    // ── Node group ────────────────────────────────────────────────────────────
    const nodeSel = g.append("g")
      .selectAll<SVGGElement, GNode>("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(dragBeh);

    // Body circle
    nodeSel.append("circle")
      .attr("r",            (d: GNode) => (d.type === "sp" ? 16 : 10))
      .attr("fill",         (d: GNode) =>
        d.type === "pg" ? "rgba(147,51,234,0.12)" : `${healthColor(d.health ?? "Unknown")}22`,
      )
      .attr("stroke",       (d: GNode) =>
        d.type === "pg" ? "rgba(147,51,234,0.65)" : healthColor(d.health ?? "Unknown"),
      )
      .attr("stroke-width", (d: GNode) => (d.type === "sp" ? 2 : 1.5));

    // AZ dot on SP
    nodeSel
      .filter((d: GNode) => d.type === "sp" && !!d.az)
      .append("circle")
      .attr("r",    4.5)
      .attr("cx",   10)
      .attr("cy",   -10)
      .attr("fill", (d: GNode) => AZ_COLORS[d.az ?? ""] ?? "#6b7280");

    // Label
    nodeSel.append("text")
      .attr("text-anchor", "middle")
      .attr("dy",          (d: GNode) => (d.type === "sp" ? 30 : 22))
      .attr("font-size",   (d: GNode) => (d.type === "sp" ? 9 : 8))
      .attr("font-family", "monospace")
      .attr("fill",        "var(--text-dim)")
      .text((d: GNode) => d.label);

    // ── Tooltip ───────────────────────────────────────────────────────────────
    const tooltip = tooltipRef.current;

    nodeSel
      .on("mouseenter", (event: MouseEvent, d: GNode) => {
        if (!tooltip) return;
        const lines =
          d.type === "sp"
            ? [
                `SP: ${d.id.slice(0, 10)}…${d.id.slice(-6)}`,
                `AZ: ${d.az ?? "unknown"}`,
                `Health: ${d.health ?? "—"}`,
              ]
            : [`PG: ${d.id.slice(0, 10)}…${d.id.slice(-6)}`, "Placement Group"];
        tooltip.innerHTML     = lines.map(l => `<div>${l}</div>`).join("");
        tooltip.style.display = "block";
        const rect            = svgEl.getBoundingClientRect();
        tooltip.style.left    = `${event.clientX - rect.left + 12}px`;
        tooltip.style.top     = `${event.clientY - rect.top  - 10}px`;
      })
      .on("mouseleave", (_event: MouseEvent, _d: GNode) => {
        if (tooltip) tooltip.style.display = "none";
      });

    // ── Tick ─────────────────────────────────────────────────────────────────
    simulation.on("tick", () => {
      // Cast linkSel to any for attr calls with GLink data
      // (our minimal D3Selection interface uses GNode for simplicity)
      const ls = linkSel as unknown as {
        attr: (name: string, fn: (d: GLink) => number) => void;
      };
      ls.attr("x1", (d: GLink) => gx(linkNode(d.source)));
      ls.attr("y1", (d: GLink) => gy(linkNode(d.source)));
      ls.attr("x2", (d: GLink) => gx(linkNode(d.target)));
      ls.attr("y2", (d: GLink) => gy(linkNode(d.target)));

      nodeSel.attr("transform", (d: GNode) => `translate(${gx(d)},${gy(d)})`);
    });

    simulation.alpha(1).restart();
    setTimeout(() => simulation.alphaTarget(0), 2800);
  }, [spList]);

  useEffect(() => {
    render();
    return () => { simRef.current?.stop(); };
  }, [render]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  const spCount   = spList.length;
  const pgCount   = new Set(
    spList.flatMap(s => (s.designatedPgs ?? []).map(p => p.pg_address)),
  ).size;
  const linkCount = spList.reduce((s, sp) => s + (sp.designatedPgs?.length ?? 0), 0);
  const azList    = [...new Set(spList.map(s => s.availabilityZone))].slice(0, 10);

  return (
    <div className="relative rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">

      {/* Stats bar */}
      <div className="flex items-center gap-5 border-b border-[var(--border)] px-4 py-2.5 flex-wrap">
        {[
          { label: "SPs",   value: spCount,   color: "#22c55e" },
          { label: "PGs",   value: pgCount,   color: "#9333ea" },
          { label: "Links", value: linkCount, color: "#06b6d4" },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: color }} />
            <span className="text-xs text-[var(--text-muted)]">{label}</span>
            <span className="text-xs font-bold font-mono" style={{ color }}>{value}</span>
          </div>
        ))}
        <span className="ml-auto text-[10px] text-[var(--text-dim)]">
          drag · scroll = zoom · click = pin
        </span>
      </div>

      {/* SVG + tooltip */}
      <div className="relative">
        <svg
          ref={svgRef}
          className="w-full block"
          style={{ height: 420, background: "var(--bg-primary)" }}
        />
        <div
          ref={tooltipRef}
          className="absolute z-50 hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[11px] font-mono text-[var(--text-primary)] shadow-lg pointer-events-none space-y-0.5 whitespace-nowrap"
        />
      </div>

      {/* AZ + health legend */}
      {azList.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] px-4 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">AZ</span>
          {azList.map(az => (
            <div key={az} className="flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ background: AZ_COLORS[az] ?? "#6b7280" }} />
              <span className="text-[10px] font-mono text-[var(--text-dim)]">{az}</span>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-3">
            {[
              { label: "Healthy",  color: "#22c55e" },
              { label: "Faulty",   color: "#ef4444" },
              { label: "Awaiting", color: "#f59e0b" },
              { label: "PG",       color: "#9333ea" },
            ].map(({ label, color }) => (
              <div key={label} className="flex items-center gap-1">
                <span className="size-1.5 rounded-full" style={{ background: color }} />
                <span className="text-[10px] text-[var(--text-dim)]">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}