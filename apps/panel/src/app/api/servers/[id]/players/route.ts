import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

/**
 * Live player list for a server. Reuses the daemon's RCON-backed status snapshot
 * (`status.players`) which the node refreshes from the Minecraft `list` command.
 * Gated on `players.read`. Returns a stable shape even when the node is
 * unreachable or the template can't report players.
 */
export const GET = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "players.read");

  let players: { online: number; max: number; sample: string[] } = { online: 0, max: 0, sample: [] };
  let online = false;
  try {
    const status = await new DaemonClient(c.node).status(c.server.id);
    online = status.state === "running";
    const p = status.players as { online?: number; max?: number; sample?: string[] } | null;
    if (p) {
      players = {
        online: p.online ?? 0,
        max: p.max ?? 0,
        sample: Array.isArray(p.sample) ? p.sample : [],
      };
    }
  } catch {
    /* node unreachable -> report empty list, online=false */
  }

  return json({ players, online });
});
