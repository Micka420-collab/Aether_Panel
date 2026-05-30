import { route, json } from "@/lib/http";
import { HttpError } from "@/lib/auth";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

export const runtime = "nodejs";
export const maxDuration = 600;

// POST — stream-upload a single file (e.g. a mod jar, world.zip) into a directory.
//   POST /api/v1/client/servers/:id/files/upload?path=/mods&name=cool-mod.jar   (raw body)
export const POST = route(async (req: Request, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "file.write");
  assertScope(c, "file.write");
  assertNotSuspended(c);
  const url = new URL(req.url);
  const dir = url.searchParams.get("path") ?? "/";
  const name = url.searchParams.get("name") ?? "upload.bin";
  if (!req.body) throw new HttpError(400, "No file uploaded");
  await new DaemonClient(c.node).uploadFile(c.server.id, dir, name, req.body);
  return json({ ok: true, name });
});
