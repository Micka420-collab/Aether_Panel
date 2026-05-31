import "server-only";

/**
 * Mod Conflict Doctor — heuristic analyzer for a Minecraft server's installed
 * mods/plugins. It is intentionally PURE and DEPENDENCY-FREE: it takes a flat
 * list of jar filenames (as produced by the daemon file API) plus a small
 * context object (loader + MC version) and returns a structured report. No
 * network calls, no secrets, resilient to unknown/garbage filenames — every
 * heuristic is best-effort and degrades to "info"/silence when unsure.
 *
 * Callers (the API route) are responsible for listing the directory via the
 * daemon and for actually moving jars; this module never touches the FS.
 */

export type IssueLevel = "error" | "warn" | "info";
export type IssueFix = "quarantine";

export interface ModFile {
  /** bare filename, e.g. "sodium-fabric-0.5.3.jar" */
  name: string;
  /** full daemon path, e.g. "/mods/sodium-fabric-0.5.3.jar" */
  path: string;
  size?: number;
}

export interface ModDoctorContext {
  /** itzg TYPE lowercased family, e.g. "fabric" | "paper" | "forge" | null */
  loader: string | null;
  /** concrete MC version if known, e.g. "1.20.4", else null */
  mcVersion: string | null;
  /** which folder we scanned: "mods" (Fabric/Forge) or "plugins" (Paper/Spigot) */
  kind: "mods" | "plugins";
}

export interface ModIssue {
  level: IssueLevel;
  /** filename the issue is about (or the canonical/first one for grouped issues) */
  file: string;
  /** machine-readable category */
  kind:
    | "duplicate-id"
    | "duplicate-jar"
    | "client-only"
    | "loader-mismatch"
    | "version-mismatch"
    | "missing-dependency"
    | "disabled"
    | "non-jar";
  message: string;
  /** offered remediation, if any */
  fix?: IssueFix;
  /** sibling files involved (e.g. the other copies of a duplicate) */
  related?: string[];
}

export interface ModDoctorSummary {
  scanned: number;
  jars: number;
  errors: number;
  warnings: number;
  infos: number;
  loader: string | null;
  mcVersion: string | null;
  kind: "mods" | "plugins";
}

export interface ModDoctorReport {
  issues: ModIssue[];
  summary: ModDoctorSummary;
}

// ── known client-only mods (never belong on a dedicated server) ──────────────
// Conservative, well-known list keyed by normalized mod id; matching is by
// substring on the normalized filename so version suffixes don't matter.
const CLIENT_ONLY_IDS = new Set([
  "optifine",
  "optifabric",
  "iris",
  "irisshaders",
  "sodium", // sodium is client-render only (server uses lithium/phosphor)
  "indium",
  "reeses-sodium-options",
  "reesessodiumoptions",
  "sodiumextra",
  "continuity",
  "entityculling",
  "entity-culling",
  "betterfps",
  "dynamiclights",
  "dynamic-lights",
  "xaerosminimap",
  "xaeros-minimap",
  "xaerosworldmap",
  "journeymap", // journeymap ships a server jar too, but the standalone client jar is client-only
  "voxelmap",
  "jei", // JEI is client-side; servers want the *-api split, the full jar is client-only
  "justenoughitems",
  "modmenu",
  "mod-menu",
  "controlling",
  "fancymenu",
  "drippyloadingscreen",
  "blur",
  "lambdynamiclights",
  "zoomify",
  "wisla",
  "fullbrightnesstoggle",
  "shoulder-surfing",
  "shouldersurfing",
  "physicsmod",
  "replaymod",
]);

// Loader family aliases → canonical family. Plugins (paper/spigot/bukkit) and
// mods (fabric/forge/neoforge/quilt) are two different worlds entirely.
const PLUGIN_FAMILY = new Set(["paper", "purpur", "spigot", "bukkit", "folia"]);
const FABRIC_FAMILY = new Set(["fabric", "quilt"]);
const FORGE_FAMILY = new Set(["forge", "neoforge"]);

