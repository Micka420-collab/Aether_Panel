import "server-only";
import type { Node } from "@prisma/client";
import { db } from "./db";
import { DaemonClient } from "./daemon";

type Srv = { id: string; state: string; node: Node };

/**
 * Query the node (the source of truth) for each server's REAL state and heal any
 * drifted DB row. Needed because the DB only stores the optimistic state set when
 * an action is issued ("starting"/"stopping") — nothing reconciles it back when
 * the container actually settles, so the dashboard list could show a server stuck
 * on "stopping" when it's really offline. Best-effort + time-boxed per node call.
 */
export async function reconcileStates<T extends Srv>(servers: T[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    servers.map(async (s) => {
      try {
        const real = await Promise.race([
          new DaemonClient(s.node).status(s.id).then((r) => r.state as string),
          new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
        ]);
        out.set(s.id, real);
        if (real !== s.state) {
          await db.server.update({ where: { id: s.id }, data: { state: real } }).catch(() => {});
        }
      } catch {
        out.set(s.id, s.state); // node unreachable / timeout — keep the DB value
      }
    }),
  );
  return out;
}
