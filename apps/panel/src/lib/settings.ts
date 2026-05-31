import "server-only";
import { db } from "./db";
import { encrypt, decrypt } from "./crypto";

/**
 * Instance-wide settings stored in the DB so operators can configure things from
 * the dashboard instead of editing code/.env. Secret values are encrypted at
 * rest with the same AES-256-GCM helper used for TOTP secrets.
 */

/** Well-known setting keys. */
export const SETTING_ANTHROPIC_KEY = "anthropic_api_key";

/** Read + decrypt a secret setting. Returns null if absent or undecryptable. */
export async function getSecretSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return decrypt(row.value);
  } catch {
    // A rotated AUTH_SECRET (the KDF input) makes old ciphertext undecryptable —
    // treat it as "unset" rather than crashing the caller, but warn so an operator
    // can tell their stored secret became inaccessible (vs. simply never set).
    console.warn(`[settings] could not decrypt "${key}" (AUTH_SECRET rotated?) — treating as unset`);
    return null;
  }
}

/** Encrypt + upsert a secret setting. */
export async function setSecretSetting(key: string, plain: string): Promise<void> {
  const value = encrypt(plain);
  await db.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/** Remove a setting (no-op if absent). */
export async function deleteSetting(key: string): Promise<void> {
  await db.setting.deleteMany({ where: { key } });
}

/**
 * Resolve the Anthropic API key for the AI Copilot. A key set from the dashboard
 * (DB, encrypted) takes precedence over the ANTHROPIC_API_KEY env var, so an
 * operator can enable/override the AI without redeploying. Returns the source so
 * the admin UI can show where the active key comes from.
 */
export async function getAnthropicKey(): Promise<{ key: string | null; source: "db" | "env" | null }> {
  const dbKey = (await getSecretSetting(SETTING_ANTHROPIC_KEY))?.trim();
  if (dbKey) return { key: dbKey, source: "db" };
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) return { key: envKey, source: "env" };
  return { key: null, source: null };
}
