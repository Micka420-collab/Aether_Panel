import { SignJWT } from "jose";
import type { Node } from "@prisma/client";
import type { ServerBuildSpec, ServerState, ServerStats, FileEntry, BackupMeta } from "@aether/shared";

export type NodeLike = Pick<Node, "scheme" | "fqdn" | "daemonPort" | "tokenSecret" | "publicIp">;

export class DaemonClient {
  private base: string;
  constructor(private node: NodeLike) {
    this.base = `${node.scheme}://${node.fqdn}:${node.daemonPort}`;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.node.tokenSecret}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      let msg = `daemon ${res.status}`;
      try {
        msg = (await res.json())?.error ?? msg;
      } catch {
        /* noop */
      }
      throw new Error(msg);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  health() {
    return this.req<{ ok: boolean }>("GET", "/api/health");
  }
  system() {
    return this.req<any>("GET", "/api/system");
  }
  registerServer(spec: ServerBuildSpec) {
    return this.req<{ accepted: boolean }>("POST", "/api/servers", spec);
  }
  status(serverId: string) {
    return this.req<{ state: ServerState; stats: ServerStats | null; players: unknown }>(
      "GET",
      `/api/servers/${serverId}`,
    );
  }
  power(serverId: string, action: string) {
    return this.req<void>("POST", `/api/servers/${serverId}/power`, { action });
  }
  command(serverId: string, command: string) {
    return this.req<void>("POST", `/api/servers/${serverId}/command`, { command });
  }
  destroy(serverId: string, purge = false) {
    return this.req<void>("DELETE", `/api/servers/${serverId}${purge ? "?purge=1" : ""}`);
  }

  // files
  listFiles(serverId: string, path: string) {
    return this.req<{ path: string; entries: FileEntry[] }>(
      "GET",
      `/api/servers/${serverId}/files?path=${encodeURIComponent(path)}`,
    );
  }
  readFile(serverId: string, path: string) {
    return this.req<{ path: string; content: string }>(
      "GET",
      `/api/servers/${serverId}/files/content?path=${encodeURIComponent(path)}`,
    );
  }
  writeFile(serverId: string, path: string, content: string) {
    return this.req<void>("PUT", `/api/servers/${serverId}/files/content`, { path, content });
  }
  mkdir(serverId: string, path: string) {
    return this.req<void>("POST", `/api/servers/${serverId}/files/mkdir`, { path });
  }
  renameFile(serverId: string, from: string, to: string) {
    return this.req<void>("POST", `/api/servers/${serverId}/files/rename`, { from, to });
  }
  deleteFile(serverId: string, path: string) {
    return this.req<void>("DELETE", `/api/servers/${serverId}/files?path=${encodeURIComponent(path)}`);
  }

  // backups
  createBackup(serverId: string, backupId: string, name: string, ignore?: string[]) {
    return this.req<BackupMeta>("POST", `/api/servers/${serverId}/backups`, { backupId, name, ignore });
  }
  restoreBackup(serverId: string, backupId: string) {
    return this.req<void>("POST", `/api/servers/${serverId}/backups/${backupId}/restore`);
  }
  deleteBackup(serverId: string, backupId: string) {
    return this.req<void>("DELETE", `/api/servers/${serverId}/backups/${backupId}`);
  }

  /** Browser-facing WebSocket URL for live console/stats. */
  wsUrl(serverId: string): string {
    const wsScheme = this.node.scheme === "https" ? "wss" : "ws";
    return `${wsScheme}://${this.node.fqdn}:${this.node.daemonPort}/api/servers/${serverId}/ws`;
  }
}

/**
 * Mint a short-lived JWT the browser uses to authenticate to the daemon's
 * WebSocket. Signed with the node's shared secret (HMAC), scoped to one server.
 */
export async function signWsToken(node: NodeLike, serverId: string, scopes: string[]): Promise<string> {
  return new SignJWT({ serverId, scopes })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(node.tokenSecret));
}
