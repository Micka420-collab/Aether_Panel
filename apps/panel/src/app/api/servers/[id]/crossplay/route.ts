import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { buildServerSpec } from "@/lib/spec";
import { DaemonClient } from "@/lib/daemon";
import { audit } from "@/lib/audit";

/**
 * Crossplay (Java <-> Bedrock) via Geyser + Floodgate.
 *
 * Geyser is a proxy that lets Bedrock Edition clients (mobile, console, Win10)
 * join a Java server; Floodgate lets them in without a Java/Microsoft account.
 * Both are installable as Modrinth projects ("geyser" + "floodgate") and are
 * driven by the itzg image's MODRINTH_PROJECTS env var — exactly like the mods
 * route. Geyser listens for Bedrock clients on UDP 19132, so we also reserve a
 * UDP allocation on that port (role "Bedrock").
 *
 * This route is intentionally a thin layer over the same env-merge +
 * buildServerSpec + registerServer(rebuild=false) pattern used by the mods
 * route, so enabling crossplay never force-kills a running server.
 */

const GEYSER_SLUG = "geyser";
const FLOODGATE_SLUG = "floodgate";
const BEDROCK_PORT = 19132;
const BEDROCK_ROLE = "Bedrock";

// Plugin loaders the itzg image can auto-install Geyser/Floodgate plugins on.
// (Geyser/Floodgate ship Spigot/Paper plugins + Fabric/NeoForge mods, so the
// full plugin + mod loader family is supported; only proxy-less / vanilla
// Bedrock-incapable setups are excluded.)
const SUPPORTED_LOADERS = new Set([
  "PAPER",
  "PURPUR",
  "SPIGOT",
  "BUKKIT",
  "FOLIA",
  "FABRIC",
  "NEOFORGE",
  "VELOCITY",
  "BUNGEECORD",
  "WATERFALL",
]);

function parseList(v?: string): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function hasProject(env: Record<string, string>, slug: string): boolean {
  return parseList(env.MODRINTH_PROJECTS).some((s) => s.toLowerCase() === slug.toLowerCase());
}

/** Persist new env + re-register the spec WITHOUT rebuilding (applies on next start). */
async function applyEnv(serverId: string, env: Record<string, string>) {
  const updated = await db.server.update({
    where: { id: serverId },
    data: { environment: env as object },
    include: { allocations: true, node: true },
  });
  await new DaemonClient(updated.node).registerServer(buildServerSpec(updated, updated.allocations), false);
}

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "startup.read");
  const env = (c.server.environment as Record<string, string>) ?? {};
  const bedrock = c.allocations.find(
    (a) => a.role.toLowerCase() === BEDROCK_ROLE.toLowerCase() || (a.port === BEDROCK_PORT && a.protocol === "UDP"),
  );
  const loader = (env.TYPE ?? "").toUpperCase();
  return json({
    // Considered enabled once Geyser is in the install list.
    enabled: hasProject(env, GEYSER_SLUG),
    floodgate: hasProject(env, FLOODGATE_SLUG),
    bedrockAddress: bedrock ? `${bedrock.ip}:${bedrock.port}` : null,
    bedrockPort: bedrock?.port ?? BEDROCK_PORT,
    // Crossplay needs a plugin/mod-capable loader; vanilla can't host Geyser.
    supported: SUPPORTED_LOADERS.has(loader),
    loader: loader || null,
    game: c.server.game,
  });
});

