import "server-only";

const UA = "Aether-Panel/1.0 (self-hosted game hosting)";
const API = "https://api.modrinth.com/v2";

/** Map an itzg TYPE to a Modrinth loader facet value. */
const LOADER_MAP: Record<string, string> = {
  PAPER: "paper",
  PURPUR: "purpur",
  SPIGOT: "spigot",
  BUKKIT: "bukkit",
  FABRIC: "fabric",
  FORGE: "forge",
  NEOFORGE: "neoforge",
  QUILT: "quilt",
};

const PLUGIN_LOADERS = new Set(["paper", "purpur", "spigot", "bukkit"]);

export interface ModHit {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  icon: string | null;
  downloads: number;
  follows: number;
  author: string;
  projectType: string;
  categories: string[];
}

export interface ModSearchContext {
  loader: string | null;
  version: string | null;
  /** project type appropriate for this server: "mod" | "plugin" | "modpack" */
  defaultType: "mod" | "plugin" | "modpack";
}

export function modContext(env: Record<string, string>): ModSearchContext {
  const loader = LOADER_MAP[(env.TYPE ?? "").toUpperCase()] ?? null;
  const version = env.VERSION && !["LATEST", "SNAPSHOT", ""].includes(env.VERSION) ? env.VERSION : null;
  const defaultType = loader && PLUGIN_LOADERS.has(loader) ? "plugin" : "mod";
  return { loader, version, defaultType };
}

export async function searchModrinth(
  query: string,
  opts: { type: "mod" | "plugin" | "modpack"; loader: string | null; version: string | null; limit?: number },
): Promise<ModHit[]> {
  const facets: string[][] = [[`project_type:${opts.type}`]];
  if (opts.loader && opts.type !== "modpack") facets.push([`categories:${opts.loader}`]);
  if (opts.version) facets.push([`versions:${opts.version}`]);

  const url = new URL(`${API}/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(opts.limit ?? 20));
  url.searchParams.set("index", query ? "relevance" : "downloads");
  url.searchParams.set("facets", JSON.stringify(facets));

  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`Modrinth search failed (${res.status})`);
  const data = (await res.json()) as { hits: any[] };
  return data.hits.map((h) => ({
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    icon: h.icon_url || null,
    downloads: h.downloads ?? 0,
    follows: h.follows ?? 0,
    author: h.author ?? "",
    projectType: h.project_type,
    categories: h.categories ?? [],
  }));
}
