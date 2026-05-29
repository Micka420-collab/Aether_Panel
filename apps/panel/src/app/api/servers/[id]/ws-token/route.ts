import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { DaemonClient, signWsToken } from "@/lib/daemon";

/**
 * Mint a short-lived JWT + the daemon WebSocket URL so the browser can stream
 * live console & stats directly from the node (the token is HMAC-signed with
 * the node's shared secret and scoped to this one server).
 */
export const GET = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "control.console");
  const token = await signWsToken(c.node, c.server.id, c.scopes);
  return json({ token, socket: new DaemonClient(c.node).wsUrl(c.server.id) });
});
