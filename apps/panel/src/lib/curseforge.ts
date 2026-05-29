import "server-only";
import { env } from "./env";
import type { ModHit } from "./modrinth";

const API = "https://api.curseforge.com/v1";
const GAME_ID = 432; // Minecraft

const CLASS_ID: Record<string, number> = { mod: 6, modpack: 4471, plugin: 5 };

// itzg TYPE → CurseForge modLoaderType
const LOADER_TYPE: Record<string, number> = { FORGE: 1, FABRIC: 4, QUILT: 5, NEOFORGE: 6 };

export function isCurseforgeConfigured(): boolean {
  return !!env.curseforgeKey;
}

export function cfLoaderType(itzgType: string): number | undefined {
  return LOADER_TYPE[(itzgType ?? "").toUpperCase()];
}

export async function searchCurseforge(
  query: string,
  opts: { type: "mod" | "plugin" | "modpack"; modLoaderType?: number; version?: string | null; limit?: number },
): Promise<ModHit[]> {
  if (!isCurseforgeConfigured()) throw new Error("CurseForge is not configured");
  const url = new URL(`${API}/mods/search`);
  url.searchParams.set("gameId", String(GAME_ID));
  url.searchParams.set("classId", String(CLASS_ID[opts.type] ?? 6));
  if (query) url.searchParams.set("searchFilter", query);
  if (opts.version) url.searchParams.set("gameVersion", opts.version);
  if (opts.modLoaderType && opts.type !== "modpack") url.searchParams.set("modLoaderType", String(opts.modLoaderType));
  url.searchParams.set("pageSize", String(opts.limit ?? 20));
  url.searchParams.set("sortField", query ? "2" : "6"); // 2=popularity-ish/relevancy, 6=total downloads
  url.searchParams.set("sortOrder", "desc");

  const res = await fetch(url, { headers: { "x-api-key": env.curseforgeKey, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`CurseForge search failed (${res.status})`);
  const data = (await res.json()) as { data: any[] };
  return data.data.map((m) => ({
    projectId: String(m.id),
    slug: m.slug,
    title: m.name,
    description: m.summary ?? "",
    icon: m.logo?.thumbnailUrl || null,
    downloads: m.downloadCount ?? 0,
    follows: m.thumbsUpCount ?? 0,
    author: m.authors?.[0]?.name ?? "",
    projectType: opts.type,
    categories: (m.categories ?? []).map((c: any) => c.slug).slice(0, 4),
  }));
}
