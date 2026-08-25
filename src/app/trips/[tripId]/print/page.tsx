import { PrintView } from "@/components/print/PrintView";

export default async function TripPrintPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <PrintView tripId={tripId} />;
}
