// components/ui.tsx — Reusable UI primitives

// ── Stat Card ─────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

export function StatCard({ label, value, sub, color = "#059669" }: StatCardProps) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16,
      padding: "20px 24px", borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: "#AAA", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#0A0A0A", letterSpacing: -0.8, lineHeight: 1, marginBottom: sub ? 5 : 0, fontFamily: "'DM Mono', monospace" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: "#AAA" }}>{sub}</div>}
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────
type BadgeVariant = "active" | "healthy" | "waiting" | "faulty" | "frozen" | "neutral";

const BADGE_STYLES: Record<BadgeVariant, { bg: string; color: string; dot: string }> = {
  active:  { bg: "#F0FDF4", color: "#059669", dot: "#059669" },
  healthy: { bg: "#F0FDF4", color: "#059669", dot: "#059669" },
  waiting: { bg: "#FFFBEB", color: "#D97706", dot: "#D97706" },
  faulty:  { bg: "#FEF2F2", color: "#DC2626", dot: "#DC2626" },
  frozen:  { bg: "#EFF6FF", color: "#3B82F6", dot: "#3B82F6" },
  neutral: { bg: "#F4F4F4", color: "#888",    dot: "#BBB"    },
};

interface StatusBadgeProps {
  label: string;
  variant: BadgeVariant;
}

export function StatusBadge({ label, variant }: StatusBadgeProps) {
  const s = BADGE_STYLES[variant] ?? BADGE_STYLES.neutral;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, display: "inline-block" }} />
      {label}
    </span>
  );
}

// ── Error Banner ──────────────────────────────────────────────────────────────
interface ErrorBannerProps {
  message: string;
  detail?: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message, detail, onRetry }: ErrorBannerProps) {
  return (
    <div style={{
      background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12,
      padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
    }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, color: "#991B1B", marginBottom: detail ? 4 : 0 }}>
          ⚠️ {message}
        </div>
        {detail && <div style={{ fontSize: 12, color: "#B91C1C", fontFamily: "'DM Mono', monospace" }}>{detail}</div>}
      </div>
      {onRetry && (
        <button onClick={onRetry} style={{
          padding: "7px 16px", background: "#fff", border: "1px solid #FECACA",
          borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#991B1B", flexShrink: 0,
        }}>
          Retry
        </button>
      )}
    </div>
  );
}

// ── Loading Skeleton ──────────────────────────────────────────────────────────
export function Skeleton({ width = "100%", height = 20, radius = 6 }: { width?: string | number; height?: number; radius?: number }) {
  return (
    <div style={{
      width, height, borderRadius: radius,
      background: "linear-gradient(90deg, #F4F4F4 25%, #EBEBEB 50%, #F4F4F4 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s infinite",
    }} />
  );
}

// ── Section Header ────────────────────────────────────────────────────────────
interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: 0, letterSpacing: -1, fontFamily: "'Outfit', sans-serif" }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13.5, color: "#AAA", margin: "6px 0 0" }}>{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}