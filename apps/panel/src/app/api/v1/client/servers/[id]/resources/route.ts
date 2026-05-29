import { route, json } from "@/lib/http";
import { authApi } from "@/lib/api-auth";
import { getServerContext } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

export const GET = route(async (req, ctx: { params: { id: string } }) => {
  const { user } = await authApi(req);
  const c = await getServerContext(user, ctx.params.id);
  try {
    const status = await new DaemonClient(c.node).status(c.server.id);
    return json({ state: status.state, resources: status.stats, players: status.players });
  } catch {
    return json({ state: c.server.state, resources: null, players: null });
  }
});
