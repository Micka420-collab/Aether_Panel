import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { searchModrinth, modContext } from "@/lib/modrinth";
import { searchCurseforge, cfLoaderType, isCurseforgeConfigured } from "@/lib/curseforge";

export const dynamic = "force-dynamic";

export const GET = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "startup.read");

  const env = (c.server.environment as Record<string, string>) ?? {};
  const mc = modContext(env);
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const type = (url.searchParams.get("type") as "mod" | "plugin" | "modpack") || mc.defaultType;
  const source = url.searchParams.get("source") ?? "modrinth";

  if (source === "curseforge") {
    if (!isCurseforgeConfigured()) return json({ hits: [], context: mc, type, error: "CurseForge not configured" });
    const hits = await searchCurseforge(q, { type, modLoaderType: cfLoaderType(env.TYPE ?? ""), version: mc.version });
    return json({ hits, context: mc, type, source });
  }

  const hits = await searchModrinth(q, { type, loader: mc.loader, version: mc.version });
  return json({ hits, context: mc, type, source: "modrinth" });
});
