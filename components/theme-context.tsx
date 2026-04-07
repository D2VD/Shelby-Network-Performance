"use client";
// components/theme-context.tsx — v1.0
// Dark/Light toggle với CSS variables + localStorage persist
// Dark theme: NOT too dark — dùng #0f1a2e (navy dark) thay vì #000

import React, {
  createContext, useContext, useState, useEffect,
  useCallback, type ReactNode,
} from "react";

export type AppTheme = "light" | "dark";

interface ThemeCtx {
  theme:     AppTheme;
  toggle:    () => void;
  setTheme:  (t: AppTheme) => void;
  isDark:    boolean;
}

const ThemeContext = createContext<ThemeCtx>({
  theme:    "light",
  toggle:   () => {},
  setTheme: () => {},
  isDark:   false,
});

const STORAGE_KEY = "shelby-theme";

// ── CSS variable sets ─────────────────────────────────────────────────────────
const LIGHT_VARS: Record<string, string> = {
  "--bg-primary":    "#f9fafb",
  "--bg-secondary":  "#ffffff",
  "--bg-card":       "#ffffff",
  "--bg-card2":      "#f3f4f6",
  "--border":        "#e5e7eb",
  "--border-soft":   "#f0f0f0",
  "--text-primary":  "#111827",
  "--text-secondary":"#374151",
  "--text-muted":    "#6b7280",
  "--text-dim":      "#9ca3af",
  "--nav-bg":        "rgba(255,255,255,0.97)",
  "--nav-border":    "#e5e7eb",
  "--card-bg":       "#ffffff",
  "--card-border":   "#e5e7eb",
  "--input-bg":      "#f9fafb",
  "--shadow-color":  "rgba(0,0,0,0.08)",
  "--accent":        "#06b6d4",
  "--accent-bg":     "rgba(6,182,212,0.08)",
};

const DARK_VARS: Record<string, string> = {
  "--bg-primary":    "#0d1526",
  "--bg-secondary":  "#0f1a2e",
  "--bg-card":       "#132038",
  "--bg-card2":      "#0f1a2e",
  "--border":        "#1e3a5f",
  "--border-soft":   "#172d4a",
  "--text-primary":  "#e2e8f0",
  "--text-secondary":"#cbd5e1",
  "--text-muted":    "#94a3b8",
  "--text-dim":      "#64748b",
  "--nav-bg":        "rgba(13,21,38,0.97)",
  "--nav-border":    "#1e3a5f",
  "--card-bg":       "#132038",
  "--card-border":   "#1e3a5f",
  "--input-bg":      "#0f1a2e",
  "--shadow-color":  "rgba(0,0,0,0.3)",
  "--accent":        "#38bdf8",
  "--accent-bg":     "rgba(56,189,248,0.1)",
};

function applyTheme(theme: AppTheme) {
  const vars = theme === "dark" ? DARK_VARS : LIGHT_VARS;
  const root = document.documentElement;
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.setAttribute("data-theme", theme);
  // Override body background directly for instant swap
  document.body.style.background = vars["--bg-primary"];
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>("light");

  // Init from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as AppTheme | null;
      const initial = saved === "dark" ? "dark" : "light";
      setThemeState(initial);
      applyTheme(initial);
    } catch {
      applyTheme("light");
    }
  }, []);

  const setTheme = useCallback((t: AppTheme) => {
    setThemeState(t);
    applyTheme(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch {}
  }, []);

  const toggle = useCallback(() => {
    setThemeState(prev => {
      const next = prev === "light" ? "dark" : "light";
      applyTheme(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme, isDark: theme === "dark" }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

// ── Theme Toggle Button (dùng trong Nav) ─────────────────────────────────────
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      title={isDark ? "Switch to Light mode" : "Switch to Dark mode"}
      style={{
        display:        "flex",
        alignItems:     "center",
        gap:            compact ? 0 : 6,
        padding:        compact ? "6px 8px" : "6px 12px",
        borderRadius:   9,
        border:         "1px solid var(--border, #e5e7eb)",
        background:     "var(--bg-card, #fff)",
        color:          "var(--text-muted, #6b7280)",
        fontSize:       13,
        fontWeight:     500,
        cursor:         "pointer",
        transition:     "all 0.15s",
        flexShrink:     0,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = "var(--accent, #06b6d4)";
        e.currentTarget.style.color = "var(--accent, #06b6d4)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = "var(--border, #e5e7eb)";
        e.currentTarget.style.color = "var(--text-muted, #6b7280)";
      }}
    >
      <span style={{ fontSize: 15, lineHeight: 1 }}>{isDark ? "☀️" : "🌙"}</span>
      {!compact && <span>{isDark ? "Light" : "Dark"}</span>}
    </button>
  );
}