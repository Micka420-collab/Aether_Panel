import { z } from "zod";
import { requireUser, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";
import { audit } from "@/lib/audit";

/**
 * Velocity proxy network management.
 *
 * Velocity (run via the itzg image with TYPE=VELOCITY) keeps its backend server
 * list in `velocity.toml` at the data root. This route reads that file through
 * the existing daemon file endpoints (DaemonClient.readFile/writeFile), parses
 * just the bits we manage — the `[servers]` table, its `try` order and the
 * `[forced-hosts]` section — and writes them back, preserving every other line
 * of the file untouched. No TOML library: we do a minimal, section-scoped edit.
 *
 * Gated on the velocity template + startup scopes, mirroring the mods/crossplay
 * routes (startup.read to view, startup.update to change).
 */

const VELOCITY_TEMPLATE_ID = "velocity-proxy";
const VELOCITY_GAME = "velocity";
const CONFIG_PATH = "velocity.toml";

export const dynamic = "force-dynamic";

interface Backend {
  name: string;
  address: string; // host:port
}
interface VelocityConfig {
  servers: Backend[];
  try: string[];
  forcedHosts: Record<string, string[]>;
}

function isVelocity(game: string, templateId: string): boolean {
  return templateId === VELOCITY_TEMPLATE_ID || game === VELOCITY_GAME;
}

/** A TOML key: bare word if it matches, otherwise a quoted string. */
function tomlKey(name: string): string {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name);
}
function unquoteKey(raw: string): string {
  const t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}
function unquoteVal(raw: string): string {
  const t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}
/** Parse a simple inline TOML array of strings, e.g. ["a", "b"]. */
function parseStringArray(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  return inner
    .split(",")
    .map((s) => unquoteVal(s))
    .filter((s) => s.length > 0);
}
function stringifyArray(items: string[]): string {
  return `[${items.map((s) => JSON.stringify(s)).join(", ")}]`;
}

/** Split the file into top-level sections keyed by header (or "" for preamble). */
function splitSections(toml: string): { header: string; lines: string[] }[] {
  const out: { header: string; lines: string[] }[] = [{ header: "", lines: [] }];
  for (const line of toml.split(/\r?\n/)) {
    const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (m) {
      out.push({ header: m[1]!.trim(), lines: [] });
    } else {
      out[out.length - 1]!.lines.push(line);
    }
  }
  return out;
}