/** Tokens in a filename that betray which loader a jar was built for. */
const LOADER_HINTS: { token: RegExp; family: "plugin" | "fabric" | "forge" }[] = [
  { token: /(^|[-_])fabric([-_.]|$)/i, family: "fabric" },
  { token: /(^|[-_])quilt([-_.]|$)/i, family: "fabric" },
  { token: /(^|[-_])neoforge([-_.]|$)/i, family: "forge" },
  { token: /(^|[-_])forge([-_.]|$)/i, family: "forge" },
  { token: /(^|[-_])(spigot|bukkit|paper|purpur)([-_.]|$)/i, family: "plugin" },
];

function loaderGroup(loader: string | null): "plugin" | "fabric" | "forge" | null {
  if (!loader) return null;
  const l = loader.toLowerCase();
  if (PLUGIN_FAMILY.has(l)) return "plugin";
  if (FABRIC_FAMILY.has(l)) return "fabric";
  if (FORGE_FAMILY.has(l)) return "forge";
  return null;
}

const VERSION_TAIL = /[-_.]?v?\d+(?:[._]\d+){0,3}(?:[-+][0-9a-z.]+)?$/i;
const MC_IN_NAME = /(?:^|[-_+(\[ ])(1\.(?:7|8|9|1\d|2\d)(?:\.\d{1,2})?)(?=[-_+).\] ]|$)/i;

/** Strip extension, loader tags, and trailing version to get a stable-ish id. */
function modId(name: string): string {
  let base = name.replace(/\.jar$/i, "").replace(/\.disabled$/i, "");
  // drop common loader/mc tokens so "sodium-fabric-1.20" and "sodium-forge" share an id
  base = base
    .replace(/[-_](fabric|forge|neoforge|quilt|spigot|bukkit|paper|purpur|mc)\b/gi, "")
    .replace(MC_IN_NAME, "");
  // strip a trailing version run, possibly a couple times (e.g. "-1.20.4-build.7")
  for (let i = 0; i < 3; i++) {
    const stripped = base.replace(VERSION_TAIL, "");
    if (stripped === base) break;
    base = stripped;
  }
  return base.replace(/[-_.\s]+$/g, "").replace(/[-_.\s]+/g, "-").toLowerCase() || base.toLowerCase();
}

function normalizeForMatch(name: string): string {
  return name.replace(/\.jar$/i, "").replace(/\.disabled$/i, "").replace(/[-_.\s]+/g, "").toLowerCase();
}

/** Extract an MC version embedded in a jar filename, if any (e.g. "1.20.4"). */
function mcVersionInName(name: string): string | null {
  const m = name.match(MC_IN_NAME);
  return m ? m[1] : null;
}

/** Coarse "major.minor" compare; returns true when versions clearly disagree. */
function mcMinorMismatch(a: string, b: string): boolean {
  const pa = a.split(".").slice(0, 2).join(".");
  const pb = b.split(".").slice(0, 2).join(".");
  return pa !== pb;
}

function jarLoaderGroup(name: string): "plugin" | "fabric" | "forge" | null {
  for (const h of LOADER_HINTS) if (h.token.test(name)) return h.family;
  return null;
}

/**
 * Analyze a flat list of files from the mods/ or plugins/ directory.
 * `ctx` carries the server's loader + MC version so we can flag mismatches.
 */
