function required(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    if (process.env.NODE_ENV === "production") throw new Error(`Missing env var: ${key}`);
    return `dev-${key.toLowerCase()}`;
  }
  return v;
}

const optional = (key: string) => process.env[key] ?? "";

export const env = {
  appUrl: required("APP_URL", "http://localhost:3000"),
  authSecret: required("AUTH_SECRET", "dev-auth-secret-change-me"),
  apiJwtSecret: required("API_JWT_SECRET", "dev-api-secret-change-me"),
  daemonToken: required("DAEMON_TOKEN", "dev-daemon-token-change-me"),
  defaultNodeFqdn: required("DEFAULT_NODE_FQDN", "localhost"),
  nodePublicIp: required("NODE_PUBLIC_IP", "127.0.0.1"),
  isProd: process.env.NODE_ENV === "production",

  // Free-subdomain DNS (optional). When DOMAIN_BASE + a provider are set, users
  // can claim "<sub>.<DOMAIN_BASE>" and the panel writes A + SRV records.
  domainBase: optional("DOMAIN_BASE"), // e.g. "aether.host"
  dnsProvider: optional("DNS_PROVIDER") || "none", // "cloudflare" | "none"
  cloudflareToken: optional("CLOUDFLARE_API_TOKEN"),
  cloudflareZoneId: optional("CLOUDFLARE_ZONE_ID"),

  // CurseForge (optional) — enables the CurseForge content source.
  curseforgeKey: optional("CURSEFORGE_API_KEY"),

  // Monitoring — Discord webhook URL alerts are posted to (optional).
  alertWebhook: optional("ALERT_WEBHOOK"),
};
