import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shelby Benchmark — Đo Hiệu Năng Mạng Lưu Trữ Phi Tập Trung",
  description: "Công cụ đo hiệu năng Shelby Protocol trên Shelbynet — upload speed, download speed, blockchain latency. So sánh với AWS S3, GCP, Azure.",
  openGraph: {
    title: "Shelby Benchmark",
    description: "Đo hiệu năng mạng lưu trữ phi tập trung Shelby vs Cloud",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body style={{ margin: 0, padding: 0, background: "#020810" }}>
        {children}
      </body>
    </html>
  );
}