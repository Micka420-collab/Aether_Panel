import { requireUser, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

// Streaming single-file upload — keep on the Node runtime and allow a long upload.
export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * Upload a single file into the server volume. The request body is the raw file
 * bytes, streamed straight through to the node without buffering.
 *   POST /api/servers/:id/files/upload?path=<dir>&name=<file>
 * Defaults to the volume root and keeps the uploaded filename when omitted.
 */
export const POST = route(async (req: Request, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "file.write");
  assertNotSuspended(c);

  const url = new URL(req.url);
  const dir = url.searchParams.get("path") ?? "/";
  const name = url.searchParams.get("name");
  if (!name) throw new HttpError(400, "Missing file name");
  if (!req.body) throw new HttpError(400, "No file uploaded");

  await new DaemonClient(c.node).uploadFile(c.server.id, dir, name, req.body);
  return json({ ok: true });
});
