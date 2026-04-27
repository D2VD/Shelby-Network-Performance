/** @type {import('tailwindcss').Config} */
// tailwind.config.js — Shelby Analytics Phase 2
// Strategy: shadcn CSS variables (--background, --foreground...) được MAP
// tới các variables hiện có (--bg-card, --text-primary...) trong ThemeContext.
// → Không break globals.css cũ, shadcn components tự động theo light/dark theme.

const { fontFamily } = require("tailwindcss/defaultTheme");

module.exports = {
  // shadcn yêu cầu "class" strategy — compatible với data-theme attribute hiện tại
  // ThemeContext.tsx sẽ cần thêm: document.documentElement.classList.toggle("dark", isDark)
  darkMode: ["class"],

  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./pages/**/*.{ts,tsx}", // fallback nếu có
  ],

  theme: {
    // Container responsive
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },

    extend: {
      // ── shadcn/ui Color Tokens ─────────────────────────────────────────────
      // Mapping sang CSS variables HIỆN CÓ trong globals.css
      // Khi Tailwind generate class bg-background → sẽ dùng var(--background)
      // var(--background) được set = var(--bg-primary) trong layer shadcn
      colors: {
        // shadcn primitives
        border:      "hsl(var(--border-hsl))",
        input:       "hsl(var(--input-hsl))",
        ring:        "hsl(var(--ring-hsl))",
        background:  "hsl(var(--background-hsl))",
        foreground:  "hsl(var(--foreground-hsl))",

        primary: {
          DEFAULT:    "hsl(var(--primary-hsl))",
          foreground: "hsl(var(--primary-foreground-hsl))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary-hsl))",
          foreground: "hsl(var(--secondary-foreground-hsl))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive-hsl))",
          foreground: "hsl(var(--destructive-foreground-hsl))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted-hsl))",
          foreground: "hsl(var(--muted-foreground-hsl))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent-hsl))",
          foreground: "hsl(var(--accent-foreground-hsl))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover-hsl))",
          foreground: "hsl(var(--popover-foreground-hsl))",
        },
        card: {
          DEFAULT:    "hsl(var(--card-hsl))",
          foreground: "hsl(var(--card-foreground-hsl))",
        },

        // ── Shelby Design Tokens (dùng trực tiếp trong code) ────────────────
        // Cho phép dùng className="text-shelby-accent" thay vì inline styles
        shelby: {
          accent:     "#2563eb",  // Shelbynet blue
          testnet:    "#9333ea",  // Testnet purple
          success:    "#22c55e",
          warning:    "#f59e0b",
          danger:     "#ef4444",
          muted:      "#6b7280",
        },
        network: {
          shelbynet: "#2563eb",
          testnet:   "#9333ea",
        },
      },

      // ── Border Radius ──────────────────────────────────────────────────────
      borderRadius: {
        lg:  "var(--radius)",
        md:  "calc(var(--radius) - 2px)",
        sm:  "calc(var(--radius) - 4px)",
        xl:  "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },

      // ── Font Family ────────────────────────────────────────────────────────
      fontFamily: {
        sans:  ["Inter", ...fontFamily.sans],
        mono:  ["JetBrains Mono", "Fira Code", ...fontFamily.mono],
        // Display font cho headings (Phase 2 upgrade từ Inter)
        display: ["Inter", ...fontFamily.sans],
      },

      // ── Keyframes (shadcn animations) ─────────────────────────────────────
      keyframes: {
        // shadcn built-in
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
        // Shelby custom
        "pulse-dot": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(34,197,94,0.4)" },
          "70%":       { boxShadow: "0 0 0 8px rgba(34,197,94,0)" },
        },
        "shimmer": {
          "0%":   { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(8px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "accordion-down":  "accordion-down 0.2s ease-out",
        "accordion-up":    "accordion-up 0.2s ease-out",
        "pulse-dot":       "pulse-dot 2s infinite",
        "shimmer":         "shimmer 1.5s infinite",
        "fade-in":         "fade-in 0.3s ease",
        "slide-in-right":  "slide-in-right 0.2s ease",
      },

      // ── Box Shadow ─────────────────────────────────────────────────────────
      boxShadow: {
        "card":   "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
        "card-md":"0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)",
        "card-lg":"0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)",
        "glow":   "0 0 12px rgba(37,99,235,0.3)",
        "glow-sm":"0 0 6px rgba(37,99,235,0.25)",
      },

      // ── Spacing extras ─────────────────────────────────────────────────────
      spacing: {
        "nav": "60px", // --nav-h
      },
    },
  },

  plugins: [
    require("tailwindcss-animate"), // shadcn dependency
    // require("@tailwindcss/typography"),  // uncomment nếu cần prose
  ],
};