export function analyzeMods(files: ModFile[], ctx: ModDoctorContext): ModDoctorReport {
  const issues: ModIssue[] = [];

  const jars = files.filter((f) => /\.jar$/i.test(f.name));
  const disabled = files.filter((f) => /\.jar\.disabled$/i.test(f.name) || /\.disabled$/i.test(f.name));
  const serverGroup = loaderGroup(ctx.loader);

  // ── duplicate exact jars / duplicate ids ───────────────────────────────────
  const byId = new Map<string, ModFile[]>();
  for (const f of jars) {
    const id = modId(f.name);
    const arr = byId.get(id) ?? [];
    arr.push(f);
    byId.set(id, arr);
  }
  for (const [id, group] of byId) {
    if (group.length < 2) continue;
    // Sort so the newest-looking (lexicographically largest) is "kept".
    const sorted = [...group].sort((a, b) => a.name.localeCompare(b.name));
    const keep = sorted[sorted.length - 1];
    const exactDup = new Set(group.map((g) => normalizeForMatch(g.name))).size === 1;
    for (const f of sorted) {
      if (f === keep) continue;
      issues.push({
        level: "error",
        file: f.name,
        kind: exactDup ? "duplicate-jar" : "duplicate-id",
        message: exactDup
          ? `Duplicate jar of "${keep.name}" — running two copies of the same mod usually crashes the server on boot. Quarantine the extra.`
          : `Looks like a second copy of "${id}" (also installed as "${keep.name}"). Two versions of one mod will fight for the same id. Quarantine the older one.`,
        fix: "quarantine",
        related: [keep.name],
      });
    }
  }

  // ── per-jar heuristics (client-only, loader, version) ──────────────────────
  for (const f of jars) {
    const norm = normalizeForMatch(f.name);

    // client-only mods on a server
    const clientHit = [...CLIENT_ONLY_IDS].find((id) => norm.includes(id.replace(/[-_]/g, "")));
    if (clientHit) {
      issues.push({
        level: "warn",
        file: f.name,
        kind: "client-only",
        message: `"${f.name}" looks like a client-side mod (${clientHit}). It does nothing on a server and can throw errors at load. Safe to quarantine.`,
        fix: "quarantine",
      });
    }

    // loader mismatch (e.g. a Forge jar in a Fabric server's mods folder)
    const jg = jarLoaderGroup(f.name);
    if (serverGroup && jg && jg !== serverGroup) {
      issues.push({
        level: "error",
        file: f.name,
        kind: "loader-mismatch",
        message: `"${f.name}" appears to be a ${jg} build, but this server runs ${ctx.loader}. Wrong-loader jars won't load (and can abort startup). Quarantine it and install the ${serverGroup} build.`,
        fix: "quarantine",
      });
    }

    // MC version mismatch from the filename vs the server version
    if (ctx.mcVersion) {
      const v = mcVersionInName(f.name);
      if (v && mcMinorMismatch(v, ctx.mcVersion)) {
        issues.push({
          level: "warn",
          file: f.name,
          kind: "version-mismatch",
          message: `"${f.name}" is tagged for Minecraft ${v}, but this server is ${ctx.mcVersion}. Mods built for a different MC version frequently fail to load. Verify or quarantine.`,
          fix: "quarantine",
        });
      }
    }
  }

  // ── missing common dependencies (filename-only heuristic) ──────────────────
  // Fabric API is the classic one: tons of Fabric mods hard-require it.
  if (serverGroup === "fabric" && jars.length > 0) {
    const hasFabricApi = jars.some((f) => {
      const n = normalizeForMatch(f.name);
      return n.includes("fabricapi") || n.includes("fabric-api") || n.startsWith("fabricapi");
    });
    // Only warn if there are non-loader Fabric mods present that likely need it.
    const looksLikeFabricMods = jars.some((f) => /fabric/i.test(f.name) && !/fabric[-_]?api/i.test(f.name));
    if (!hasFabricApi && looksLikeFabricMods) {
      issues.push({
        level: "warn",
        file: jars[0].name,
        kind: "missing-dependency",
        message:
          "No Fabric API jar detected, but Fabric mods are installed. Most Fabric mods hard-require Fabric API and will crash without it. Install it from the Content tab.",
      });
    }
  }

  // ── informational: already-quarantined / non-jar artifacts ─────────────────
  for (const f of disabled) {
    issues.push({
      level: "info",
      file: f.name,
      kind: "disabled",
      message: `"${f.name}" is currently quarantined (disabled). Restore it to re-enable on the next start.`,
    });
  }

  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warn").length;
  const infos = issues.filter((i) => i.level === "info").length;

  return {
    issues,
    summary: {
      scanned: files.length,
      jars: jars.length,
      errors,
      warnings,
      infos,
      loader: ctx.loader,
      mcVersion: ctx.mcVersion,
      kind: ctx.kind,
    },
  };
}
