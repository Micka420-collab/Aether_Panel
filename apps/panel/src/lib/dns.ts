import "server-only";
import { env } from "./env";

/**
 * Free-subdomain DNS. When configured, claiming a subdomain writes an A record
 * (<sub>.<base> → node IP) and a Minecraft SRV record so players can connect
 * with just the hostname even though the server runs on a non-default port.
 */

export function isDnsConfigured(): boolean {
  return (
    env.dnsProvider === "cloudflare" &&
    !!env.domainBase &&
    !!env.cloudflareToken &&
    !!env.cloudflareZoneId
  );
}

export function domainBase(): string {
  return env.domainBase;
}

const RESERVED = new Set([
  "www", "api", "panel", "admin", "node", "mail", "smtp", "ns", "ns1", "ns2",
  "dns", "cdn", "status", "docs", "app", "dashboard", "wake", "link", "auth",
  "billing", "support", "staff", "mc", "play",
]);

/** Validate a requested subdomain label. Returns an error string or null. */
export function validateSubdomain(sub: string): string | null {
  const s = sub.toLowerCase().trim();
  if (s.length < 3 || s.length > 32) return "Must be 3–32 characters";
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)) return "Use lowercase letters, numbers and hyphens";
  if (s.includes("--")) return "No double hyphens";
  if (RESERVED.has(s)) return "That name is reserved";
  return null;
}

export function fqdnFor(sub: string): string {
  return `${sub.toLowerCase()}.${env.domainBase}`;
}

// ── Cloudflare driver ──────────────────────────────────────────────────────
const CF = "https://api.cloudflare.com/client/v4";

async function cf(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${CF}/zones/${env.cloudflareZoneId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.cloudflareToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    const msg = data?.errors?.[0]?.message ?? `Cloudflare error ${res.status}`;
    throw new Error(msg);
  }
  return data.result;
}

async function deleteByName(name: string, type: string) {
  const records: any[] = await cf(`/dns_records?type=${type}&name=${encodeURIComponent(name)}`);
  for (const r of records) await cf(`/dns_records/${r.id}`, { method: "DELETE" });
}

/** Create/replace the A + SRV records for a server subdomain. */
export async function claimSubdomain(sub: string, ip: string, port: number): Promise<void> {
  if (!isDnsConfigured()) throw new Error("DNS is not configured on this platform");
  const fqdn = fqdnFor(sub);
  const srvName = `_minecraft._tcp.${fqdn}`;

  // idempotent: clear any existing records first
  await deleteByName(fqdn, "A");
  await deleteByName(srvName, "SRV");

  await cf(`/dns_records`, {
    method: "POST",
    body: JSON.stringify({ type: "A", name: fqdn, content: ip, ttl: 120, proxied: false }),
  });
  await cf(`/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: "SRV",
      ttl: 120,
      data: { service: "_minecraft", proto: "_tcp", name: fqdn, priority: 1, weight: 1, port, target: fqdn },
    }),
  });
}

export async function releaseSubdomain(sub: string): Promise<void> {
  if (!isDnsConfigured()) return;
  const fqdn = fqdnFor(sub);
  await deleteByName(fqdn, "A").catch(() => {});
  await deleteByName(`_minecraft._tcp.${fqdn}`, "SRV").catch(() => {});
}
