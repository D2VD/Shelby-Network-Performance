// components/ApiStreamPlayground.tsx
//
// "Try it live" widget for the /v1/activity/stream SSE endpoint.
// Unlike ApiPlayground, this opens a persistent EventSource connection and
// appends each incoming event to a scrolling log, since SSE has no single
// request/response cycle to display.
//
// Usage in an .mdx page:
//
//   import { ApiStreamPlayground } from "../../components/ApiStreamPlayground";
//
//   <ApiStreamPlayground
//     path="/v1/activity/stream"
//     params={[{ name: "network", type: "select", options: ["shelbynet","testnet","mainnet"], required: true, default: "shelbynet" }]}
//   />

import { useRef, useState } from "react";

const API_BASE = "https://shelbyanalytics.site/api";

interface ParamSpec {
  name: string;
  type: "text" | "select";
  required?: boolean;
  default?: string;
  options?: string[];
}

interface ApiStreamPlaygroundProps {
  path: string;
  params?: ParamSpec[];
  description?: string;
  maxEvents?: number;
}

export function ApiStreamPlayground({
  path,
  params = [],
  description,
  maxEvents = 30,
}: ApiStreamPlaygroundProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of params) {
      if (p.default !== undefined) initial[p.name] = p.default;
    }
    return initial;
  });
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  function buildUrl(): string {
    const qs = new URLSearchParams();
    for (const p of params) {
      const v = values[p.name];
      if (v !== undefined && v !== "") qs.set(p.name, v);
    }
    const qsStr = qs.toString();
    return `${API_BASE}${path}${qsStr ? `?${qsStr}` : ""}`;
  }

  function handleStart() {
    const missing = params.filter((p) => p.required && !values[p.name]);
    if (missing.length > 0) {
      setError(`Missing required param: ${missing.map((p) => p.name).join(", ")}`);
      return;
    }
    setError(null);
    setEvents([]);

    const es = new EventSource(buildUrl());
    sourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      setEvents((prev) => {
        const next = [`${new Date().toLocaleTimeString()}  ${e.data}`, ...prev];
        return next.slice(0, maxEvents);
      });
    };

    es.onerror = () => {
      setError("Connection error or stream closed");
      setConnected(false);
      es.close();
    };
  }

  function handleStop() {
    sourceRef.current?.close();
    sourceRef.current = null;
    setConnected(false);
  }

  return (
    <div
      style={{
        border: "1px solid #e2e2e2",
        borderRadius: 8,
        padding: 16,
        margin: "16px 0",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span
          style={{
            background: "#7c3aed",
            color: "white",
            fontSize: 12,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 4,
          }}
        >
          SSE
        </span>
        <code style={{ fontSize: 14 }}>{path}</code>
        {connected && (
          <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>● live</span>
        )}
      </div>

      {description && (
        <p style={{ fontSize: 14, color: "#555", marginBottom: 12 }}>{description}</p>
      )}

      {params.length > 0 && (
        <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
          {params.map((p) => (
            <label key={p.name} style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span>
                <code>{p.name}</code>
                {p.required && <span style={{ color: "#c00" }}> *</span>}
              </span>
              {p.type === "select" && p.options ? (
                <select
                  value={values[p.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                  style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid #ccc" }}
                >
                  <option value="">— select —</option>
                  {p.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={values[p.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                  style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid #ccc" }}
                />
              )}
            </label>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleStart}
          disabled={connected}
          style={{
            background: connected ? "#94a3b8" : "#7c3aed",
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: connected ? "default" : "pointer",
          }}
        >
          Connect
        </button>
        <button
          onClick={handleStop}
          disabled={!connected}
          style={{
            background: "white",
            color: "#333",
            border: "1px solid #ccc",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: !connected ? "default" : "pointer",
          }}
        >
          Disconnect
        </button>
      </div>

      {error && <div style={{ marginTop: 12, color: "#c00", fontSize: 13 }}>{error}</div>}

      {events.length > 0 && (
        <pre
          style={{
            marginTop: 12,
            background: "#0d1117",
            color: "#c9d1d9",
            padding: 12,
            borderRadius: 6,
            fontSize: 12,
            overflowX: "auto",
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {events.join("\n")}
        </pre>
      )}
    </div>
  );
}