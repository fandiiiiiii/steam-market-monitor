import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steam 市场监控",
  description: "监控 Steam 市场商品上架与求购，企业微信推送提醒",
};

export const viewport: Viewport = {
  themeColor: "#171a21",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
