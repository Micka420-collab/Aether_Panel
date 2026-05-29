import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

export const GET = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "file.read");
  const path = new URL(req.url).searchParams.get("path") ?? "";
  return json(await new DaemonClient(c.node).readFile(c.server.id, path));
});
