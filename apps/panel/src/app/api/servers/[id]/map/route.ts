import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { buildServerSpec } from "@/lib/spec";
import { DaemonClient } from "@/lib/daemon";
import { audit } from "@/lib/audit";

/**
 * Live map (BlueMap) for Minecraft servers.
 *
 * BlueMap is a Modrinth project ("bluemap") that renders a 3D web map of the
 * world and serves it from an integrated webserver listening on port 8100 inside
 * the container. We enable it by:
 *   1. adding `bluemap` to MODRINTH_PROJECTS so the itzg image auto-installs it
 *      (same env-merge pattern as the mods route), and
 *   2. adding a TCP allocation for the web port (8100) so the daemon publishes it
 *      on the host — players reach the map at http://<node.publicIp>:<host port>.
 *
 * The plugin's default config already binds 0.0.0.0:8100, so no in-container
 * config edit is required; the container picks up both the new mod and the new
 * port binding on its next (re)build.
 */

// BlueMap's integrated webserver port inside the container.
const BLUEMAP_PORT = 8100;
// Allocation role we use to identify the published map port.
const MAP_ROLE = "BlueMap";
const MODRINTH_SLUG = "bluemap";

// System/host ports the map allocation must never grab when picking a host port.
const RESERVED = new Set([22, 80, 443, 2022, 5432, 8080]);

function parseList(v?: string): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasBluemap(env: Record<string, string>): boolean {
  return parseList(env.MODRINTH_PROJECTS).some((s) => s.toLowerCase() === MODRINTH_SLUG);
}

export const dynamic = "force-dynamic";

/** GET — report whether the live map is enabled and, if so, its public URL. */
export const GET = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "startup.read");

  if (c.server.game !== "minecraft") {
    return json({ enabled: false, supported: false, url: null });
  }

  const env = (c.server.environment as Record<string, string>) ?? {};
  const enabled = hasBluemap(env);
  const mapAlloc = c.allocations.find((a) => a.role.toLowerCase() === MAP_ROLE.toLowerCase());
  const host = c.node.publicIp;
  const url = enabled && mapAlloc && host ? `http://${host}:${mapAlloc.port}` : null;

  return json({ enabled, supported: true, port: mapAlloc?.port ?? null, url });
});

/**
 * Find a free host port on the node, preferring the BlueMap default (8100) and
 * walking upward. Mirrors the picker used when provisioning a server.
 */
async function pickHostPort(nodeId: string, serverId: string): Promise<number> {
  const taken = await db.allocation.findMany({
    where: { nodeId, serverId: { not: serverId } },
    select: { port: true },
  });
  const used = new Set(taken.map((a) => a.port));
  for (let p = BLUEMAP_PORT; p < BLUEMAP_PORT + 2000; p++) {
    if (!used.has(p) && !RESERVED.has(p)) return p;
  }
  throw new HttpError(503, "No free ports available on the node for the live map.");
}

/** POST — enable the live map (install BlueMap + publish its web port, then rebuild). */
export const POST = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "startup.update");
  assertNotSuspended(c);

  if (c.server.game !== "minecraft") {
    throw new HttpError(400, "The live map is only available for Minecraft servers.");
  }

  const env = { ...((c.server.environment as Record<string, string>) ?? {}) };

  // 1. Merge `bluemap` into the Modrinth project list (same pattern as mods).
  const set = new Set(parseList(env.MODRINTH_PROJECTS));
  set.add(MODRINTH_SLUG);
  env.MODRINTH_PROJECTS = [...set].join(",");
  // Accept release + beta builds so a fresh-MC-version server can still install it.
  env.MODRINTH_ALLOWED_VERSION_TYPE = env.MODRINTH_ALLOWED_VERSION_TYPE || "beta";

  // 2. Ensure a TCP allocation publishes the web port (8100) on the host.
  let mapAlloc = c.allocations.find((a) => a.role.toLowerCase() === MAP_ROLE.toLowerCase());
  if (!mapAlloc) {
    const hostPort = await pickHostPort(c.node.id, c.server.id);
    try {
      mapAlloc = await db.allocation.create({
        data: {
          nodeId: c.node.id,
          serverId: c.server.id,
          ip: c.node.publicIp,
          port: hostPort,
          protocol: "TCP",
          role: MAP_ROLE,
          notes: "BlueMap live map web server",
          primary: false,
        },
      });
    } catch (e: any) {
      if (e?.code === "P2002") throw new HttpError(409, "That map port was just taken — try again.");
      throw e;
    }
  }

  // 3. Persist the new env + allocation, then rebuild so the container both
  // installs BlueMap and binds the newly published host port. (Unlike a plain
  // mod install, a NEW port can only be opened by recreating the container, so
  // we rebuild=true here — the server will need a (re)start to come up.)
  const saved = await db.server.update({
    where: { id: c.server.id },
    data: { environment: env as object },
    include: { allocations: true, node: true },
  });

  try {
    await new DaemonClient(saved.node).registerServer(buildServerSpec(saved, saved.allocations), true);
  } catch (e: any) {
    throw new HttpError(502, `Map enabled, but the node could not be updated: ${e?.message}`);
  }

  await audit("map.enable", { userId: user.id, serverId: c.server.id, metadata: { port: mapAlloc.port } });

  const host = saved.node.publicIp;
  return json({
    enabled: true,
    supported: true,
    port: mapAlloc.port,
    url: host ? `http://${host}:${mapAlloc.port}` : null,
  });
});
