import type { Metadata, Viewport } from "next";
import { Noto_Sans_TC, Outfit } from "next/font/google";

import "./globals.css";

const notoSansTC = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-tc",
  adjustFontFallback: false,
});

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: {
    default: "tabimate — 一起規劃旅程",
    template: "%s · tabimate",
  },
  description: "多人即時協作的旅遊行程規劃,內建 AI 旅遊助手",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 手機聚焦輸入框(塔比對話等)時瀏覽器會自動放大頁面,鎖定縮放避免版面被撐走
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW" className={`${notoSansTC.variable} ${outfit.variable}`}>
      <body>{children}</body>
    </html>
  );
}
