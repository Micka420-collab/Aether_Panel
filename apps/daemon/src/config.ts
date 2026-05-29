import os from "node:os";

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return v;
}

const isWindows = process.platform === "win32";

export const config = {
  port: Number(env("DAEMON_PORT", "8080")),
  /** shared secret: HTTP Bearer (panel -> daemon) and HMAC for WS JWTs (browser -> daemon) */
  token: env("DAEMON_TOKEN", "dev-daemon-token-change-me"),
  /** host directory where each server's bind-mounted volume lives */
  dataDir: env("DAEMON_DATA_DIR", isWindows ? `${os.tmpdir()}\\aether\\volumes` : "/var/lib/aether/volumes"),
  backupDir: env("DAEMON_BACKUP_DIR", isWindows ? `${os.tmpdir()}\\aether\\backups` : "/var/lib/aether/backups"),
  dockerSocket: env("DOCKER_SOCKET", isWindows ? "//./pipe/docker_engine" : "/var/run/docker.sock"),
  publicIp: env("NODE_PUBLIC_IP", "127.0.0.1"),
  logLevel: env("LOG_LEVEL", "info"),
  /** container name prefix */
  prefix: "aether",
  /** panel base URL the daemon calls back for SFTP auth */
  panelUrl: env("PANEL_URL", "http://localhost:3000"),
  /** SFTP listen port (0 disables the SFTP server) */
  sftpPort: Number(env("SFTP_PORT", "2022")),
  /** where the generated SSH host key is stored */
  hostKeyPath: env("SFTP_HOST_KEY", isWindows ? `${os.tmpdir()}\\aether\\ssh_host_key` : "/var/lib/aether/ssh_host_key"),
} as const;

export type Config = typeof config;
