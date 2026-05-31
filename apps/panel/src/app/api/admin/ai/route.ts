import { z } from "zod";
import { headers } from "next/headers";
import { requireAdmin, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { hit, clientIp } from "@/lib/ratelimit";
import {
  SETTING_ANTHROPIC_KEY,
  setSecretSetting,
  deleteSetting,
  getAnthropicKey,
} from "@/lib/settings";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * SAFETY: mask() reveals key length at the 12-char boundary. That's harmless for
 * Anthropic keys (always ~100 chars) — do NOT reuse it for short secrets.
 */
function mask(key: string): string {
  const k = key.trim();
  if (k.length <= 12) return "sk-ant-…";
  return `${k.slice(0, 8)}…${k.slice(-4)}`;
}

/** Current AI Copilot key status for the admin card (never returns the secret). */
export const GET = route(async () => {
  await requireAdmin();
  const { key, source } = await getAnthropicKey();
  return json({
    configured: !!key,
    source, // "db" (set here) | "env" (from ANTHROPIC_API_KEY) | null
    masked: key ? mask(key) : null,
  });
});

// Anthropic keys are ~100 chars; min 20 keeps obviously-bogus values from
// triggering a wasted validation call to Anthropic.
const putSchema = z.object({ apiKey: z.string().min(20).max(300) });

/**
 * Set / replace the Anthropic API key from the dashboard. The key is validated
 * against Anthropic (so the admin gets instant feedback on a bad key) and stored
 * AES-256-GCM encrypted in the DB, taking precedence over the env var.
 */
export const PUT = route(async (req) => {
  const admin = await requireAdmin();
  // Each PUT makes a real Anthropic call to validate — cap attempts per admin.
  const rl = hit(`admin-ai:${admin.id}:${clientIp(await headers())}`, 10, 3_600_000);
  if (!rl.ok) throw new HttpError(429, `Too many attempts. Try again in ${rl.retryAfter}s.`);

  const { apiKey } = putSchema.parse(await req.json());
  const key = apiKey.trim();
  if (!key.startsWith("sk-ant-")) {
    throw new HttpError(400, 'That doesn\'t look like an Anthropic API key (it should start with "sk-ant-").');
  }
  const validated = await validateAnthropicKey(key); // throws HttpError(400) on a hard auth rejection
  await setSecretSetting(SETTING_ANTHROPIC_KEY, key);
  await audit("admin.ai.key.set", { userId: admin.id, metadata: { validated } });
  return json({
    configured: true,
    source: "db",
    masked: mask(key),
    // When Anthropic was unreachable we saved the (format-valid) key without a
    // live check; tell the admin so they can re-test later.
    validationWarning: validated ? undefined : "Saved, but Anthropic was unreachable so the key wasn't live-tested. Re-save when your network is stable to confirm it.",
  });
});

/** Remove the dashboard key (the Copilot then falls back to the env var, if any). */
export const DELETE = route(async () => {
  const admin = await requireAdmin();
  await deleteSetting(SETTING_ANTHROPIC_KEY);
  await audit("admin.ai.key.clear", { userId: admin.id });
  const { key, source } = await getAnthropicKey();
  return json({ configured: !!key, source, masked: key ? mask(key) : null });
});

/**
 * Cheap 1-token call to confirm Anthropic accepts the key. Only a hard auth
 * failure (401/403) blocks saving; transient errors (network, rate-limit) don't,
 * since they still prove or don't disprove the key.
 */
async function validateAnthropicKey(key: string): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(400, "Anthropic rejected this key (401/403). Double-check it and try again.");
    }
    return true; // any non-auth-failure response proves the key authenticates
  } catch (e) {
    if (e instanceof HttpError) throw e;
    // Network/timeout/abort — don't block saving on a transient problem, but
    // report that the key wasn't live-tested.
    console.debug("[admin/ai] key validation could not reach Anthropic; saving untested:", e instanceof Error ? e.message : e);
    return false;
  } finally {
    clearTimeout(t);
  }
}
