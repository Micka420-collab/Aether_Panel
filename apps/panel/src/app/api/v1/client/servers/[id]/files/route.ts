import { z } from "zod";
import { route, json, noContent } from "@/lib/http";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";
import { audit } from "@/lib/audit";

// GET — list a directory
export const GET = route(async (req: Request, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "file.read");
  assertScope(c, "file.read");
  const path = new URL(req.url).searchParams.get("path") ?? "/";
  return json(await new DaemonClient(c.node).listFiles(c.server.id, path));
});

// POST — mkdir / rename
const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("mkdir"), path: z.string().min(1) }),
  z.object({ op: z.literal("rename"), from: z.string().min(1), to: z.string().min(1) }),
]);
export const POST = route(async (req: Request, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "file.write");
  assertScope(c, "file.write");
  assertNotSuspended(c);
  const body = opSchema.parse(await req.json());
  const client = new DaemonClient(c.node);
  if (body.op === "mkdir") await client.mkdir(c.server.id, body.path);
  else await client.renameFile(c.server.id, body.from, body.to);
  await audit("server.files.mutate", { userId: principal.user.id, serverId: c.server.id, metadata: { op: body.op, via: principal.via } });
  return noContent();
});

// DELETE — remove a file/dir
export const DELETE = route(async (req: Request, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "file.delete");
  assertScope(c, "file.delete");
  assertNotSuspended(c);
  const path = new URL(req.url).searchParams.get("path") ?? "";
  await new DaemonClient(c.node).deleteFile(c.server.id, path);
  await audit("server.files.mutate", { userId: principal.user.id, serverId: c.server.id, metadata: { op: "delete", via: principal.via } });
  return noContent();
});
