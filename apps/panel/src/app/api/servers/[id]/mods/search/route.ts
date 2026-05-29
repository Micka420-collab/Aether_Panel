import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { searchModrinth, modContext, resolveGameVersion } from "@/lib/modrinth";
import { searchCurseforge, cfLoaderType, isCurseforgeConfigured } from "@/lib/curseforge";

export const dynamic = "force-dynamic";

export const GET = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "startup.read");

  const env = (c.server.environment as Record<string, string>) ?? {};
  const mc = modContext(env);
  // Resolve LATEST/SNAPSHOT to a concrete version so search is filtered to what
  // actually runs on this server (otherwise incompatible plugins show up).
  const gameVersion = await resolveGameVersion(env.VERSION);
  const searchCtx = { ...mc, version: gameVersion };
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const type = (url.searchParams.get("type") as "mod" | "plugin" | "modpack") || mc.defaultType;
  const source = url.searchParams.get("source") ?? "modrinth";

  if (source === "curseforge") {
    if (!isCurseforgeConfigured()) return json({ hits: [], context: searchCtx, type, error: "CurseForge not configured" });
    const hits = await searchCurseforge(q, { type, modLoaderType: cfLoaderType(env.TYPE ?? ""), version: gameVersion });
    return json({ hits, context: searchCtx, type, source });
  }

  const hits = await searchModrinth(q, { type, loader: mc.loader, version: gameVersion });
  return json({ hits, context: searchCtx, type, source: "modrinth" });
});
