import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ServerState,
  type ConsoleLine,
  type PowerAction,
  type ServerBuildSpec,
  type ServerStats,
} from "@aether/shared";
import {
  attachStdin,
  buildContainer,
  followLogs,
  hostVolumePath,
  inspect,
  internalPort,
  killContainer,
  mapState,
  pullImage,
  removeContainer,
  startContainer,
  stopContainer,
  streamStats,
} from "./docker.js";
import { sendRcon, queryPlayers } from "./rcon.js";
import { volumeSize } from "./files.js";
import { logger } from "./logger.js";

const CONSOLE_BUFFER = 250;
const SPEC_FILE = ".aether/spec.json";

interface Runtime {
  spec: ServerBuildSpec;
  state: ServerState;
  console: ConsoleLine[];
  lastStats?: ServerStats;
  startedAt?: number;
  stopLogs?: () => void;
  stopStats?: () => void;
  stdin?: NodeJS.ReadWriteStream;
  playerTimer?: NodeJS.Timeout;
  diskTimer?: NodeJS.Timeout;
  players?: { online: number; max: number; sample: string[] };
}

/**
 * The daemon's brain: owns the lifecycle and live state of every managed
 * server, and emits events the WebSocket hub relays to clients.
 *
 * Events (per server id):
 *   console:<id>  -> ConsoleLine[]
 *   stats:<id>    -> ServerStats
 *   state:<id>    -> ServerState
 *   install:<id>  -> string (install output line)
 */
class ServerManager extends EventEmitter {
  private servers = new Map<string, Runtime>();

  async init(): Promise<void> {
    await this.rehydrate();
  }

  /** On boot, reload persisted specs and resume streaming for running containers. */
  private async rehydrate(): Promise<void> {
    let dirs: string[] = [];
    try {
      const { config } = await import("./config.js");
      dirs = await fs.readdir(config.dataDir);
    } catch {
      return;
    }
    for (const id of dirs) {
      try {
        const raw = await fs.readFile(path.join(hostVolumePath(id), SPEC_FILE), "utf8");
        const spec = JSON.parse(raw) as ServerBuildSpec;
        const info = await inspect(id);
        const state = mapState(info);
        this.servers.set(id, { spec, state, console: [] });
        if (state === ServerState.Running) {
          this.beginStreaming(id);
          logger.info({ id }, "rehydrated running server");
        }
      } catch {
        /* not an aether server dir */
      }
    }
  }

