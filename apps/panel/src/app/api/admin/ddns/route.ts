import { requireAdmin } from "@/lib/auth";
import { json, route } from "@/lib/http";
import {
  duckDnsConfigured,
  duckDnsHostname,
  lastDuckDnsIp,
  lastDuckDnsUpdateAt,
  publicIp,
  updateDuckDnsFromEnv,
} from "@/lib/ddns";

export const dynamic = "force-dynamic";

/** Current DuckDNS state for the admin card. */
export const GET = route(async () => {
  await requireAdmin();
  const configured = duckDnsConfigured();
  return json({
    configured,
    hostname: duckDnsHostname(),
    lastIp: lastDuckDnsIp(),
    lastUpdateAt: lastDuckDnsUpdateAt(),
    // live public IP so the admin can see whether the record is current
    currentIp: configured ? await publicIp() : null,
  });
});

/** Force an immediate DuckDNS update. */
export const POST = route(async () => {
  await requireAdmin();
  if (!duckDnsConfigured()) {
    return json({ ok: false, error: "DuckDNS is not configured" }, 400);
  }
  const ip = (await publicIp()) ?? undefined;
  const ok = await updateDuckDnsFromEnv(ip);
  return json({
    ok,
    hostname: duckDnsHostname(),
    lastIp: lastDuckDnsIp(),
    lastUpdateAt: lastDuckDnsUpdateAt(),
    currentIp: ip ?? null,
  });
});
