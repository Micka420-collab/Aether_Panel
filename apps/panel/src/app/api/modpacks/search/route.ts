import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { searchModrinth, resolveGameVersion } from "@/lib/modrinth";

export const dynamic = "force-dynamic";

/**
 * Modpack search for the create-server wizard ("Deploy from a modpack").
 *
 * Unlike /api/servers/[id]/mods/search this is *pre-creation* — there is no
 * server context yet — so we only require an authenticated user and proxy a
 * plain Modrinth modpack search. The selected slug is fed back to the wizard as
 * MODRINTH_MODPACK; itzg installs it from that env var on first boot.
 *
 *   GET /api/modpacks/search?q=<query>&source=modrinth[&loader=fabric&version=1.21]
 */
export const GET = route(async (req) => {
  await requireUser();

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const source = url.searchParams.get("source") ?? "modrinth";
  const loaderParam = url.searchParams.get("loader");
  const loader = loaderParam && loaderParam.trim() ? loaderParam.trim().toLowerCase() : null;
  // Optional version filter — resolves LATEST/SNAPSHOT to a concrete game version.
  const versionParam = url.searchParams.get("version");
  const version = versionParam ? await resolveGameVersion(versionParam) : null;

  // Only Modrinth is supported here (CurseForge modpacks aren't installable via a
  // single env var); other sources return an empty result rather than erroring.
  if (source !== "modrinth") {
    return json({ hits: [], source, query: q });
  }

  const hits = await searchModrinth(q, { type: "modpack", loader, version, limit: 24 });
  return json({ hits, source: "modrinth", query: q });
});