function parseVelocity(toml: string): VelocityConfig {
  const sections = splitSections(toml);
  const servers: Backend[] = [];
  let tryOrder: string[] = [];
  const forcedHosts: Record<string, string[]> = {};

  for (const sec of sections) {
    if (sec.header === "servers") {
      for (const line of sec.lines) {
        const l = line.replace(/#.*$/, ""); // strip trailing comments
        const eq = l.indexOf("=");
        if (eq < 0) continue;
        const key = l.slice(0, eq).trim();
        const val = l.slice(eq + 1).trim();
        if (!key) continue;
        if (key === "try") {
          tryOrder = parseStringArray(val);
        } else {
          servers.push({ name: unquoteKey(key), address: unquoteVal(val) });
        }
      }
    } else if (sec.header === "forced-hosts") {
      for (const line of sec.lines) {
        const l = line.replace(/#.*$/, "");
        const eq = l.indexOf("=");
        if (eq < 0) continue;
        const key = l.slice(0, eq).trim();
        const val = l.slice(eq + 1).trim();
        if (!key) continue;
        forcedHosts[unquoteKey(key)] = parseStringArray(val);
      }
    }
  }
  return { servers, try: tryOrder, forcedHosts };
}

/** Re-render the [servers] and [forced-hosts] sections, leaving everything else. */
function writeVelocity(toml: string, cfg: VelocityConfig): string {
  const sections = splitSections(toml);

  const serverLines: string[] = [];
  for (const b of cfg.servers) {
    serverLines.push(`${tomlKey(b.name)} = ${JSON.stringify(b.address)}`);
  }
  // `try` lists the backends Velocity attempts (in order) for a fresh join.
  const tryList = cfg.try.filter((n) => cfg.servers.some((s) => s.name === n));
  serverLines.push(`try = ${stringifyArray(tryList)}`);

  const forcedLines: string[] = [];
  for (const [host, names] of Object.entries(cfg.forcedHosts)) {
    forcedLines.push(`${tomlKey(host)} = ${stringifyArray(names)}`);
  }

  let sawServers = false;
  let sawForced = false;
  const rendered: string[] = [];
  for (const sec of sections) {
    if (sec.header === "") {
      rendered.push(sec.lines.join("\n"));
    } else if (sec.header === "servers") {
      sawServers = true;
      rendered.push("[servers]");
      rendered.push(...serverLines);
    } else if (sec.header === "forced-hosts") {
      sawForced = true;
      rendered.push("[forced-hosts]");
      rendered.push(...forcedLines);
    } else {
      rendered.push(`[${sec.header}]`);
      rendered.push(...sec.lines);
    }
  }
  if (!sawServers) {
    rendered.push("");
    rendered.push("[servers]");
    rendered.push(...serverLines);
  }
  if (!sawForced) {
    rendered.push("");
    rendered.push("[forced-hosts]");
    rendered.push(...forcedLines);
  }
  return rendered.join("\n").replace(/\n{3,}/g, "\n\n");
}

async function readConfig(c: { server: { id: string }; node: any }): Promise<string | null> {
  try {
    const { content } = await new DaemonClient(c.node).readFile(c.server.id, CONFIG_PATH);
    return content;
  } catch {
    // File not created yet (server never booted) — treat as "not provisioned".
    return null;
  }
}

export const GET = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "startup.read");
  if (!isVelocity(c.server.game, c.server.templateId)) {
    throw new HttpError(400, "This server is not a Velocity proxy.");
  }
  const raw = await readConfig(c);
  if (raw === null) {
    return json({
      provisioned: false,
      servers: [],
      try: [],
      forcedHosts: {},
      message: "Start the proxy once so Velocity generates its config, then add your backend servers here.",
    });
  }
  const cfg = parseVelocity(raw);
  return json({ provisioned: true, servers: cfg.servers, try: cfg.try, forcedHosts: cfg.forcedHosts });
});

const backendSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9 _-]+$/, "Use letters, numbers, spaces, dashes or underscores"),
  address: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[^\s:]+:\d{1,5}$/, "Use host:port, e.g. 10.0.0.5:25565"),
});

const putSchema = z.object({
  servers: z.array(backendSchema).max(64),
  try: z.array(z.string().min(1)).max(64).default([]),
  forcedHosts: z.record(z.array(z.string().min(1))).default({}),
});

export const PUT = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "startup.update");
  assertNotSuspended(c);
  if (!isVelocity(c.server.game, c.server.templateId)) {
    throw new HttpError(400, "This server is not a Velocity proxy.");
  }

  const body = putSchema.parse(await req.json());

  // Reject duplicate backend names (TOML keys must be unique).
  const names = body.servers.map((s) => s.name);
  if (new Set(names).size !== names.length) {
    throw new HttpError(422, "Backend server names must be unique.");
  }
  // `try` and forced-hosts may only reference defined backends.
  const known = new Set(names);
  const badTry = body.try.find((n) => !known.has(n));
  if (badTry) throw new HttpError(422, `Default order references an unknown server: "${badTry}".`);
  for (const [host, list] of Object.entries(body.forcedHosts)) {
    const bad = list.find((n) => !known.has(n));
    if (bad) throw new HttpError(422, `Forced host "${host}" references an unknown server: "${bad}".`);
  }

  const raw = await readConfig(c);
  if (raw === null) {
    throw new HttpError(
      409,
      "Velocity hasn't generated its config yet. Start the proxy once, then save your backend servers.",
    );
  }

  const next = writeVelocity(raw, {
    servers: body.servers,
    try: body.try,
    forcedHosts: body.forcedHosts,
  });

  try {
    await new DaemonClient(c.node).writeFile(c.server.id, CONFIG_PATH, next);
  } catch (e: any) {
    throw new HttpError(502, `Could not write velocity.toml on the node: ${e?.message ?? "unknown error"}`);
  }

  await audit("velocity.update", {
    userId: user.id,
    serverId: c.server.id,
    metadata: { servers: names.length },
  });

  return json({
    ok: true,
    provisioned: true,
    servers: body.servers,
    try: body.try,
    forcedHosts: body.forcedHosts,
    note: "Saved. Run /velocity reload in the proxy console (or restart it) to apply.",
  });
});
