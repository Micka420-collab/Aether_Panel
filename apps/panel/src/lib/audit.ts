import "server-only";
import { headers } from "next/headers";
import { db } from "./db";

export async function audit(
  action: string,
  opts: { userId?: string; serverId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
    await db.auditLog.create({
      data: {
        action,
        userId: opts.userId ?? null,
        serverId: opts.serverId ?? null,
        metadata: (opts.metadata ?? {}) as object,
        ip,
      },
    });
  } catch {
    // never let auditing break the request
  }
}
