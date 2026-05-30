import { z } from "zod";
import { route, json, noContent } from "@/lib/http";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

// GET — read a (text) file's content
export const GET = route(async (req: Request, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "file.read");
  assertScope(c, "file.read");
  const path = new URL(req.url).searchParams.get("path") ?? "";
  return json(await new DaemonClient(c.node).readFile(c.server.id, path));
});

// PUT — write a (text) file's content
const writeSchema = z.object({ path: z.string().min(1).max(1024), content: z.string().max(6 * 1024 * 1024) });
export const PUT = route(async (req: Request, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "file.write");
  assertScope(c, "file.write");
  assertNotSuspended(c);
  const { path, content } = writeSchema.parse(await req.json());
  await new DaemonClient(c.node).writeFile(c.server.id, path, content);
  return noContent();
});
