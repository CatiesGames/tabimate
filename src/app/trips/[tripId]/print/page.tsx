import type { Viewport } from "next";

import { PrintView } from "@/components/print/PrintView";

// 列印頁=固定紙面寬度(非響應式):手機以整頁縮小呈現、可捏合縮放,
// 與桌機看到的版面完全相同;列印出的 PDF 也因此兩端一致。
// 註:Next 會與 root layout 的 viewport 合併,root 為了輸入框防縮放設了
// user-scalable=no,這裡必須顯式覆寫回可縮放。
export const viewport: Viewport = {
  width: "800",
  initialScale: 0.5,
  minimumScale: 0.2,
  maximumScale: 5,
  userScalable: true,
};

export default async function TripPrintPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <PrintView tripId={tripId} />;
}