export const POST = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "startup.update");
  assertNotSuspended(c);

  const env = { ...((c.server.environment as Record<string, string>) ?? {}) };
  const loader = (env.TYPE ?? "").toUpperCase();
  if (!SUPPORTED_LOADERS.has(loader)) {
    throw new HttpError(
      422,
      `Crossplay needs a plugin/mod-capable server (Paper, Purpur, Spigot, Fabric, NeoForge...). "${env.TYPE || "this flavour"}" can't host Geyser — switch the server software first.`,
    );
  }

  // Merge geyser + floodgate into MODRINTH_PROJECTS (dedup, preserve existing).
  const set = new Set(parseList(env.MODRINTH_PROJECTS));
  set.add(GEYSER_SLUG);
  set.add(FLOODGATE_SLUG);
  env.MODRINTH_PROJECTS = [...set].join(",");
  // Geyser/Floodgate frequently only ship beta builds for brand-new MC
  // versions; accept them so enabling crossplay can't block the boot.
  env.MODRINTH_ALLOWED_VERSION_TYPE = env.MODRINTH_ALLOWED_VERSION_TYPE || "beta";

  // Reserve the Bedrock UDP listener port. Respects the
  // @@unique([nodeId, ip, port, protocol]) constraint: we look for a free UDP
  // port starting at 19132 on the server's node IP, then create the row only if
  // one doesn't already exist for this server.
  const primary = c.allocations.find((a) => a.primary) ?? c.allocations[0];
  const existing = c.allocations.find(
    (a) => a.role.toLowerCase() === BEDROCK_ROLE.toLowerCase() || (a.port === BEDROCK_PORT && a.protocol === "UDP"),
  );
  if (!existing) {
    const ip = primary?.ip ?? c.node.publicIp;
    // Find a free UDP port (BEDROCK_PORT, else next free) not taken on this
    // node for the UDP/BOTH protocols.
    const takenUdp = new Set(
      (
        await db.allocation.findMany({
          where: { nodeId: c.node.id, protocol: { in: ["UDP", "BOTH"] } },
          select: { port: true },
        })
      ).map((a) => a.port),
    );
    let port = BEDROCK_PORT;
    for (let p = BEDROCK_PORT; p < BEDROCK_PORT + 2000; p++) {
      if (!takenUdp.has(p)) {
        port = p;
        break;
      }
      if (p === BEDROCK_PORT + 1999) throw new HttpError(503, "No free UDP port available on the node for Bedrock.");
    }
    try {
      await db.allocation.create({
        data: {
          nodeId: c.node.id,
          ip,
          port,
          protocol: "UDP",
          role: BEDROCK_ROLE,
          serverId: c.server.id,
          primary: false,
          notes: "Bedrock (Geyser) crossplay listener",
        },
      });
    } catch (e: any) {
      // Port race with another create — the unique key rejected us. Surface a
      // friendly conflict rather than 500ing; env changes below still apply.
      if (e?.code !== "P2002") throw e;
    }
  }

  await applyEnv(c.server.id, env);
  await audit("crossplay.enable", {
    userId: user.id,
    serverId: c.server.id,
    metadata: { projects: [GEYSER_SLUG, FLOODGATE_SLUG] },
  });

  const fresh = await db.allocation.findFirst({
    where: { serverId: c.server.id, role: BEDROCK_ROLE },
  });
  return json({
    ok: true,
    enabled: true,
    floodgate: true,
    bedrockAddress: fresh ? `${fresh.ip}:${fresh.port}` : null,
    bedrockPort: fresh?.port ?? BEDROCK_PORT,
  });
});

export const DELETE = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "startup.update");
  assertNotSuspended(c);

  const env = { ...((c.server.environment as Record<string, string>) ?? {}) };
  env.MODRINTH_PROJECTS = parseList(env.MODRINTH_PROJECTS)
    .filter((s) => s.toLowerCase() !== GEYSER_SLUG && s.toLowerCase() !== FLOODGATE_SLUG)
    .join(",");

  // Free the Bedrock UDP allocation so the port returns to the pool.
  await db.allocation.deleteMany({
    where: { serverId: c.server.id, role: BEDROCK_ROLE },
  });

  await applyEnv(c.server.id, env);
  await audit("crossplay.disable", { userId: user.id, serverId: c.server.id });
  return json({ ok: true, enabled: false });
});