  has(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  getSnapshot(serverId: string) {
    const rt = this.servers.get(serverId);
    if (!rt) return null;
    return { state: rt.state, stats: rt.lastStats ?? null, console: rt.console, players: rt.players ?? null };
  }

  getSpec(serverId: string): ServerBuildSpec | null {
    return this.servers.get(serverId)?.spec ?? null;
  }

  /** Routes for the edge proxy: proxied servers' public port → internal backend. */
  listProxyRoutes(): { serverId: string; listen: string; backend: string; idleSeconds: number }[] {
    const routes: { serverId: string; listen: string; backend: string; idleSeconds: number }[] = [];
    for (const [serverId, rt] of this.servers) {
      if (!rt.spec.proxied) continue;
      const primary = rt.spec.allocations.find((a) => a.primary);
      if (!primary) continue;
      routes.push({
        serverId,
        listen: `:${primary.port}`,
        backend: `127.0.0.1:${internalPort(primary.port)}`,
        idleSeconds: rt.spec.idleSeconds ?? 600,
      });
    }
    return routes;
  }

  /** Register/rebuild a server from its spec (idempotent) and persist the spec. */
  async register(spec: ServerBuildSpec, rebuild = true): Promise<void> {
    const existing = this.servers.get(spec.serverId);
    const rt: Runtime = existing ?? { spec, state: ServerState.Offline, console: [] };
    rt.spec = spec;
    this.servers.set(spec.serverId, rt);

    await fs.mkdir(path.join(hostVolumePath(spec.serverId), ".aether"), { recursive: true });
    await fs.writeFile(path.join(hostVolumePath(spec.serverId), SPEC_FILE), JSON.stringify(spec, null, 2));

    if (rebuild) {
      this.setState(spec.serverId, ServerState.Installing);
      this.pushConsole(spec.serverId, `[Aether] Pulling image ${spec.dockerImage}…`, "system");
      try {
        await pullImage(spec.dockerImage, (l) => this.emit(`install:${spec.serverId}`, l));
      } catch (e) {
        logger.warn({ e, image: spec.dockerImage }, "image pull failed (may already exist locally)");
      }
      this.pushConsole(spec.serverId, "[Aether] Building container…", "system");
      await buildContainer(spec);
      this.setState(spec.serverId, ServerState.Offline);
      this.pushConsole(spec.serverId, "[Aether] Ready. Press Start to boot your server.", "system");
    }
  }

  async power(serverId: string, action: PowerAction): Promise<void> {
    const rt = this.requireRuntime(serverId);
    switch (action) {
      case "start":
        if (rt.state === ServerState.Running || rt.state === ServerState.Starting) return;
        this.setState(serverId, ServerState.Starting);
        this.pushConsole(serverId, "[Aether] Starting server…", "system");
        await startContainer(serverId);
        rt.startedAt = Date.now();
        this.beginStreaming(serverId);
        break;
      case "restart":
        this.pushConsole(serverId, "[Aether] Restarting…", "system");
        await this.gracefulStop(serverId);
        await startContainer(serverId).catch(async () => {
          // container may need rebuild if it was removed
          await buildContainer(rt.spec);
          await startContainer(serverId);
        });
        rt.startedAt = Date.now();
        this.setState(serverId, ServerState.Starting);
        this.beginStreaming(serverId);
        break;
      case "stop":
        this.setState(serverId, ServerState.Stopping);
        this.pushConsole(serverId, "[Aether] Stopping server…", "system");
        await this.gracefulStop(serverId);
        break;
      case "kill":
        this.pushConsole(serverId, "[Aether] Killing server (forced)…", "system");
        await killContainer(serverId);
        this.setState(serverId, ServerState.Offline);
        this.endStreaming(serverId);
        break;
    }
  }

  /** Graceful stop: prefer the template's console stop command, fall back to SIGTERM. */
  private async gracefulStop(serverId: string): Promise<void> {
    const rt = this.requireRuntime(serverId);
    const stopCmd = rt.spec.stopCommand;
    try {
      // RCON-capable games with a real console command (e.g. Minecraft "stop").
      if (rt.spec.rcon && stopCmd && !stopCmd.startsWith("^")) {
        await sendRcon(rt.spec.rcon.port, rt.spec.rcon.password, stopCmd);
        await new Promise((r) => setTimeout(r, 1500));
      } else if (rt.stdin && stopCmd && !stopCmd.startsWith("^")) {
        // console-only games (e.g. Icarus): write the stop command to stdin
        rt.stdin.write(stopCmd + "\n");
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch {
      /* fall through to docker stop (sends StopSignal then SIGKILL) */
    }
    await stopContainer(serverId);
    this.setState(serverId, ServerState.Offline);
    this.endStreaming(serverId);
  }

  async sendCommand(serverId: string, command: string): Promise<void> {
    const rt = this.requireRuntime(serverId);
    if (rt.state !== ServerState.Running) throw new Error("server is not running");
    this.pushConsole(serverId, `> ${command}`, "system");
    if (rt.spec.rcon) {
      const res = await sendRcon(rt.spec.rcon.port, rt.spec.rcon.password, command);
      if (res?.trim()) this.pushConsole(serverId, res.trim(), "stdout");
      return;
    }
    // console-only games (e.g. Icarus): write to container stdin
    if (!rt.stdin) rt.stdin = await attachStdin(serverId);
    rt.stdin.write(command + "\n");
  }

  async destroy(serverId: string, purgeVolume = false): Promise<void> {
    this.endStreaming(serverId);
    await removeContainer(serverId, purgeVolume);
    this.servers.delete(serverId);
  }

  subscribe(
    serverId: string,
    handlers: {
      onConsole?: (lines: ConsoleLine[]) => void;
      onStats?: (s: ServerStats) => void;
      onState?: (s: ServerState) => void;
    },
  ): () => void {
    const c = (lines: ConsoleLine[]) => handlers.onConsole?.(lines);
    const s = (st: ServerStats) => handlers.onStats?.(st);
    const t = (st: ServerState) => handlers.onState?.(st);
    if (handlers.onConsole) this.on(`console:${serverId}`, c);
    if (handlers.onStats) this.on(`stats:${serverId}`, s);
    if (handlers.onState) this.on(`state:${serverId}`, t);
    return () => {
      this.off(`console:${serverId}`, c);
      this.off(`stats:${serverId}`, s);
      this.off(`state:${serverId}`, t);
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private requireRuntime(serverId: string): Runtime {
    const rt = this.servers.get(serverId);
    if (!rt) throw new Error(`server ${serverId} is not registered on this node`);
    return rt;
  }

  private setState(serverId: string, state: ServerState) {
    const rt = this.servers.get(serverId);
    if (!rt) return;
    if (rt.state === state) return;
    rt.state = state;
    if (state === ServerState.Offline || state === ServerState.Errored) {
      rt.startedAt = undefined;
      rt.players = undefined;
    }
    this.emit(`state:${serverId}`, state);
  }

  private pushConsole(serverId: string, line: string, stream: ConsoleLine["stream"]) {
    const rt = this.servers.get(serverId);
    if (!rt) return;
    const entry: ConsoleLine = { ts: Date.now(), line, stream };
    rt.console.push(entry);
    if (rt.console.length > CONSOLE_BUFFER) rt.console.splice(0, rt.console.length - CONSOLE_BUFFER);
    this.emit(`console:${serverId}`, [entry]);
  }

  private beginStreaming(serverId: string) {
    const rt = this.servers.get(serverId);
    if (!rt) return;
    this.endStreaming(serverId, false);

    const doneRe = rt.spec.startupDoneRegex ? new RegExp(rt.spec.startupDoneRegex) : null;

    followLogs(serverId, (line, kind) => {
      const entry: ConsoleLine = { ts: Date.now(), line, stream: kind };
      rt.console.push(entry);
      if (rt.console.length > CONSOLE_BUFFER) rt.console.splice(0, rt.console.length - CONSOLE_BUFFER);
      this.emit(`console:${serverId}`, [entry]);
      if (doneRe && rt.state === ServerState.Starting && doneRe.test(line)) {
        this.setState(serverId, ServerState.Running);
      }
    })
      .then((stop) => (rt.stopLogs = stop))
      .catch((e) => logger.warn({ e, serverId }, "log stream failed"));

    streamStats(serverId, (partial) => {
      const limitBytes = rt.spec.limits.memoryMb * 1024 * 1024;
      const stats: ServerStats = {
        ...partial,
        state: rt.state,
        memoryLimitBytes: limitBytes || partial.memoryLimitBytes,
        cpuPercentOfLimit:
          rt.spec.limits.cpuPercent > 0
            ? Math.min(100, Math.round((partial.cpuPercent / rt.spec.limits.cpuPercent) * 100))
            : 0,
        uptimeSeconds: rt.startedAt ? Math.floor((Date.now() - rt.startedAt) / 1000) : 0,
        diskBytes: rt.lastStats?.diskBytes ?? 0,
        players: rt.players ? { online: rt.players.online, max: rt.players.max, sample: rt.players.sample } : undefined,
      };
      rt.lastStats = stats;
      this.emit(`stats:${serverId}`, stats);
    })
      .then((stop) => (rt.stopStats = stop))
      .catch((e) => logger.warn({ e, serverId }, "stats stream failed"));

    // periodic player query (RCON-capable games only)
    if (rt.spec.rcon) {
      rt.playerTimer = setInterval(async () => {
        if (rt.state !== ServerState.Running) return;
        const players = await queryPlayers(rt.spec.rcon!.port, rt.spec.rcon!.password);
        if (players) rt.players = players;
      }, 15000);
    }
    // periodic disk usage
    rt.diskTimer = setInterval(async () => {
      rt.lastStats && (rt.lastStats.diskBytes = await volumeSize(serverId).catch(() => 0));
    }, 60000);
  }

  private endStreaming(serverId: string, clearStdin = true) {
    const rt = this.servers.get(serverId);
    if (!rt) return;
    rt.stopLogs?.();
    rt.stopStats?.();
    rt.stopLogs = undefined;
    rt.stopStats = undefined;
    if (rt.playerTimer) clearInterval(rt.playerTimer);
    if (rt.diskTimer) clearInterval(rt.diskTimer);
    rt.playerTimer = undefined;
    rt.diskTimer = undefined;
    if (clearStdin && rt.stdin) {
      try {
        rt.stdin.end();
      } catch {
        /* noop */
      }
      rt.stdin = undefined;
    }
  }

  /** Called by the docker-events watcher when a container changes state. */
  onDockerEvent(serverId: string, action: string) {
    const rt = this.servers.get(serverId);
    if (!rt) return;
    if (action === "die" || action === "stop") {
      this.setState(serverId, rt.state === ServerState.Stopping ? ServerState.Offline : ServerState.Errored);
      this.endStreaming(serverId);
    } else if (action === "start") {
      if (rt.state !== ServerState.Running) this.setState(serverId, ServerState.Starting);
      this.beginStreaming(serverId);
    }
  }
}

export const manager = new ServerManager();
