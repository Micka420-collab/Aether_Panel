import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { json, noContent, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { buildServerSpec } from "@/lib/spec";
import { DaemonClient } from "@/lib/daemon";
import { modContext, checkCompatibility, resolveGameVersion } from "@/lib/modrinth";
import { isCurseforgeConfigured } from "@/lib/curseforge";
import { audit } from "@/lib/audit";

function parseList(v?: string): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

async function applyEnv(serverId: string, env: Record<string, string>) {
  const updated = await db.server.update({
    where: { id: serverId },
    data: { environment: env as object },
    include: { allocations: true, node: true },
  });
  // re-send the build spec so the change applies on next (re)start
  await new DaemonClient(updated.node).registerServer(buildServerSpec(updated, updated.allocations));
}

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "startup.read");
  const env = (c.server.environment as Record<string, string>) ?? {};
  return json({
    installed: parseList(env.MODRINTH_PROJECTS),
    curseforge: parseList(env.CURSEFORGE_FILES),
    modpack: env.MODRINTH_MODPACK || null,
    context: modContext(env),
    curseforgeEnabled: isCurseforgeConfigured(),
  });
});

const installSchema = z.object({
  slug: z.string().min(1).max(120),
  type: z.enum(["mod", "plugin", "modpack"]),
  source: z.enum(["modrinth", "curseforge"]).default("modrinth"),
});

export const POST = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "startup.update");
  const { slug, type, source } = installSchema.parse(await req.json());
  const env = { ...((c.server.environment as Record<string, string>) ?? {}) };

  if (source === "curseforge") {
    if (!isCurseforgeConfigured()) throw new HttpError(503, "CurseForge is not enabled on this platform");
    if (type === "modpack") throw new HttpError(400, "CurseForge modpacks aren't supported yet — use Modrinth");
    const set = new Set(parseList(env.CURSEFORGE_FILES));
    set.add(slug);
    env.CURSEFORGE_FILES = [...set].join(",");
  } else if (type === "modpack") {
    env.MODRINTH_MODPACK = slug;
  } else {
    // Verify the project actually has an installable build for THIS server's
    // loader + Minecraft version, so an incompatible plugin can never block the
    // server from booting (the itzg image aborts on an unresolvable project).
    const mc = modContext(env);
    const gameVersion = await resolveGameVersion(env.VERSION);
    let compat;
    try {
      compat = await checkCompatibility(slug, mc.loader, gameVersion);
    } catch (e: any) {
      throw new HttpError(422, e?.message ?? "Could not verify plugin compatibility");
    }
    if (!compat.compatible) {
      const where = `${mc.loader ?? "this loader"}${gameVersion ? ` ${gameVersion}` : ""}`;
      const hint = compat.onlyAlpha
        ? ` Only an unstable alpha build exists for ${where}, so it wasn't installed.`
        : compat.supportedGameVersions.length
          ? ` It supports: ${compat.supportedGameVersions.slice(0, 10).join(", ")}.`
          : "";
      throw new HttpError(422, `"${slug}" has no compatible build for ${where}.${hint}`);
    }
    const set = new Set(parseList(env.MODRINTH_PROJECTS));
    set.add(slug);
    env.MODRINTH_PROJECTS = [...set].join(",");
    // Accept release + beta builds — right after a Minecraft release, plugins
    // frequently only ship betas for the new version.
    env.MODRINTH_ALLOWED_VERSION_TYPE = "beta";
  }
  await applyEnv(c.server.id, env);
  await audit("mod.install", { userId: user.id, serverId: c.server.id, metadata: { slug, type, source } });
  return json({
    ok: true,
    installed: parseList(env.MODRINTH_PROJECTS),
    curseforge: parseList(env.CURSEFORGE_FILES),
    modpack: env.MODRINTH_MODPACK || null,
  });
});

export const DELETE = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "startup.update");
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  const type = url.searchParams.get("type");
  const source = url.searchParams.get("source") ?? "modrinth";
  const env = { ...((c.server.environment as Record<string, string>) ?? {}) };

  if (source === "curseforge" && slug) {
    env.CURSEFORGE_FILES = parseList(env.CURSEFORGE_FILES).filter((s) => s !== slug).join(",");
  } else if (type === "modpack") {
    delete env.MODRINTH_MODPACK;
  } else if (slug) {
    env.MODRINTH_PROJECTS = parseList(env.MODRINTH_PROJECTS).filter((s) => s !== slug).join(",");
  }
  await applyEnv(c.server.id, env);
  return noContent();
});
