"use client";
/**
 * app/page.tsx — Landing Page v3.0
 *
 * Layout: matches Figure 2 reference
 *  - Left: headline with typing cycle effect + description + CTAs
 *  - Right: large globe (half viewport width) with floating event bubbles
 *  - Globe uses cobe (no backend required — fallback to default SP markers)
 *  - Typing effect cycles through key Shelby messages
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter }  from "next/navigation";
import dynamic        from "next/dynamic";
import { useNetwork } from "@/components/network-context";
import type { GlobeMarker } from "@/components/ui/globe";

// ── Dynamic globe (no SSR) ────────────────────────────────────────
const Globe = dynamic(() => import("@/components/ui/globe"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 48, height: 48, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--shelby-pink)", animation: "spin 1s linear infinite" }} />
    </div>
  ),
});

// ── Typing effect ─────────────────────────────────────────────────
const TYPING_PHRASES = [
  "decentralized storage.",
  "Shelby Protocol.",
  "real-time analytics.",
  "your data, on-chain.",
];

function useTypingEffect(phrases: string[], speed = 60, pause = 2200) {
  const [displayed, setDisplayed] = useState("");
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [charIdx, setCharIdx]     = useState(0);
  const [deleting, setDeleting]   = useState(false);

  useEffect(() => {
    const current = phrases[phraseIdx];
    let delay = deleting ? speed * 0.5 : speed;

    if (!deleting && charIdx === current.length) {
      delay = pause;
    } else if (deleting && charIdx === 0) {
      setDeleting(false);
      setPhraseIdx(i => (i + 1) % phrases.length);
      return;
    }

    const timer = setTimeout(() => {
      if (!deleting && charIdx < current.length) {
        setDisplayed(current.slice(0, charIdx + 1));
        setCharIdx(i => i + 1);
      } else if (!deleting && charIdx === current.length) {
        setDeleting(true);
      } else if (deleting) {
        setDisplayed(current.slice(0, charIdx - 1));
        setCharIdx(i => i - 1);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [charIdx, deleting, phraseIdx, phrases, speed, pause]);

  return displayed;
}

// ── Floating event bubble (like Figure 2) ─────────────────────────
interface Bubble { id: number; text: string; sub: string; color: string; top: string; left?: string; right?: string; }

const BUBBLES: Bubble[] = [
  { id: 1, text: "Blob registered",      sub: "Transaction confirmed",  color: "#ff77c9", top: "12%",  right: "8%" },
  { id: 2, text: "SP joined network",    sub: "Stakely-0 · Frankfurt",  color: "#22c55e", top: "38%",  right: "3%" },
  { id: 3, text: "Epoch advanced",       sub: "Payment epoch #142",     color: "#60a5fa", top: "65%",  right: "10%" },
];

function EventBubble({ bubble }: { bubble: Bubble }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setVisible(true), bubble.id * 900);
    return () => clearTimeout(id);
  }, [bubble.id]);

  return (
    <div style={{
      position:   "absolute",
      top:        bubble.top,
      right:      bubble.right,
      left:       bubble.left,
      display:    "flex",
      alignItems: "center",
      gap:        10,
      padding:    "10px 16px",
      background: "var(--bg-card)",
      border:     "1px solid var(--border)",
      borderRadius: "var(--r-xl)",
      boxShadow:  "var(--shadow-md)",
      zIndex:     20,
      opacity:    visible ? 1 : 0,
      transform:  visible ? "translateY(0)" : "translateY(8px)",
      transition: "opacity 0.5s ease, transform 0.5s ease",
      whiteSpace: "nowrap",
      pointerEvents: "none",
    }}>
      {/* Icon dot */}
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        background:  `${bubble.color}22`,
        border:      `1.5px solid ${bubble.color}55`,
        display:     "flex", alignItems: "center", justifyContent: "center",
        flexShrink:  0,
      }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: bubble.color, boxShadow: `0 0 8px ${bubble.color}` }} />
      </div>
      <div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.2 }}>{bubble.text}</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{bubble.sub}</div>
      </div>
    </div>
  );
}

// ── Arrow icon ────────────────────────────────────────────────────
const Arr = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 7h10M8 3l4 4-4 4"/>
  </svg>
);

// ── Stats ticker ─────────────────────────────────────────────────
interface LiveStats { totalBlobs: number|null; totalStorageGB: number|null; storageProviders: number|null; blockHeight: number|null; }
const fmt   = (n: number|null) => n == null ? "—" : Math.round(n).toLocaleString("en-US");
const fmtGB = (n: number|null) => n == null ? "—" : `${n.toFixed(1)} GB`;

