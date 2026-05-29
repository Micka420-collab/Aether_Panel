import "server-only";
import type { User } from "@prisma/client";
import { requireTemplate, resolveEnvironment } from "@aether/shared";
import { db } from "./db";
import { HttpError } from "./auth";
import { randomString } from "./crypto";
import { buildServerSpec } from "./spec";
import { DaemonClient } from "./daemon";
import { audit } from "./audit";

type DbProtocol = "TCP" | "UDP" | "BOTH";
function protoFor(p: "tcp" | "udp" | "both"): DbProtocol {
  return p === "tcp" ? "TCP" : p === "udp" ? "UDP" : "BOTH";
}

export interface CreateServerInput {
  name: string;
  templateId: string;
  dockerImage?: string;
  nodeId?: string;
  variables?: Record<string, string>;
  limits?: { memoryMb?: number; cpuPercent?: number; diskMb?: number; swapMb?: number };
}

export async function createServer(user: User, input: CreateServerInput) {
  const template = requireTemplate(input.templateId);

  const node = input.nodeId
    ? await db.node.findUnique({ where: { id: input.nodeId } })
    : await db.node.findFirst({ where: { maintenance: false }, orderBy: { createdAt: "asc" } });
  if (!node) throw new HttpError(503, "No game node is available. Add a node in the admin panel.");

  // Resolve environment from template defaults + chosen variables (+ stable secrets).
  const environment = resolveEnvironment(template, input.variables ?? {}, { randomString });

  // Gather used ports on the node, then allocate this server's ports.
  const existing = await db.allocation.findMany({ where: { nodeId: node.id }, select: { port: true } });
  const used = new Set(existing.map((a) => a.port));
  const pickPort = (desired: number): number => {
    for (let p = desired; p < desired + 2000; p++) {
      if (!used.has(p)) {
        used.add(p);
        return p;
      }
    }
    throw new HttpError(503, "No free ports available on the node.");
  };

  const limits = {
    memoryMb: input.limits?.memoryMb ?? template.resources.memoryMb,
    cpuPercent: input.limits?.cpuPercent ?? template.resources.cpuPercent,
    diskMb: input.limits?.diskMb ?? template.resources.diskMb,
    swapMb: input.limits?.swapMb ?? 0,
  };

  const dockerImage = input.dockerImage ?? template.defaultImage;

  // Decide each port number up front (primary first so offsets are relative to it).
  const primarySpec = template.ports.find((p) => p.primary) ?? template.ports[0]!;
  const primaryPort = pickPort(primarySpec.default);
  const portPlan = template.ports.map((p) => {
    if (p === primarySpec) return { spec: p, port: primaryPort };
    const desired = p.offsetFromPrimary !== undefined ? primaryPort + p.offsetFromPrimary : p.default;
    return { spec: p, port: pickPort(desired) };
  });

  const server = await db.server.create({
    data: {
      name: input.name.slice(0, 60),
      ownerId: user.id,
      nodeId: node.id,
      templateId: template.id,
      game: template.game,
      dockerImage,
      environment: environment as object,
      memoryMb: limits.memoryMb,
      cpuPercent: limits.cpuPercent,
      diskMb: limits.diskMb,
      swapMb: limits.swapMb,
      state: "installing",
      allocations: {
        create: portPlan.map(({ spec, port }) => ({
          nodeId: node.id,
          ip: node.publicIp,
          port,
          protocol: protoFor(spec.protocol),
          role: spec.name,
          primary: !!spec.primary || spec === primarySpec,
        })),
      },
    },
    include: { allocations: true },
  });

  // Hand the build spec to the daemon (async install/pull happens there).
  const spec = buildServerSpec(server, server.allocations);
  try {
    await new DaemonClient(node).registerServer(spec);
  } catch (e: any) {
    // Roll back the DB rows if the node refused the build.
    await db.server.delete({ where: { id: server.id } }).catch(() => {});
    throw new HttpError(502, `Node could not provision the server: ${e?.message ?? "unknown error"}`);
  }

  await audit("server.create", { userId: user.id, serverId: server.id, metadata: { templateId: template.id } });
  return server;
}
