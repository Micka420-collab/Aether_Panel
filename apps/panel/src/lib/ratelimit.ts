/**
 * Edge-safe fixed-window rate limiter. Pure JS (Map + Date.now) so it can run
 * inside Next.js middleware (Edge runtime) with no Node imports.
 *
 * For a single self-hosted instance this in-memory store is shared across all
 * requests. At horizontal scale, back it with Redis/Upstash (swap `hit`).
 */
interface Window {
  count: number;
  resetAt: number;
}

const store = new Map<string, Window>();
const MAX_KEYS = 100_000;

function prune(now: number) {
  for (const [k, w] of store) if (w.resetAt <= now) store.delete(k);
}

export interface RateResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** seconds until the window resets */
  retryAfter: number;
}

export function hit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  let w = store.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMs };
    store.set(key, w);
  }
  w.count++;
  if (store.size > MAX_KEYS) prune(now);
  const ok = w.count <= limit;
  return { ok, limit, remaining: Math.max(0, limit - w.count), retryAfter: ok ? 0 : Math.ceil((w.resetAt - now) / 1000) };
}

/** Best-effort client IP from common proxy headers. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip") || headers.get("cf-connecting-ip") || "unknown";
}
