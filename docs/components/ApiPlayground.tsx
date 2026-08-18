// components/ApiPlayground.tsx
//
// Embeddable "try it live" widget for API reference docs (Nextra Pages Router).
// Renders a form built from `params`, sends a real request to the live API on
// button click, and shows the actual JSON response — no backend proxy needed,
// assumes Access-Control-Allow-Origin: * is already set on shelbyanalytics.site
// (confirmed present in existing response headers as of 2026-08-17).
//
// Usage in an .mdx page:
//
//   import { ApiPlayground } from "../../components/ApiPlayground";
//
//   <ApiPlayground
//     method="GET"
//     path="/v1/network/stats"
//     params={[
//       { name: "network", type: "select", options: ["shelbynet", "testnet", "mainnet"], required: true, default: "shelbynet" },
//     ]}
//   />

import { useState } from "react";

const API_BASE = "https://shelbyanalytics.site/api";

type ParamType = "text" | "select" | "number";

interface ParamSpec {
  name: string;
  type: ParamType;
  required?: boolean;
  default?: string;
  options?: string[];
  placeholder?: string;
}

interface PathParamSpec {
  name: string;        // e.g. "address" — path must contain a literal "{address}" placeholder
  placeholder?: string;
  default?: string;
}

interface ApiPlaygroundProps {
  method?: "GET";
  path: string; // e.g. "/v1/network/stats" or "/v1/providers/{address}" for dynamic segments
  params?: ParamSpec[];
  pathParams?: PathParamSpec[];
  description?: string;
}

export function ApiPlayground({
  method = "GET",
  path,
  params = [],
  pathParams = [],
  description,
}: ApiPlaygroundProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of params) {
      if (p.default !== undefined) initial[p.name] = p.default;
    }
    return initial;
  });
  const [pathValues, setPathValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of pathParams) {
      if (p.default !== undefined) initial[p.name] = p.default;
    }
    return initial;
  });
  const [response, setResponse] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildUrl(): string {
    let resolvedPath = path;
    for (const p of pathParams) {
      resolvedPath = resolvedPath.replace(`{${p.name}}`, encodeURIComponent(pathValues[p.name] ?? ""));
    }
    const qs = new URLSearchParams();
    for (const p of params) {
      const v = values[p.name];
      if (v !== undefined && v !== "") qs.set(p.name, v);
    }
    const qsStr = qs.toString();
    return `${API_BASE}${resolvedPath}${qsStr ? `?${qsStr}` : ""}`;
  }

  async function handleSend() {
    setLoading(true);
    setError(null);
    setResponse(null);
    setStatus(null);

    const missingQuery = params.filter((p) => p.required && !values[p.name]);
    const missingPath = pathParams.filter((p) => !pathValues[p.name]);
    if (missingQuery.length > 0 || missingPath.length > 0) {
      const names = [...missingPath, ...missingQuery].map((p) => p.name).join(", ");
      setError(`Missing required value: ${names}`);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(buildUrl(), { method });
      setStatus(res.status);
      const text = await res.text();
      try {
        setResponse(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResponse(text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
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
            background: "#0f766e",
            color: "white",
            fontSize: 12,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 4,
          }}
        >
          {method}
        </span>
        <code style={{ fontSize: 14 }}>{path}</code>
      </div>

      {description && (
        <p style={{ fontSize: 14, color: "#555", marginBottom: 12 }}>{description}</p>
      )}

      {pathParams.length > 0 && (
        <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
          {pathParams.map((p) => (
            <label key={p.name} style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span>
                <code>{`{${p.name}}`}</code> (path segment)
                <span style={{ color: "#c00" }}> *</span>
              </span>
              <input
                type="text"
                value={pathValues[p.name] ?? ""}
                placeholder={p.placeholder}
                onChange={(e) => setPathValues((v) => ({ ...v, [p.name]: e.target.value }))}
                style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid #ccc" }}
              />
            </label>
          ))}
        </div>
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
                  type={p.type === "number" ? "number" : "text"}
                  value={values[p.name] ?? ""}
                  placeholder={p.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                  style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid #ccc" }}
                />
              )}
            </label>
          ))}
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={loading}
        style={{
          background: loading ? "#94a3b8" : "#0f766e",
          color: "white",
          border: "none",
          borderRadius: 6,
          padding: "8px 16px",
          fontSize: 14,
          fontWeight: 600,
          cursor: loading ? "default" : "pointer",
        }}
      >
        {loading ? "Sending..." : "Send request"}
      </button>

      {error && (
        <div style={{ marginTop: 12, color: "#c00", fontSize: 13 }}>Error: {error}</div>
      )}

      {response !== null && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
            Response{status !== null ? ` — ${status}` : ""}
          </div>
          <pre
            style={{
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
            {response}
          </pre>
        </div>
      )}
    </div>
  );
}