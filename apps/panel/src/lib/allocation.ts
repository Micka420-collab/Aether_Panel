import "server-only";
import { db } from "./db";
import { HttpError } from "./auth";
import { buildServerSpec } from "./spec";
import { DaemonClient } from "./daemon";
import type { ServerContext } from "./access";

// System/host ports a game server must never grab.
const RESERVED = new Set([22, 80, 443, 2022, 5432, 8080]);

/**
 * Change a server's PRIMARY (game) port — the address players connect to.
 * Validates the port is in range, not reserved, and free on the node, then
 * rebuilds the container so the new host binding takes effect. The server is
 * left needing a (re)start to come up on the new port.
 */
export async function changePrimaryPort(c: ServerContext, port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new HttpError(422, "Port must be between 1024 and 65535.");
  if (RESERVED.has(port)) throw new HttpError(422, "That port is reserved by the system.");

  const primary = c.allocations.find((a) => a.primary) ?? c.allocations[0];
  if (!primary) throw new HttpError(409, "This server has no primary allocation.");
  if (primary.port === port) return; // no-op

  // No clash with this server's own other allocations (e.g. RCON)…
  if (c.allocations.some((a) => a.id !== primary.id && a.port === port)) {
    throw new HttpError(409, "That port is already used by this server (e.g. its RCON port).");
  }
  // …nor with any other server on the node.
  const conflict = await db.allocation.findFirst({ where: { nodeId: c.node.id, port, serverId: { not: c.server.id } } });
  if (conflict) throw new HttpError(409, "That port is already in use on this node.");

  try {
    await db.allocation.update({ where: { id: primary.id }, data: { port } });
  } catch (e: any) {
    if (e?.code === "P2002") throw new HttpError(409, "That port was just taken — pick another.");
    throw e;
  }

  // Rebuild so the container re-binds the new host port.
  const updated = await db.server.findUnique({ where: { id: c.server.id }, include: { allocations: true } });
  if (updated) {
    await db.server.update({ where: { id: c.server.id }, data: { state: "installing" } });
    try {
      await new DaemonClient(c.node).registerServer(buildServerSpec(updated, updated.allocations), true);
    } catch (e: any) {
      throw new HttpError(502, `Port saved, but the node could not rebind it: ${e?.message}`);
    }
  }
}
