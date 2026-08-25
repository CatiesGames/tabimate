import { requireTripUser, requireUser } from "../auth";
import { HttpError, json, readJson, route } from "../http";
import { getProposal, listProposals, resolveProposal } from "../proposals";

export function registerProposalRoutes() {
  route("GET", "/api/trips/:tripId/proposals", (ctx) => {
    requireTripUser(ctx, ctx.params.tripId);
    const status = ctx.url.searchParams.get("status") ?? undefined;
    return json({ proposals: listProposals(ctx.params.tripId, status) });
  });

  route("POST", "/api/proposals/:proposalId/confirm", (ctx) => {
    const { user } = requireUser(ctx);
    const proposal = getProposal(ctx.params.proposalId);
    if (proposal.tripId !== user.trip_id) throw new HttpError(403, "forbidden");
    try {
      return json({ proposal: resolveProposal(ctx.params.proposalId, "confirm", user.id) });
    } catch (e) {
      if (e instanceof HttpError && e.code === "already_resolved") {
        // 靜默收斂:回最新狀態讓輸家渲染同一結果
        return json({ proposal: getProposal(ctx.params.proposalId), alreadyResolved: true });
      }
      throw e;
    }
  });

  route("POST", "/api/proposals/:proposalId/reject", async (ctx) => {
    const { user } = requireUser(ctx);
    const proposal = getProposal(ctx.params.proposalId);
    if (proposal.tripId !== user.trip_id) throw new HttpError(403, "forbidden");
    const body = await readJson<{ note?: string }>(ctx.req).catch(() => ({}) as { note?: string });
    try {
      return json({
        proposal: resolveProposal(ctx.params.proposalId, "reject", user.id, body.note),
      });
    } catch (e) {
      if (e instanceof HttpError && e.code === "already_resolved") {
        return json({ proposal: getProposal(ctx.params.proposalId), alreadyResolved: true });
      }
      throw e;
    }
  });
}
