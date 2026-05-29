import tar from "tar-fs";
import zlib from "node:zlib";
import fs from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import type { BackupMeta, ServerBuildSpec } from "@aether/shared";
import { config } from "./config.js";
import { hostVolumePath } from "./docker.js";
import { sendRcon } from "./rcon.js";
import { logger } from "./logger.js";

function backupDir(serverId: string): string {
  return path.join(config.backupDir, serverId);
}
function backupFile(serverId: string, backupId: string): string {
  return path.join(backupDir(serverId), `${backupId}.tar.gz`);
}

/** Flush a Minecraft world to disk via RCON before archiving (prevents corruption). */
async function flush(spec?: ServerBuildSpec) {
  if (!spec?.rcon) return;
  try {
    await sendRcon(spec.rcon.port, spec.rcon.password, "save-off");
    await sendRcon(spec.rcon.port, spec.rcon.password, "save-all flush");
  } catch (e) {
    logger.warn({ e }, "backup pre-flush failed (continuing)");
  }
}
async function unflush(spec?: ServerBuildSpec) {
  if (!spec?.rcon) return;
  try {
    await sendRcon(spec.rcon.port, spec.rcon.password, "save-on");
  } catch {
    /* noop */
  }
}

export async function createBackup(
  serverId: string,
  backupId: string,
  name: string,
  opts: { ignore?: string[]; spec?: ServerBuildSpec } = {},
): Promise<BackupMeta> {
  await fs.mkdir(backupDir(serverId), { recursive: true });
  const dest = backupFile(serverId, backupId);
  const src = hostVolumePath(serverId);

  await flush(opts.spec);
  try {
    const hash = crypto.createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      const pack = tar.pack(src, {
        ignore: (name) => (opts.ignore ?? []).some((ig) => name.includes(ig)),
      });
      const gzip = zlib.createGzip({ level: 6 });
      const out = createWriteStream(dest);
      pack.on("error", reject);
      gzip.on("error", reject);
      out.on("error", reject);
      out.on("finish", () => resolve());
      const gz = pack.pipe(gzip);
      gz.on("data", (c: Buffer) => hash.update(c));
      gz.pipe(out);
    });
    const st = await fs.stat(dest);
    return {
      id: backupId,
      name,
      sizeBytes: st.size,
      checksum: hash.digest("hex"),
      createdAt: Date.now(),
      completed: true,
      locked: false,
      storage: "local",
    };
  } finally {
    await unflush(opts.spec);
  }
}

export async function restoreBackup(serverId: string, backupId: string): Promise<void> {
  const file = backupFile(serverId, backupId);
  const dest = hostVolumePath(serverId);
  await fs.access(file);
  // Clear current volume contents, then extract.
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(file);
    const gunzip = zlib.createGunzip();
    const extract = tar.extract(dest);
    rs.on("error", reject);
    gunzip.on("error", reject);
    extract.on("error", reject);
    extract.on("finish", () => resolve());
    rs.pipe(gunzip).pipe(extract);
  });
}

export async function deleteBackup(serverId: string, backupId: string): Promise<void> {
  await fs.rm(backupFile(serverId, backupId), { force: true });
}

export function downloadBackup(serverId: string, backupId: string) {
  return createReadStream(backupFile(serverId, backupId));
}
