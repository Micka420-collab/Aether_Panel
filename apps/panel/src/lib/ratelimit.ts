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

/**
 * Client IP for rate limiting / allowlists. Prefers headers a trusted upstream
 * sets from the real socket peer and that clients cannot forge:
 *  - X-Real-Client-IP: set by the bundled Caddy (overwrites any client value)
 *  - CF-Connecting-IP: set by Cloudflare
 * Falls back to the (spoofable) X-Forwarded-For only if neither is present.
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const real = headers.get("x-real-client-ip");
  if (real) return real.trim();
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip") || "unknown";
}
