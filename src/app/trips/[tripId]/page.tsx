import { TripWorkspace } from "@/components/workspace/TripWorkspace";
import { WorkspaceProvider } from "@/lib/workspace/WorkspaceProvider";

export default async function TripWorkspacePage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return (
    <WorkspaceProvider tripId={tripId}>
      <TripWorkspace />
    </WorkspaceProvider>
  );
}
