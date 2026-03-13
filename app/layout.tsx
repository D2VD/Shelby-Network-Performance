// 📁 app/layout.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shelby Benchmark — Shelbynet Performance",
  description: "Measure real upload speed, download speed, blockchain latency on Shelby Protocol.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body suppressHydrationWarning style={{ margin: 0, padding: 0, background: "#FAFAFA" }}>
        {children}
      </body>
    </html>
  );
}