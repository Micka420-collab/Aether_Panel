import tar from "tar-fs";
import zlib from "node:zlib";
import fs from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import type { BackupMeta, ServerBuildSpec } from "@aether/shared";
import { config } from "./config.js";
import { hostVolumePath, rconHost } from "./docker.js";
import { sendRcon } from "./rcon.js";
import { logger } from "./logger.js";

function backupDir(serverId: string): string {
  return path.join(config.backupDir, serverId);
}
function backupFile(serverId: string, backupId: string): string {
  return path.join(backupDir(serverId), `${backupId}.tar.gz`);
}

/** Flush a Minecraft world to disk via RCON before archiving (prevents corruption). */
async function flush(serverId: string, spec?: ServerBuildSpec) {
  if (!spec?.rcon) return;
  try {
    const host = await rconHost(serverId);
    await sendRcon(host, spec.rcon.port, spec.rcon.password, "save-off");
    await sendRcon(host, spec.rcon.port, spec.rcon.password, "save-all flush");
  } catch (e) {
    logger.warn({ e }, "backup pre-flush failed (continuing)");
  }
}
async function unflush(serverId: string, spec?: ServerBuildSpec) {
  if (!spec?.rcon) return;
  try {
    await sendRcon(await rconHost(serverId), spec.rcon.port, spec.rcon.password, "save-on");
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

  await flush(serverId, opts.spec);
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
    await unflush(serverId, opts.spec);
  }
}

export async function restoreBackup(serverId: string, backupId: string): Promise<void> {
  const file = backupFile(serverId, backupId);
  const dest = hostVolumePath(serverId);
  await fs.access(file);

  // Crash-safe restore: extract into a TEMP sibling dir first, and only swap it
  // in once the stream has finished without error. A truncated/corrupt archive or
  // a disk-full mid-extract therefore leaves the original volume intact (the old
  // code wiped the live volume before extracting — total data loss on failure).
  const exists = (p: string) => fs.access(p).then(() => true).catch(() => false);
  const tmp = `${dest}.restore-${process.pid}`;
  const old = `${dest}.old-${process.pid}`;
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(tmp, { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(file);
      const gunzip = zlib.createGunzip();
      const extract = tar.extract(tmp);
      rs.on("error", reject);
      gunzip.on("error", reject);
      extract.on("error", reject);
      extract.on("finish", () => resolve());
      rs.pipe(gunzip).pipe(extract);
    });

    // Preserve the daemon's internal spec dir if the archive didn't include it,
    // so the server stays manageable after a restart.
    if (!(await exists(path.join(tmp, ".aether"))) && (await exists(path.join(dest, ".aether")))) {
      await fs.cp(path.join(dest, ".aether"), path.join(tmp, ".aether"), { recursive: true });
    }

    // Swap the restored tree in. Same-filesystem renames are atomic and fast.
    await fs.rename(dest, old);
    await fs.rename(tmp, dest);
    await fs.rm(old, { recursive: true, force: true }).catch(() => {});
  } catch (e) {
    // Original volume untouched — just clean up the temp dir.
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

export async function deleteBackup(serverId: string, backupId: string): Promise<void> {
  await fs.rm(backupFile(serverId, backupId), { force: true });
}

export function downloadBackup(serverId: string, backupId: string) {
  return createReadStream(backupFile(serverId, backupId));
}
