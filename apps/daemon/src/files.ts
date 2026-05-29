import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import type { FileEntry } from "@aether/shared";
import { hostVolumePath } from "./docker.js";

/**
 * Resolve a user-supplied relative path against a server's volume root,
 * guaranteeing the result stays inside the jail (no `..` traversal, no
 * absolute escapes). Throws on any attempt to break out.
 */
export function safeResolve(serverId: string, rel: string): string {
  const root = path.resolve(hostVolumePath(serverId));
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = path.resolve(root, clean);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error("path escapes server volume");
  }
  return resolved;
}

function rel(serverId: string, abs: string): string {
  const root = path.resolve(hostVolumePath(serverId));
  return "/" + path.relative(root, abs).replace(/\\/g, "/");
}

const MIME: Record<string, string> = {
  ".txt": "text/plain", ".log": "text/plain", ".json": "application/json",
  ".yml": "text/yaml", ".yaml": "text/yaml", ".properties": "text/plain",
  ".ini": "text/plain", ".cfg": "text/plain", ".conf": "text/plain",
  ".sh": "text/x-shellscript", ".jar": "application/java-archive",
  ".zip": "application/zip", ".png": "image/png", ".jpg": "image/jpeg",
  ".toml": "text/plain", ".mcfunction": "text/plain", ".md": "text/markdown",
};

export async function listDir(serverId: string, dir: string): Promise<FileEntry[]> {
  const abs = safeResolve(serverId, dir);
  const names = await fs.readdir(abs);
  const entries = await Promise.all(
    names.map(async (name): Promise<FileEntry | null> => {
      const full = path.join(abs, name);
      try {
        const st = await fs.lstat(full);
        return {
          name,
          path: rel(serverId, full),
          isDir: st.isDirectory(),
          size: st.size,
          mode: (st.mode & 0o777).toString(8),
          modifiedAt: st.mtimeMs,
          mime: st.isDirectory() ? undefined : MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream",
        };
      } catch {
        return null;
      }
    }),
  );
  return entries
    .filter((e): e is FileEntry => e !== null)
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
}

const MAX_EDIT_BYTES = 8 * 1024 * 1024; // 8 MB editable cap

export async function readFile(serverId: string, file: string): Promise<string> {
  const abs = safeResolve(serverId, file);
  const st = await fs.stat(abs);
  if (st.size > MAX_EDIT_BYTES) throw new Error("file too large to edit in the browser");
  return fs.readFile(abs, "utf8");
}

export async function writeFile(serverId: string, file: string, content: string): Promise<void> {
  const abs = safeResolve(serverId, file);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

export async function mkdir(serverId: string, dir: string): Promise<void> {
  await fs.mkdir(safeResolve(serverId, dir), { recursive: true });
}

export async function rename(serverId: string, from: string, to: string): Promise<void> {
  await fs.rename(safeResolve(serverId, from), safeResolve(serverId, to));
}

export async function remove(serverId: string, target: string): Promise<void> {
  await fs.rm(safeResolve(serverId, target), { recursive: true, force: true });
}

export function createDownloadStream(serverId: string, file: string) {
  return createReadStream(safeResolve(serverId, file));
}

export async function saveUpload(serverId: string, dir: string, filename: string, source: NodeJS.ReadableStream) {
  const safeName = path.basename(filename);
  const abs = safeResolve(serverId, path.join(dir, safeName));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(abs);
    source.pipe(ws);
    ws.on("finish", () => resolve());
    ws.on("error", reject);
    source.on("error", reject);
  });
}

/** Best-effort recursive disk usage of the server's volume, in bytes. */
export async function volumeSize(serverId: string): Promise<number> {
  const root = hostVolumePath(serverId);
  let total = 0;
  async function walk(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      try {
        if (e.isDirectory()) await walk(full);
        else if (e.isFile()) total += (await fs.stat(full)).size;
      } catch {
        /* skip */
      }
    }
  }
  await walk(root);
  return total;
}
