import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { DaemonClient } from "@/lib/daemon";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";

export const GET = route(async () => {
  await requireAdmin();
  const nodes = await db.node.findMany({ include: { _count: { select: { servers: true, allocations: true } } }, orderBy: { createdAt: "asc" } });
  const withHealth = await Promise.all(
    nodes.map(async (n) => {
      let online = false;
      let system: any = null;
      try {
        system = await new DaemonClient(n).system();
        online = true;
      } catch {
        /* offline */
      }
      return {
        id: n.id,
        name: n.name,
        fqdn: n.fqdn,
        scheme: n.scheme,
        daemonPort: n.daemonPort,
        publicIp: n.publicIp,
        maintenance: n.maintenance,
        servers: n._count.servers,
        allocations: n._count.allocations,
        online,
        system,
      };
    }),
  );
  const [users, servers] = await Promise.all([db.user.count(), db.server.count()]);
  return json({ nodes: withHealth, totals: { users, servers, nodes: nodes.length } });
});

const schema = z.object({
  name: z.string().min(1),
  fqdn: z.string().min(1),
  scheme: z.enum(["http", "https"]).default("http"),
  daemonPort: z.number().int().default(8080),
  publicIp: z.string().min(1),
  tokenSecret: z.string().optional(),
});

export const POST = route(async (req) => {
  await requireAdmin();
  const b = schema.parse(await req.json());
  const node = await db.node.create({
    data: {
      name: b.name,
      fqdn: b.fqdn,
      scheme: b.scheme,
      daemonPort: b.daemonPort,
      publicIp: b.publicIp,
      tokenId: `node_${randomToken(6)}`,
      tokenSecret: b.tokenSecret || env.daemonToken,
    },
  });
  return json({ id: node.id }, 201);
});
