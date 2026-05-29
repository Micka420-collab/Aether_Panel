import { Rcon } from "rcon-client";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Thin RCON helper. RCON ports are bound to 127.0.0.1 only, so the daemon
 * (running on the host) can reach them while players cannot.
 */
export async function sendRcon(port: number, password: string, command: string): Promise<string> {
  const rcon = await Rcon.connect({ host: "127.0.0.1", port, password, timeout: 5000 });
  try {
    return await rcon.send(command);
  } finally {
    await rcon.end().catch(() => {});
  }
}

/** Parse Minecraft's `list` output: "There are N of a max of M players online: a, b". */
export function parsePlayerList(raw: string): { online: number; max: number; sample: string[] } {
  const m = raw.match(/There are (\d+) of a max of (\d+) players online:?\s*(.*)/i);
  if (!m) return { online: 0, max: 0, sample: [] };
  const sample = (m[3] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { online: Number(m[1]), max: Number(m[2]), sample };
}

export async function queryPlayers(
  port: number,
  password: string,
): Promise<{ online: number; max: number; sample: string[] } | null> {
  try {
    const raw = await sendRcon(port, password, "list");
    return parsePlayerList(raw);
  } catch (e) {
    if (config.logLevel === "debug") logger.debug({ e }, "rcon player query failed");
    return null;
  }
}
