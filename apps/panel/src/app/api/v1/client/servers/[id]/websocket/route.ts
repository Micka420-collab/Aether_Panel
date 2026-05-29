import { route, json } from "@/lib/http";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext } from "@/lib/access";
import { DaemonClient, signWsToken } from "@/lib/daemon";

/** Short-lived token + socket URL for the launcher to stream live console/stats. */
export const GET = route(async (req, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "control.console");
  // the WS token is capped to the token's scopes, not the user's full set
  const token = await signWsToken(c.node, c.server.id, principal.scopes);
  return json({ token, socket: new DaemonClient(c.node).wsUrl(c.server.id) });
});
