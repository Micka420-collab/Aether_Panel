import "server-only";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { cookies, headers } from "next/headers";
import type { User } from "@prisma/client";
import { db } from "./db";
import { randomToken, sha256, encrypt, decrypt } from "./crypto";

export const SESSION_COOKIE = "aether_session";
const SESSION_TTL_DAYS = 30;

// ── passwords ──────────────────────────────────────────────────────────
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── sessions (DB-backed, opaque cookie token) ────────────────────────────
export async function createSession(userId: string, mfaCompleted: boolean): Promise<string> {
  const token = randomToken(32);
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
  await db.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      mfaCompleted,
      userAgent: h.get("user-agent")?.slice(0, 255) ?? null,
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null,
      expiresAt,
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function markSessionMfaComplete(token: string): Promise<void> {
  await db.session.update({ where: { tokenHash: sha256(token) }, data: { mfaCompleted: true } });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export interface AuthContext {
  user: User;
  sessionToken: string;
  mfaCompleted: boolean;
}

export async function getAuth(): Promise<AuthContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return { user: session.user, sessionToken: token, mfaCompleted: session.mfaCompleted };
}

/** Returns the user only if fully authenticated (2FA satisfied when enabled). */
export async function getCurrentUser(): Promise<User | null> {
  const auth = await getAuth();
  if (!auth) return null;
  if (auth.user.totpEnabled && !auth.mfaCompleted) return null;
  return auth.user;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Authentication required");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new HttpError(403, "Admin only");
  return user;
}

// ── TOTP 2FA ─────────────────────────────────────────────────────────────
export function newTotpSecret(): string {
  return authenticator.generateSecret();
}
export function totpUri(username: string, secret: string): string {
  return authenticator.keyuri(username, "Aether", secret);
}
export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: token.replace(/\s/g, ""), secret });
  } catch {
    return false;
  }
}
export function encryptSecret(s: string): string {
  return encrypt(s);
}
export function decryptSecret(s: string): string {
  return decrypt(s);
}

// ── error helper used across route handlers ──────────────────────────────
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
