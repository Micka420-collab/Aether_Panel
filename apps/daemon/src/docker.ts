import Docker from "dockerode";
import { PassThrough } from "node:stream";
import path from "node:path";
import fs from "node:fs/promises";
import { ServerState, type ServerBuildSpec, type ServerStats } from "@aether/shared";
import { config } from "./config.js";
import { logger } from "./logger.js";

export const docker = new Docker({ socketPath: config.dockerSocket });

export function containerName(serverId: string): string {
  return `${config.prefix}_${serverId}`;
}

export function hostVolumePath(serverId: string): string {
  return path.join(config.dataDir, serverId);
}

/** Map Docker's container state to Aether's ServerState. */
export function mapState(info: Docker.ContainerInspectInfo | null): ServerState {
  if (!info) return ServerState.Offline;
  const s = info.State;
  if (s.Restarting) return ServerState.Starting;
  if (s.Running) return ServerState.Running;
  if (s.Dead || (s.ExitCode && s.ExitCode !== 0 && !s.Running)) return ServerState.Errored;
  return ServerState.Offline;
}

export async function getContainer(serverId: string): Promise<Docker.Container | null> {
  const c = docker.getContainer(containerName(serverId));
  try {
    await c.inspect();
    return c;
  } catch {
    return null;
  }
}

export async function inspect(serverId: string): Promise<Docker.ContainerInspectInfo | null> {
  try {
    return await docker.getContainer(containerName(serverId)).inspect();
  } catch {
    return null;
  }
}

/** Pull an image, streaming progress lines to a callback. */
export async function pullImage(image: string, onLine?: (line: string) => void): Promise<void> {
  logger.info({ image }, "pulling image");
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: unknown, stream: NodeJS.ReadableStream) => {
      if (err || !stream) return reject(err ?? new Error("no pull stream"));
      docker.modem.followProgress(
        stream,
        (doneErr: unknown) => (doneErr ? reject(doneErr) : resolve()),
        (ev: { status?: string; progress?: string }) => {
          if (onLine && ev.status) onLine(`${ev.status}${ev.progress ? " " + ev.progress : ""}`);
        },
      );
    });
  });
}

/** Internal host port = public port + offset, used when a server is fronted by the edge proxy. */
export const PROXY_PORT_OFFSET = 20000;
export function internalPort(port: number): number {
  return port + PROXY_PORT_OFFSET;
}

function buildPortBindings(spec: ServerBuildSpec) {
  const exposed: Record<string, {}> = {};
  const bindings: Record<string, { HostIp: string; HostPort: string }[]> = {};
  const primary = spec.allocations.find((a) => a.primary);
  for (const alloc of spec.allocations) {
    const protocols = alloc.protocol === "both" ? ["tcp", "udp"] : [alloc.protocol];
    for (const proto of protocols) {
      const key = `${alloc.port}/${proto}`;
      exposed[key] = {};
      const isRcon = alloc.role.toLowerCase() === "rcon";
      // Wake-on-join: bind the primary TCP port on loopback at an offset so the
      // edge proxy can own the public port. UDP (e.g. query) stays public.
      const proxiedTcp = spec.proxied && alloc === primary && proto === "tcp";
      if (proxiedTcp) {
        bindings[key] = [{ HostIp: "127.0.0.1", HostPort: String(internalPort(alloc.port)) }];
      } else {
        bindings[key] = [{ HostIp: isRcon ? "127.0.0.1" : "0.0.0.0", HostPort: String(alloc.port) }];
      }
    }
  }
  // RCON: keep strictly on loopback so the daemon can reach it but players cannot.
  if (spec.rcon) {
    const key = `${spec.rcon.port}/tcp`;
    exposed[key] = {};
    bindings[key] = [{ HostIp: "127.0.0.1", HostPort: String(spec.rcon.port) }];
  }
  return { exposed, bindings };
}

function memoryConfig(spec: ServerBuildSpec) {
  const mem = spec.limits.memoryMb * 1024 * 1024;
  let memorySwap: number;
  if (spec.limits.swapMb < 0) memorySwap = -1; // unlimited swap
  else if (spec.limits.swapMb === 0) memorySwap = mem; // swap disabled (== memory)
  else memorySwap = mem + spec.limits.swapMb * 1024 * 1024;
  return { Memory: mem, MemorySwap: memorySwap };
}

/** Create (or recreate) the container for a server from its build spec. */
export async function buildContainer(spec: ServerBuildSpec): Promise<void> {
  const name = containerName(spec.serverId);
  const volume = hostVolumePath(spec.serverId);
  await fs.mkdir(volume, { recursive: true });

  // Remove any stale container with the same name first.
  const existing = await getContainer(spec.serverId);
  if (existing) {
    try {
      await existing.remove({ force: true });
    } catch (e) {
      logger.warn({ e, name }, "failed to remove stale container");
    }
  }

  const { exposed, bindings } = buildPortBindings(spec);
  const { Memory, MemorySwap } = memoryConfig(spec);

  const env = Object.entries(spec.environment).map(([k, v]) => `${k}=${v}`);

  const createOpts: Docker.ContainerCreateOptions = {
    name,
    Image: spec.dockerImage,
    Hostname: spec.serverId.slice(0, 12),
    Tty: false,
    OpenStdin: true,
    AttachStdin: true,
    StdinOnce: false,
    Env: env,
    Labels: {
      "aether.managed": "true",
      "aether.serverId": spec.serverId,
      "aether.templateId": spec.templateId,
    },
    ExposedPorts: exposed,
    Cmd: spec.startupCommand ? ["/bin/sh", "-c", spec.startupCommand] : undefined,
    StopSignal: spec.stopSignal || "SIGTERM",
    StopTimeout: 90,
    HostConfig: {
      Binds: [`${volume}:${spec.containerDataPath}`],
      PortBindings: bindings,
      Memory,
      MemorySwap,
      NanoCpus: Math.round((spec.limits.cpuPercent / 100) * 1e9),
      PidsLimit: spec.limits.pids,
      OomKillDisable: spec.limits.oomDisabled,
      RestartPolicy: { Name: "no" },
      // Hardening: no privilege escalation + drop dangerous capabilities a game
      // server never needs (bounds the blast radius of a compromised container).
      // Keep the default seccomp profile. Escalate per-template if a game needs more.
      SecurityOpt: ["no-new-privileges"],
      CapDrop: [
        "SYS_ADMIN", "SYS_MODULE", "SYS_RAWIO", "SYS_PTRACE", "SYS_BOOT", "SYS_TIME",
        "NET_ADMIN", "NET_RAW", "DAC_READ_SEARCH", "MKNOD", "AUDIT_WRITE", "SETFCAP",
      ],
      DnsSearch: [],
    },
  };

  logger.info({ name, image: spec.dockerImage }, "creating container");
  await docker.createContainer(createOpts);
}

