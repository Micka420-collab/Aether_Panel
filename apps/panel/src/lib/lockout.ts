import "server-only";

/**
 * Per-identifier failed-attempt lockout (in-memory) to stop online brute-force
 * of passwords / TOTP / recovery codes — complementing the per-IP middleware
 * rate limiter (which an attacker rotating IPs could otherwise evade).
 *
 * For multi-instance deployments, back this with Redis (same interface).
 */
interface Rec {
  fails: number;
  until: number; // lock expiry epoch ms (0 = not locked)
}

const store = new Map<string, Rec>();

export interface LockPolicy {
  threshold: number;
  lockMs: number;
}

/** Returns seconds remaining if locked, else 0. */
export function lockedFor(key: string): number {
  const r = store.get(key);
  if (!r) return 0;
  if (r.until > Date.now()) return Math.ceil((r.until - Date.now()) / 1000);
  if (r.until) store.delete(key); // lock expired
  return 0;
}

export function recordFailure(key: string, policy: LockPolicy): void {
  const r = store.get(key) ?? { fails: 0, until: 0 };
  r.fails++;
  if (r.fails >= policy.threshold) {
    r.until = Date.now() + policy.lockMs;
    r.fails = 0;
  }
  store.set(key, r);
  if (store.size > 50_000) {
    const now = Date.now();
    for (const [k, v] of store) if (!v.until || v.until < now) store.delete(k);
  }
}

export function resetFailures(key: string): void {
  store.delete(key);
}

export const LOGIN_POLICY: LockPolicy = { threshold: 10, lockMs: 15 * 60_000 };
export const MFA_POLICY: LockPolicy = { threshold: 5, lockMs: 15 * 60_000 };
