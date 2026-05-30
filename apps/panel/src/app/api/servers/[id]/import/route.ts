import { requireUser, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

// Streaming archive upload — keep on the Node runtime and allow a long upload.
export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * Import an existing server: the request body is the raw archive (.zip/.tar.gz),
 * streamed straight to the node which extracts it into the server volume.
 *   POST /api/servers/:id/import?name=<file>&clear=1
 */
export const POST = route(async (req: Request, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "file.write");
  assertNotSuspended(c);

  const url = new URL(req.url);
  const name = url.searchParams.get("name") ?? "archive.zip";
  const clear = url.searchParams.get("clear") === "1";
  if (!req.body) throw new HttpError(400, "No archive uploaded");

  const result = await new DaemonClient(c.node).importArchive(c.server.id, name, req.body, clear);
  return json(result);
});
