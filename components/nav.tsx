"use client";
// components/nav.tsx — v3.2 Responsive
// FIX: Bỏ position:absolute cho tabs (gây đè nhau khi thu nhỏ)
// FIX: Grid layout 3 cột tự co giãn đúng
// FIX: Network switcher luôn hiển thị, ẩn label trên mobile

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNetwork, type NetworkId } from "./network-context";

const NAV_LINKS = [
  { href: "/dashboard/providers", label: "Globe"     },
  { href: "/dashboard",           label: "Dashboard" },
  { href: "/dashboard/charts",    label: "Charts"    },
  { href: "/",                    label: "Benchmark" },
];

export function Nav() {
  const pathname = usePathname();
  const { network, setNetwork } = useNetwork();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname?.startsWith(href) ?? false;
  };

  return (
    <>
      <style>{`
        .sn { position:sticky;top:0;z-index:200;height:60px;background:rgba(255,255,255,0.97);backdrop-filter:blur(20px);border-bottom:1px solid #EBEBEB;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:0 28px;box-shadow:0 1px 3px rgba(0,0,0,0.05); }
        .sn-logo { display:flex;align-items:center;gap:8px;text-decoration:none;flex-shrink:0; }
        .sn-logo-text { font-weight:700;font-size:15px;color:#0A0A0A;letter-spacing:-0.3px;white-space:nowrap; }
        .sn-logo-text span { color:#059669;font-weight:500; }
        .sn-tabs { display:flex;align-items:center;justify-content:center;gap:1px;background:#F4F4F4;border-radius:12px;padding:3px;overflow:hidden;min-width:0; }
        .sn-tab { padding:6px 16px;border-radius:9px;font-size:13.5px;font-weight:400;color:#999;background:transparent;text-decoration:none;transition:all .15s;white-space:nowrap;flex-shrink:0; }
        .sn-tab.active { font-weight:600;color:#0A0A0A;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.09),0 0 0 1px rgba(0,0,0,0.04); }
        .sn-right { display:flex;align-items:center;gap:8px;flex-shrink:0; }
        .sn-netsw { display:flex;gap:2px;background:#F4F4F4;border-radius:10px;padding:3px;flex-shrink:0; }
        .sn-netbtn { display:flex;align-items:center;gap:5px;padding:5px 11px;border-radius:8px;font-size:12.5px;font-weight:400;color:#999;background:transparent;border:none;cursor:pointer;transition:all .15s;white-space:nowrap; }
        .sn-netbtn.sn-shelby { font-weight:600;color:#1d4ed8;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.08); }
        .sn-netbtn.sn-testnet { font-weight:600;color:#7c3aed;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.08); }
        .sn-dot { width:6px;height:6px;border-radius:50%;flex-shrink:0;transition:all .15s; }
        .sn-docs { color:#999;text-decoration:none;font-size:13px;padding:6px 12px;border-radius:9px;border:1px solid #E8E8E8;white-space:nowrap;transition:all .15s; }
        .sn-docs:hover { color:#555;border-color:#CCC; }

        @media (max-width:1024px) {
          .sn { padding:0 18px;gap:8px; }
          .sn-tab { padding:6px 12px;font-size:13px; }
          .sn-netbtn { padding:5px 9px;font-size:12px; }
        }
        @media (max-width:860px) {
          .sn-docs { display:none; }
          .sn-tab { padding:6px 10px;font-size:12.5px; }
        }
        @media (max-width:720px) {
          .sn-netlabel { display:none; }
          .sn-netbtn { padding:6px 7px; }
          .sn-analytics { display:none; }
        }
        @media (max-width:600px) {
          .sn { height:auto;grid-template-columns:1fr auto;grid-template-rows:auto auto;padding:10px 16px;gap:6px; }
          .sn-logo { grid-column:1;grid-row:1; }
          .sn-right { grid-column:2;grid-row:1;justify-content:flex-end; }
          .sn-tabs { grid-column:1/-1;grid-row:2; }
          .sn-tab { flex:1;text-align:center;padding:6px 2px;font-size:12px; }
        }
      `}</style>

      <nav className="sn">
        {/* Logo */}
        <Link href="/" className="sn-logo">
          <img src="/logo.png" alt="Shelby" width={28} height={28}
            style={{ borderRadius:7, objectFit:"contain", flexShrink:0 }} />
          <span className="sn-logo-text">
            Shelby <span className="sn-analytics">Analytics</span>
          </span>
        </Link>

        {/* Tabs */}
        <div className="sn-tabs">
          {NAV_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`sn-tab${isActive(link.href) ? " active" : ""}`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Right */}
        <div className="sn-right">
          {/* Network Switcher */}
          <div className="sn-netsw">
            {(["shelbynet", "testnet"] as NetworkId[]).map(id => {
              const active   = network === id;
              const isShelby = id === "shelbynet";
              const dotColor = isShelby ? "#2563eb" : "#9333ea";
              return (
                <button
                  key={id}
                  onClick={() => setNetwork(id)}
                  className={`sn-netbtn${active ? (isShelby ? " sn-shelby" : " sn-testnet") : ""}`}
                  title={isShelby ? "Shelbynet" : "Testnet"}
                >
                  <span className="sn-dot" style={{
                    background: active ? dotColor : "#CCC",
                    boxShadow:  active ? `0 0 5px ${dotColor}` : "none",
                  }} />
                  <span className="sn-netlabel">
                    {isShelby ? "Shelbynet" : "Testnet"}
                  </span>
                </button>
              );
            })}
          </div>

          <a href="https://docs.shelby.xyz" target="_blank" rel="noreferrer" className="sn-docs">
            Docs ↗
          </a>
        </div>
      </nav>
    </>
  );
}