function Ticker({ stats, loading }: { stats: LiveStats; loading: boolean }) {
  const items = [
    { label: "Total Blobs",       value: loading ? "…" : fmt(stats.totalBlobs) },
    { label: "Storage Used",      value: loading ? "…" : fmtGB(stats.totalStorageGB) },
    { label: "Storage Providers", value: loading ? "…" : fmt(stats.storageProviders) },
    { label: "Block Height",      value: loading ? "…" : `#${fmt(stats.blockHeight)}` },
  ];
  return (
    <div className="stats-ticker">
      <div className="stats-ticker-inner">
        {items.map(({ label, value }, i) => (
          <div key={label} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 && <div className="stat-ticker-sep" />}
            <div className="stat-ticker-item" style={i > 0 ? { marginLeft: 48 } : {}}>
              <span className="stat-ticker-label">{label}</span>
              <span className="stat-ticker-value" style={loading ? { color: "var(--text-dim)" } : {}}>{value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Feature icons ─────────────────────────────────────────────────
const IcoGlobe = () => <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="8"/><path d="M10 2c0 0-3 4.5-3 8s3 8 3 8M10 2c0 0 3 4.5 3 8s-3 8-3 8"/><path d="M2 10h16M3 6.5h14M3 13.5h14"/></svg>;
const IcoNet  = () => <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="2.5"/><circle cx="3" cy="5" r="2"/><circle cx="17" cy="5" r="2"/><circle cx="3" cy="15" r="2"/><circle cx="17" cy="15" r="2"/><path d="M5 5l3 3.5M15 5l-3 3.5M5 15l3-3.5M15 15l-3-3.5"/></svg>;
const IcoSrch = () => <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M17 17l-3.5-3.5"/></svg>;
const IcoSpd  = () => <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13A8 8 0 0117 13"/><path d="M10 13l3-5"/><circle cx="10" cy="13" r="1.5" fill="currentColor" stroke="none"/></svg>;

const FEATURES = [
  { icon: IcoGlobe, title: "Globe View",        desc: "Visualize storage providers worldwide in real time.",                                  href: "/map",       label: "Open Map" },
  { icon: IcoNet,   title: "Network Analytics", desc: "Live charts for blobs, storage, epoch history, and on-chain events.",                  href: "/network",   label: "View Analytics" },
  { icon: IcoSrch,  title: "Explorer",          desc: "Search blobs, transactions, and SP details with comprehensive on-chain data.",          href: "/explorer",  label: "Browse Explorer" },
  { icon: IcoSpd,   title: "Benchmark",         desc: "Measure upload/download throughput and Aptos TX speed from your browser.",             href: "/benchmark", label: "Run Benchmark" },
];

// ── Main Page ─────────────────────────────────────────────────────
export default function LandingPage() {
  const router      = useRouter();
  const { network } = useNetwork();
  const typedText   = useTypingEffect(TYPING_PHRASES, 65, 2400);

  const [stats,      setStats]      = useState<LiveStats>({ totalBlobs: null, totalStorageGB: null, storageProviders: null, blockHeight: null });
  const [loading,    setLoading]    = useState(true);
  const [testnetSPs, setTestnetSPs] = useState<number|null>(null);
  // Real SP markers from backend — no hardcoded defaults
  const [globeMarkers, setGlobeMarkers] = useState<GlobeMarker[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [sn, tn, prov] = await Promise.allSettled([
          fetch("/api/network/stats?network=shelbynet").then(r => r.json()),
          fetch("/api/network/stats?network=testnet").then(r => r.json()),
          fetch("/api/network/providers?network=shelbynet").then(r => r.json()),
        ]);
        if (sn.status === "fulfilled") {
          const d = (sn.value as any)?.data;
          setStats({ totalBlobs: d?.stats?.totalBlobs ?? null, totalStorageGB: d?.stats?.totalStorageGB ?? null, storageProviders: d?.stats?.storageProviders ?? null, blockHeight: d?.node?.blockHeight ?? null });
        }
        if (tn.status === "fulfilled") setTestnetSPs((tn.value as any)?.data?.stats?.storageProviders ?? null);
        if (prov.status === "fulfilled") {
          const providers: any[] = (prov.value as any)?.data?.providers ?? [];
          const mkrs: GlobeMarker[] = providers
            .filter((p: any) => p.geo?.lat && p.geo?.lng)
            .map((p: any): GlobeMarker => ({
              location: [p.geo.lat, p.geo.lng],
              size:     p.health === "Healthy" ? 0.07 : 0.05,
              color:    p.health === "Healthy" ? "#ff77c9" : p.state === "Waitlisted" ? "#a855f7" : "#ef4444",
              label:    p.availabilityZone ?? undefined,
            }));
          setGlobeMarkers(mkrs);
        }
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, []);

  const go = (href: string) => router.push(network === "testnet" ? `${href}?network=testnet` : href);

  return (
    <div style={{ background: "var(--bg-primary)", transition: "background 0.25s", overflow: "hidden" }}>
      <style>{`
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        .land-fade-1 { animation: fadeUp 0.6s ease 0.1s both; }
        .land-fade-2 { animation: fadeUp 0.6s ease 0.25s both; }
        .land-fade-3 { animation: fadeUp 0.6s ease 0.4s both; }
        .land-fade-4 { animation: fadeUp 0.6s ease 0.55s both; }
        .feat-card { transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s; }
        .feat-card:hover { border-color: var(--shelby-pink-border, rgba(255,119,201,0.35)) !important; box-shadow: 0 8px 24px rgba(255,119,201,0.08) !important; transform: translateY(-2px); }
        .feat-card:hover .feat-icon { background: rgba(255,119,201,0.1) !important; border-color: rgba(255,119,201,0.3) !important; }
        .feat-card:hover .feat-icon svg { color: var(--shelby-pink) !important; }
        @media (max-width: 900px) { .hero-grid { flex-direction: column !important; } .hero-globe { width: 100% !important; height: 60vw !important; max-height: 400px !important; } }
        @media (max-width: 600px) { .features-grid-inner { grid-template-columns: 1fr !important; } .cta-inner { flex-direction: column !important; } }
      `}</style>

      {/* ═══ HERO ════════════════════════════════════════════════ */}
      <section
        className="hero-grid"
        style={{ display: "flex", minHeight: "calc(100vh - 60px)", alignItems: "stretch" }}
      >
        {/* Left — text */}
        <div style={{
          flex: "0 0 44%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "60px 48px 60px 56px",
        }}>
          {/* Tag */}
          <div className="land-fade-1" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
            <div style={{ width: 32, height: 1, background: "var(--text-dim)" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-dim)" }}>
              Shelby Protocol Analytics
            </span>
          </div>

          {/* Headline */}
          <h1 className="land-fade-2" style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(36px, 4.5vw, 62px)",
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: "-0.03em",
            color: "var(--text-primary)",
            marginBottom: 28,
          }}>
            The analytics<br />
            layer for<br />
            {/* Typing text with cursor */}
            <span style={{ position: "relative", display: "inline-block", color: "var(--shelby-pink)", minHeight: "1.1em" }}>
              {typedText}
              <span
                style={{
                  display: "inline-block",
                  width: 3,
                  height: "0.85em",
                  background: "var(--shelby-pink)",
                  marginLeft: 3,
                  verticalAlign: "middle",
                  borderRadius: 1,
                  animation: "blink 1s step-end infinite",
                }}
              />
              <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
            </span>
          </h1>

          {/* Description */}
          <p className="land-fade-3" style={{
            fontFamily: "var(--font-sans)",
            fontSize: 16,
            lineHeight: 1.7,
            color: "var(--text-muted)",
            maxWidth: 400,
            marginBottom: 36,
          }}>
            Real-time visibility into Shelby Protocol. Monitor
            providers, track blobs, and benchmark performance
            — live from the chain.
          </p>

          {/* CTAs */}
          <div className="land-fade-4" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 32 }}>
            <button
              onClick={() => go("/network")}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "13px 28px",
                background: "var(--text-primary)",
                color: "var(--bg-primary)",
                border: "none",
                borderRadius: 999,
                fontFamily: "var(--font-sans)",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.18s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.85"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
            >
              Open Dashboard <Arr />
            </button>

            <button
              onClick={() => go("/map")}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "12px 26px",
                background: "transparent",
                color: "var(--text-primary)",
                border: "1.5px solid var(--border)",
                borderRadius: 999,
                fontFamily: "var(--font-sans)",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.18s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--text-dim)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; }}
            >
              View Globe
            </button>
          </div>

          {/* Early-access pill */}
          <div className="land-fade-4" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "6px 14px",
            background: "rgba(255,119,201,0.08)",
            border: "1px solid rgba(255,119,201,0.25)",
            borderRadius: 999,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--shelby-pink)",
            width: "fit-content",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--shelby-pink)", animation: "pulse-pink 2s infinite" }} />
            Private Testnet — Early Access
            <style>{`@keyframes pulse-pink{0%,100%{box-shadow:0 0 0 0 rgba(255,119,201,0.5)}60%{box-shadow:0 0 0 6px rgba(255,119,201,0)}}`}</style>
          </div>
        </div>

        {/* Right — globe (takes remaining 56% width) */}
        <div
          className="hero-globe"
          style={{
            flex: 1,
            position: "relative",
            background: "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {/* Subtle radial glow behind globe */}
          <div style={{
            position: "absolute",
            width: "80%", height: "80%",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,119,201,0.05) 0%, transparent 70%)",
            pointerEvents: "none",
          }} />

          {/* Globe — no card border, just floating */}
          <Globe
            markers={globeMarkers}
            autoRotate
            interactive={false}
            style={{
              width: "min(90%, 560px)",
              height: "min(90%, 560px)",
            }}
          />

          {/* Network labels */}
          <div style={{ position: "absolute", top: 20, left: 20, display: "flex", alignItems: "center", gap: 7, padding: "6px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 999, boxShadow: "var(--shadow-sm)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e88" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>Shelbynet</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>Live</span>
          </div>

          <div style={{ position: "absolute", bottom: 20, right: 20, display: "flex", alignItems: "center", gap: 7, padding: "6px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 999, boxShadow: "var(--shadow-sm)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#a855f7", boxShadow: "0 0 6px #a855f788" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>Testnet</span>
            {testnetSPs != null && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>{testnetSPs} SPs</span>}
          </div>

          {/* Floating event bubbles */}
          {BUBBLES.map(b => <EventBubble key={b.id} bubble={b} />)}
        </div>
      </section>

      {/* ═══ STATS TICKER ═══════════════════════════════════════ */}
      <Ticker stats={stats} loading={loading} />

      {/* ═══ FEATURES ═══════════════════════════════════════════ */}
      <section style={{ padding: "80px 56px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ marginBottom: 48 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--shelby-pink)", marginBottom: 12 }}>
              What you can do
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(26px, 3.2vw, 40px)", fontWeight: 700, letterSpacing: "-0.03em", color: "var(--text-primary)", lineHeight: 1.1, marginBottom: 12 }}>
              Everything you need to monitor<br />a decentralized storage network
            </h2>
            <p style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.7, maxWidth: 500 }}>
              Built on Aptos. Powered by real on-chain data. No third-party aggregators, no delays.
            </p>
          </div>

          <div className="features-grid-inner" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            {FEATURES.map(({ icon: Icon, title, desc, href, label }) => (
              <div
                key={title}
                className="feat-card"
                onClick={() => go(href)}
                role="link"
                tabIndex={0}
                onKeyDown={e => e.key === "Enter" && go(href)}
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 20,
                  padding: "24px",
                  cursor: "pointer",
                }}
              >
                <div className="feat-icon" style={{ width: 44, height: 44, borderRadius: 10, background: "var(--bg-card2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, transition: "all 0.2s" }}>
                  <Icon />
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>{title}</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 16 }}>{desc}</div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--shelby-pink)" }}>
                  {label}
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7h10M8 3l4 4-4 4"/></svg>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CTA ════════════════════════════════════════════════ */}
      <div style={{ margin: "0 56px 80px", padding: "56px 56px", background: "var(--shelby-brown)", borderRadius: 24, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -80, right: -80, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,119,201,0.25) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div className="cta-inner" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 40, flexWrap: "wrap", position: "relative" }}>
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>Built for the community</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "clamp(22px, 2.8vw, 34px)", fontWeight: 700, color: "#fff", letterSpacing: "-0.02em", marginBottom: 8 }}>Start exploring the<br />Shelby network now</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>Free, open, and community-driven. No account required.</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
            <button
              onClick={() => go("/network")}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "13px 28px", background: "var(--shelby-pink)", color: "#fff",
                border: "none", borderRadius: 999,
                fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700,
                cursor: "pointer", transition: "all 0.18s",
              }}
              onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = "#fff"; b.style.color = "var(--shelby-brown)"; }}
              onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = "var(--shelby-pink)"; b.style.color = "#fff"; }}
            >
              Open Dashboard <Arr />
            </button>
            <a href="https://docs.shelby.xyz" target="_blank" rel="noreferrer" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.45)", textDecoration: "underline", textUnderlineOffset: 3 }}>
              Read documentation ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}