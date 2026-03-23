"use client";
// components/testnet-banner.tsx
// Hiển thị khi user switch sang testnet — Shelby testnet chưa live.
// Thay thế toàn bộ content của page bằng banner + call to action.

export function TestnetBanner() {
  return (
    <div style={{
      display:        "flex",
      flexDirection:  "column",
      alignItems:     "center",
      justifyContent: "center",
      textAlign:      "center",
      padding:        "80px 32px",
      minHeight:      400,
    }}>
      {/* Icon */}
      <div style={{
        width:        64,
        height:       64,
        borderRadius: "50%",
        background:   "#f3f0ff",
        display:      "flex",
        alignItems:   "center",
        justifyContent: "center",
        marginBottom: 24,
        fontSize:     28,
      }}>
        🔬
      </div>

      {/* Badge */}
      <div style={{
        display:      "inline-flex",
        alignItems:   "center",
        gap:          6,
        background:   "#f3f0ff",
        border:       "1px solid #c4b5fd",
        borderRadius: 20,
        padding:      "4px 14px",
        fontSize:     12,
        fontWeight:   600,
        color:        "#7c3aed",
        marginBottom: 20,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9333ea", display: "inline-block" }} />
        Early Access
      </div>

      <h2 style={{
        fontSize:     24,
        fontWeight:   700,
        color:        "#0a0a0a",
        marginBottom: 12,
        letterSpacing: -0.5,
      }}>
        Shelby Testnet — Coming Soon
      </h2>

      <p style={{
        fontSize:    15,
        color:       "#6b7280",
        maxWidth:    420,
        lineHeight:  1.6,
        marginBottom: 32,
      }}>
        The Shelby Testnet is not yet publicly available. Apply for Early Access
        to start building on Shelby Protocol.
      </p>

      {/* CTA buttons */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <a
          href="https://developers.shelby.xyz"
          target="_blank"
          rel="noreferrer"
          style={{
            display:        "inline-flex",
            alignItems:     "center",
            gap:            8,
            padding:        "10px 22px",
            borderRadius:   10,
            background:     "#9333ea",
            color:          "#fff",
            fontSize:       14,
            fontWeight:     600,
            textDecoration: "none",
            transition:     "opacity 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "0.88")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
        >
          Apply for Early Access ↗
        </a>
        <a
          href="https://discord.com/invite/shelbyserves"
          target="_blank"
          rel="noreferrer"
          style={{
            display:        "inline-flex",
            alignItems:     "center",
            gap:            8,
            padding:        "10px 22px",
            borderRadius:   10,
            background:     "transparent",
            color:          "#6b7280",
            fontSize:       14,
            fontWeight:     500,
            textDecoration: "none",
            border:         "1px solid #e5e7eb",
            transition:     "border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#9333ea"; e.currentTarget.style.color = "#9333ea"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.color = "#6b7280"; }}
        >
          Join Discord ↗
        </a>
      </div>

      {/* Info strip */}
      <div style={{
        marginTop:    48,
        padding:      "20px 28px",
        background:   "#fafafa",
        border:       "1px solid #f0f0f0",
        borderRadius: 12,
        display:      "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap:          24,
        maxWidth:     480,
        width:        "100%",
      }}>
        {[
          { label: "Storage providers", value: "—" },
          { label: "Total blobs",       value: "—" },
          { label: "Placement groups",  value: "—" },
        ].map(({ label, value }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 20, fontWeight: 600, color: "#c4b5fd", marginBottom: 4 }}>
              {value}
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              {label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}