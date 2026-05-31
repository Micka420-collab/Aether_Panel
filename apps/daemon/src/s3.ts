// Off-site backup storage for any S3-compatible object store (AWS S3, Backblaze
// B2, Cloudflare R2, MinIO, Wasabi, …). This is intentionally dependency-free:
// it implements just enough AWS Signature V4 to PUT an object, presign a GET URL,
// HEAD/GET/DELETE — using only Node's built-in crypto + fetch. That keeps the
// daemon image small and avoids pulling the whole @aws-sdk tree.
//
// DORMANCY: every function is a safe no-op (or returns false/null) when S3 is not
// configured (S3_ENDPOINT unset). Callers can therefore always invoke these and
// branch on `s3Enabled()` / the boolean return, with no behaviour change when the
// operator hasn't provided credentials.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import { logger } from "./logger.js";

// ── configuration (read directly from env so this module stays decoupled from
//    config.ts, which the integration rules forbid editing) ──────────────────
const S3 = {
  endpoint: (process.env.S3_ENDPOINT ?? "").trim().replace(/\/+$/, ""),
  region: (process.env.S3_REGION ?? "auto").trim() || "auto",
  bucket: (process.env.S3_BUCKET ?? "").trim(),
  accessKey: (process.env.S3_ACCESS_KEY ?? "").trim(),
  secretKey: (process.env.S3_SECRET_KEY ?? "").trim(),
  // Path-style addressing (https://endpoint/bucket/key) works with every
  // S3-compatible provider; virtual-host style is provider-specific. Default to
  // path-style for portability; set S3_FORCE_PATH_STYLE=0 to opt out.
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "1").trim() !== "0",
} as const;

const EMPTY_SHA256 = crypto.createHash("sha256").update("").digest("hex");
const SERVICE = "s3";

/** True only when enough S3 env is present to attempt uploads. */
export function s3Enabled(): boolean {
  return Boolean(S3.endpoint && S3.bucket && S3.accessKey && S3.secretKey);
}

// ── low-level signing helpers ────────────────────────────────────────────────

function hmac(key: crypto.BinaryLike | crypto.KeyObject, data: string): Buffer {
  return crypto.createHmac("sha256", key as crypto.BinaryLike).update(data, "utf8").digest();
}
function sha256Hex(data: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** AWS-style URI encoding (each path segment; never encode the slashes). */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join("/");
}

function amzDates(now = new Date()): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${S3.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, S3.region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

/** { host, basePath } for the configured endpoint + bucket. */
function endpointParts(): { protocol: string; host: string; basePath: string } {
  const u = new URL(S3.endpoint);
  const host = u.host;
  if (S3.forcePathStyle) {
    return { protocol: u.protocol, host, basePath: `/${S3.bucket}` };
  }
  // virtual-host style: bucket becomes a subdomain
  return { protocol: u.protocol, host: `${S3.bucket}.${host}`, basePath: "" };
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Build a SigV4-signed request for an object operation.
 * `payloadHash` must be the hex sha256 of the body (or "UNSIGNED-PAYLOAD").
 */
function signRequest(
  method: "GET" | "PUT" | "HEAD" | "DELETE",
  key: string,
  payloadHash: string,
  extraHeaders: Record<string, string> = {},
): SignedRequest {
  const { protocol, host, basePath } = endpointParts();
  const canonicalUri = `${basePath}/${encodeKey(key)}`;
  const { amzDate, dateStamp } = amzDates();

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
  };

  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${String(headers[k]).trim()}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${S3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(signingKey(dateStamp), stringToSign).toString("hex");

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${S3.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `${protocol}//${host}${canonicalUri}`, headers };
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * Upload a local file to S3 under `key`. Returns true on success, false if S3 is
 * not configured or the upload failed (failures are logged, never thrown — an
 * off-site copy is best-effort and must not break a local backup).
 */
export async function uploadToS3(localPath: string, key: string): Promise<boolean> {
  if (!s3Enabled()) return false;
  try {
    const body = await fs.readFile(localPath);
    const payloadHash = sha256Hex(body);
    const { url, headers } = signRequest("PUT", key, payloadHash, {
      "content-type": "application/gzip",
      "content-length": String(body.length),
    });
    const res = await fetch(url, { method: "PUT", headers, body });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, key, text: text.slice(0, 300) }, "S3 upload failed");
      return false;
    }
    logger.info({ key, bytes: body.length }, "backup uploaded to S3");
    return true;
  } catch (e: any) {
    logger.warn({ e: e?.message, key }, "S3 upload error");
    return false;
  }
}

/** True if the object exists in the bucket. False when S3 is off or on any error. */
export async function existsInS3(key: string): Promise<boolean> {
  if (!s3Enabled()) return false;
  try {
    const { url, headers } = signRequest("HEAD", key, EMPTY_SHA256);
    const res = await fetch(url, { method: "HEAD", headers });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Download an S3 object to `localPath`. Returns true on success. Used to lazily
 * re-hydrate a backup whose local .tar.gz is missing (e.g. node was replaced).
 */
export async function downloadFromS3(key: string, localPath: string): Promise<boolean> {
  if (!s3Enabled()) return false;
  try {
    const { url, headers } = signRequest("GET", key, EMPTY_SHA256);
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok || !res.body) {
      logger.warn({ status: res.status, key }, "S3 download failed");
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(localPath, buf);
    return true;
  } catch (e: any) {
    logger.warn({ e: e?.message, key }, "S3 download error");
    return false;
  }
}

/** Stream an S3 object (for piping straight to an HTTP response). null if absent/off. */
export async function streamFromS3(key: string): Promise<Readable | null> {
  if (!s3Enabled()) return null;
  try {
    const { url, headers } = signRequest("GET", key, EMPTY_SHA256);
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok || !res.body) return null;
    // Node 18+: convert the web ReadableStream to a Node Readable.
    const { Readable } = await import("node:stream");
    return Readable.fromWeb(res.body as any);
  } catch {
    return null;
  }
}

/** Delete an object. Best-effort; returns true on 2xx/404, false otherwise. */
export async function deleteFromS3(key: string): Promise<boolean> {
  if (!s3Enabled()) return false;
  try {
    const { url, headers } = signRequest("DELETE", key, EMPTY_SHA256);
    const res = await fetch(url, { method: "DELETE", headers });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/**
 * Build a presigned GET URL (query-string SigV4) valid for `expiresSec` seconds,
 * so a browser can download a backup directly from object storage without the
 * daemon proxying the bytes. Returns null when S3 is not configured.
 */
export function downloadUrl(key: string, expiresSec = 3600): string | null {
  if (!s3Enabled()) return null;
  const { protocol, host, basePath } = endpointParts();
  const canonicalUri = `${basePath}/${encodeKey(key)}`;
  const { amzDate, dateStamp } = amzDates();
  const credentialScope = `${dateStamp}/${S3.region}/${SERVICE}/aws4_request`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${S3.accessKey}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.max(1, Math.min(expiresSec, 604800))),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k]!)}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(signingKey(dateStamp), stringToSign).toString("hex");

  return `${protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Canonical object key for a backup. Keep in sync with backups.ts layout. */
export function backupKey(serverId: string, backupId: string): string {
  return `${serverId}/${backupId}.tar.gz`;
}
