// components/blob-preview-panel.tsx
//
// File preview modal for a single blob. Renders content via the confirmed
// public Shelby content gateway (proxied through /api/blobs/preview so
// Content-Type/Content-Disposition are normalized — see that route for the
// gateway discovery notes and key-format warning).
//
// SCOPE: shelbynet only, matching the proxy route's current scope.
//
// UI conventions followed (per project's UI ruleset, still authoritative):
//   - 100% English UI text
//   - .toLocaleString("en-US") for numbers, never abbreviated (no "1.4M")
//   - Storage sizes shown as GB decimal (/1e9) AND GiB binary (/1024^3) side
//     by side, matching the "49.2 KB (48.0 KiB)" format already used
//     elsewhere in the Blobs Explorer list.
//
// NOTE: str()/num() JSX-safety helpers are referenced as if imported from
// this project's shared lib — swap the import path below for wherever they
// actually live if it differs from the placeholder used here.

"use client";

import { useEffect, useState, type ReactElement } from "react";
// import { str, num } from "@/lib/format"; // <-- adjust to actual path
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

export interface BlobPreviewTarget {
  network: "shelbynet"; // widen to include "testnet" once that gateway is confirmed
  owner: string;
  blobName: string;
  sizeBytes?: number;
  // Used purely as a cache-busting key (see previewUrl below) — ties the
  // browser/CDN cache entry to the actual file content rather than the URL
  // alone. CONFIRMED NEEDED this session: a Cloudflare edge cache entry
  // created while an earlier buggy version of the proxy route was live kept
  // serving corrupted bytes for up to an hour after the bug was fixed and
  // redeployed, because the cache key (the URL) never changed. Since
  // content_hash only changes when the file itself changes, appending it
  // means any future fix to route.ts naturally busts old cached entries too.
  contentHash?: string;
}

interface BlobPreviewPanelProps {
  target: BlobPreviewTarget | null;
  onClose: () => void;
}

type Kind = "image" | "pdf" | "text" | "video" | "audio" | "unsupported";

function kindForBlobName(blobName: string): Kind {
  const ext = blobName.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  // Matches route.ts's EXT_CONTENT_TYPE plain-text entries — keep these two
  // lists in sync when adding a new extension to either.
  if ([
    "txt", "json", "md", "log", "csv", "xml", "cfg", "ini", "yaml", "yml",
    "toml", "env", "conf", "sh", "html", "css", "js", "ts", "py",
  ].includes(ext)) return "text";
  if (["mp4", "webm"].includes(ext)) return "video";
  if (["mp3", "wav"].includes(ext)) return "audio";
  return "unsupported";
}

function formatBytesDual(bytes: number): string {
  // Small files read oddly as "0.0000 GB" — fall back to KB/KiB below 1e6
  // bytes, matching the format already used in the Blobs Explorer list
  // (e.g. "49.2 KB (48.0 KiB)").
  if (bytes < 1e6) {
    const kb  = (bytes / 1e3).toFixed(1);
    const kib = (bytes / 1024).toFixed(1);
    return `${kb} KB (${kib} KiB)`;
  }
  const gb  = (bytes / 1e9).toFixed(2);
  const gib = (bytes / 1024 ** 3).toFixed(2);
  return `${gb} GB (${gib} GiB)`;
}

function shortenAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-6)}` : addr;
}

export function BlobPreviewPanel({ target, onClose }: BlobPreviewPanelProps): ReactElement | null {
  const [textContent, setTextContent] = useState<string>("");
  const [textError, setTextError] = useState<string>("");
  const [textLoading, setTextLoading] = useState<boolean>(false);

  const kind = target ? kindForBlobName(target.blobName) : "unsupported";

  const previewUrl = target
    ? `/api/blobs/preview?network=${encodeURIComponent(target.network)}` +
      `&owner=${encodeURIComponent(target.owner)}` +
      `&name=${encodeURIComponent(target.blobName)}` +
      (target.contentHash ? `&ch=${encodeURIComponent(target.contentHash)}` : "")
    : "";

  const downloadUrl = previewUrl ? `${previewUrl}&download=1` : "";

  useEffect(() => {
    if (!target || kind !== "text") {
      setTextContent("");
      setTextError("");
      return;
    }

    let cancelled = false;
    setTextLoading(true);
    setTextError("");

    fetch(previewUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Preview fetch failed (${res.status})`);
        return res.text();
      })
      .then((body) => {
        if (!cancelled) setTextContent(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTextError(err instanceof Error ? err.message : "Failed to load preview");
        }
      })
      .finally(() => {
        if (!cancelled) setTextLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.owner, target?.blobName, target?.network]);

  if (!target) return null;

  const filename = target.blobName.split("/").pop() ?? target.blobName;

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preview-header">
          <div>
            <h2 className="preview-title">File Preview</h2>
            <div className="preview-filename">{str(filename)}</div>
            <div className="preview-meta">
              Owner: {shortenAddress(target.owner)}
              {target.sizeBytes !== undefined && (
                <> &middot; Size: {formatBytesDual(target.sizeBytes)}</>
              )}
            </div>
          </div>
          <button className="preview-close" onClick={onClose} aria-label="Close preview">
            ✕
          </button>
        </div>

        <div className="preview-actions">
          <a className="preview-btn" href={downloadUrl} download={filename}>
            ⭳ Download
          </a>
          <button
            className="preview-btn"
            onClick={() => {
              void navigator.clipboard.writeText(
                `${window.location.origin}${previewUrl}`,
              );
            }}
          >
            🔗 Share
          </button>
        </div>

        <div className="preview-body">
          {kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={filename} className="preview-image" />
          )}

          {kind === "pdf" && (
            <iframe src={previewUrl} title={filename} className="preview-pdf" />
          )}

          {kind === "video" && (
            <video src={previewUrl} controls className="preview-media" />
          )}

          {kind === "audio" && (
            <audio src={previewUrl} controls className="preview-media" />
          )}

          {kind === "text" && (
            <div className="preview-text-wrap">
              {textLoading && <div className="preview-status">Loading preview...</div>}
              {textError && <div className="preview-status preview-error">{str(textError)}</div>}
              {!textLoading && !textError && (
                <pre className="preview-text">{str(textContent)}</pre>
              )}
            </div>
          )}

          {kind === "unsupported" && (
            <div className="preview-status">
              Preview isn&apos;t available for this file type. Use Download instead.
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .preview-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
        }
        .preview-modal {
          background: var(--bg-primary, #fff);
          border-radius: 12px;
          width: min(720px, 92vw);
          max-height: 86vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
        }
        .preview-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 20px 24px 0;
        }
        .preview-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-secondary, #6b7280);
          margin: 0 0 4px;
        }
        .preview-filename {
          font-size: 18px;
          font-weight: 600;
          font-family: monospace;
        }
        .preview-meta {
          font-size: 13px;
          color: var(--text-secondary, #6b7280);
          margin-top: 4px;
        }
        .preview-close {
          background: none;
          border: none;
          font-size: 18px;
          cursor: pointer;
          color: var(--text-secondary, #6b7280);
        }
        .preview-actions {
          display: flex;
          gap: 8px;
          padding: 16px 24px;
        }
        .preview-btn {
          padding: 8px 14px;
          border-radius: 8px;
          border: 1px solid var(--border, #e5e7eb);
          background: var(--bg-card, #f9fafb);
          font-size: 13px;
          cursor: pointer;
          text-decoration: none;
          color: inherit;
        }
        .preview-body {
          flex: 1;
          overflow: auto;
          padding: 0 24px 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .preview-image {
          max-width: 100%;
          max-height: 60vh;
          border-radius: 8px;
        }
        .preview-pdf {
          width: 100%;
          height: 60vh;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 8px;
        }
        .preview-media {
          width: 100%;
        }
        .preview-text-wrap {
          width: 100%;
        }
        .preview-text {
          width: 100%;
          max-height: 60vh;
          overflow: auto;
          background: var(--bg-card, #f9fafb);
          border-radius: 8px;
          padding: 16px;
          font-size: 13px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .preview-status {
          color: var(--text-secondary, #6b7280);
          font-size: 14px;
          padding: 40px 0;
        }
        .preview-error {
          color: #dc2626;
        }
      `}</style>
    </div>
  );
}