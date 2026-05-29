import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { json, noContent, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

export const GET = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "file.read");
  const path = new URL(req.url).searchParams.get("path") ?? "/";
  return json(await new DaemonClient(c.node).listFiles(c.server.id, path));
});

const writeSchema = z.object({ path: z.string().min(1).max(1024), content: z.string().max(6 * 1024 * 1024) });
export const PUT = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "file.write");
  const { path, content } = writeSchema.parse(await req.json());
  await new DaemonClient(c.node).writeFile(c.server.id, path, content);
  return noContent();
});

const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("mkdir"), path: z.string().min(1) }),
  z.object({ op: z.literal("rename"), from: z.string().min(1), to: z.string().min(1) }),
]);
export const POST = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "file.write");
  const body = opSchema.parse(await req.json());
  const client = new DaemonClient(c.node);
  if (body.op === "mkdir") await client.mkdir(c.server.id, body.path);
  else await client.renameFile(c.server.id, body.from, body.to);
  return noContent();
});

export const DELETE = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "file.delete");
  const path = new URL(req.url).searchParams.get("path") ?? "";
  await new DaemonClient(c.node).deleteFile(c.server.id, path);
  return noContent();
});