export async function startContainer(serverId: string): Promise<void> {
  const c = await getContainer(serverId);
  if (!c) throw new Error("container not found; build it first");
  await c.start();
}

export async function stopContainer(serverId: string, timeout = 90): Promise<void> {
  const c = await getContainer(serverId);
  if (!c) return;
  try {
    await c.stop({ t: timeout });
  } catch (e: any) {
    if (e?.statusCode !== 304) throw e; // 304 = already stopped
  }
}

export async function killContainer(serverId: string): Promise<void> {
  const c = await getContainer(serverId);
  if (!c) return;
  try {
    await c.kill();
  } catch (e: any) {
    if (e?.statusCode !== 304) throw e;
  }
}

export async function removeContainer(serverId: string, purgeVolume = false): Promise<void> {
  const c = await getContainer(serverId);
  if (c) await c.remove({ force: true });
  if (purgeVolume) {
    await fs.rm(hostVolumePath(serverId), { recursive: true, force: true });
  }
}

/**
 * Follow container logs, demultiplexing stdout/stderr into line callbacks.
 * Returns a function that stops the stream.
 */
export async function followLogs(
  serverId: string,
  onLine: (line: string, stream: "stdout" | "stderr") => void,
  tail = 250,
): Promise<() => void> {
  const c = await getContainer(serverId);
  if (!c) throw new Error("container not found");

  const stream = (await c.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail,
    timestamps: false,
  })) as unknown as NodeJS.ReadableStream;

  const out = new PassThrough();
  const err = new PassThrough();
  const split = (src: PassThrough, kind: "stdout" | "stderr") => {
    let buf = "";
    src.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? "";
      for (const line of parts) onLine(line, kind);
    });
  };
  split(out, "stdout");
  split(err, "stderr");
  docker.modem.demuxStream(stream, out, err);

  return () => {
    try {
      (stream as any).destroy?.();
    } catch {
      /* noop */
    }
  };
}

/**
 * Open a persistent writable to the container's stdin. Used to drive games
 * that have no RCON (e.g. Icarus console-only admin). Returns the duplex stream;
 * write newline-terminated commands to it.
 */
export async function attachStdin(serverId: string): Promise<NodeJS.ReadWriteStream> {
  const c = await getContainer(serverId);
  if (!c) throw new Error("container not found");
  const stream = (await c.attach({
    stream: true,
    stdin: true,
    stdout: false,
    stderr: false,
    hijack: true,
  })) as unknown as NodeJS.ReadWriteStream;
  return stream;
}

/**
 * Stream live resource stats, normalised into ServerStats.
 * Returns a stop function.
 */
export async function streamStats(
  serverId: string,
  onStats: (stats: Omit<ServerStats, "state" | "players">) => void,
): Promise<() => void> {
  const c = await getContainer(serverId);
  if (!c) throw new Error("container not found");

  const stream = (await c.stats({ stream: true })) as unknown as NodeJS.ReadableStream;
  let buf = "";
  const onData = (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim()) continue;
      try {
        const s = JSON.parse(part);
        onStats(normaliseStats(s));
      } catch {
        /* partial frame */
      }
    }
  };
  stream.on("data", onData);
  return () => {
    stream.removeListener("data", onData);
    try {
      (stream as any).destroy?.();
    } catch {
      /* noop */
    }
  };
}

function normaliseStats(s: any): Omit<ServerStats, "state" | "players"> {
  // CPU percentage (Linux cgroup stats)
  let cpuPercent = 0;
  try {
    const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
    const sysDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
    const cores =
      s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
    if (sysDelta > 0 && cpuDelta > 0) cpuPercent = (cpuDelta / sysDelta) * cores * 100;
  } catch {
    /* no cpu yet */
  }

  const memoryBytes = (s.memory_stats?.usage ?? 0) - (s.memory_stats?.stats?.cache ?? 0);
  const memoryLimitBytes = s.memory_stats?.limit ?? 0;

  let rx = 0;
  let tx = 0;
  if (s.networks) {
    for (const net of Object.values<any>(s.networks)) {
      rx += net.rx_bytes ?? 0;
      tx += net.tx_bytes ?? 0;
    }
  }

  return {
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    cpuPercentOfLimit: 0, // filled in by the manager using the configured limit
    memoryBytes: Math.max(0, memoryBytes),
    memoryLimitBytes,
    diskBytes: 0, // filled in by the manager (du of the volume)
    networkRxBytes: rx,
    networkTxBytes: tx,
    uptimeSeconds: 0,
  };
}
