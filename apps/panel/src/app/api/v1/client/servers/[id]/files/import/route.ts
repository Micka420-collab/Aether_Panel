import { route, json } from "@/lib/http";
import { HttpError } from "@/lib/auth";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

export const runtime = "nodejs";
export const maxDuration = 600;

// POST — upload a .zip/.tar.gz and extract it into the server volume (modpack/world).
//   POST /api/v1/client/servers/:id/files/import?name=pack.zip&clear=1   (raw archive body)
export const POST = route(async (req: Request, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "file.archive");
  assertScope(c, "file.archive");
  assertNotSuspended(c);
  const url = new URL(req.url);
  const name = url.searchParams.get("name") ?? "archive.zip";
  const clear = url.searchParams.get("clear") === "1";
  if (!req.body) throw new HttpError(400, "No archive uploaded");
  const result = await new DaemonClient(c.node).importArchive(c.server.id, name, req.body, clear);
  return json(result);
});
