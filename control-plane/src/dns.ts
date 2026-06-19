import { config } from "./config";

/**
 * Pluggable DNS for per-project endpoints (auth, REST).
 *
 * The Coolify provisioner routes a project's GoTrue / PostgREST at an external
 * host (e.g. `auth-acme.example.com`, `rest-acme.example.com`). That host
 * resolves only once a DNS record points it at the edge that fronts this server
 * — for a Cloudflare tunnel, a CNAME to `<tunnel-id>.cfargotunnel.com`.
 *
 * Backends (HAULDR_DNS_PROVISIONER):
 *   - "none"       → no-op. The operator manages DNS out of band (e.g. one
 *                    wildcard record covering every auth host). The default, so
 *                    the public build needs no credentials.
 *   - "cloudflare" → upsert / remove a CNAME via the Cloudflare API. The token,
 *                    zone, and target are all configuration; nothing about any
 *                    particular domain or account is baked into the code.
 */

const CF_API = "https://api.cloudflare.com/client/v4";

type CfRecord = { id: string; name: string; content: string };
type CfResult<T> = { success: boolean; errors?: unknown; result: T };

async function cf<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${config.cloudflareDnsToken}`,
      "Content-Type": "application/json",
      "User-Agent": "hauldr-control-plane",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as CfResult<T>;
  if (!res.ok || json.success === false) {
    throw new Error(
      `Cloudflare ${path} → ${res.status}: ${JSON.stringify(json.errors ?? json)}`,
    );
  }
  return json.result;
}

function requireCloudflareConfig(): void {
  if (!config.cloudflareDnsToken || !config.cloudflareZoneId || !config.dnsTarget) {
    throw new Error(
      "DNS provisioner 'cloudflare' needs CLOUDFLARE_DNS_TOKEN, CLOUDFLARE_ZONE_ID and HAULDR_DNS_TARGET",
    );
  }
}

async function findRecord(host: string): Promise<CfRecord | null> {
  const recs = await cf<CfRecord[]>(
    `/zones/${config.cloudflareZoneId}/dns_records?type=CNAME&name=${encodeURIComponent(host)}`,
  );
  return recs[0] ?? null;
}

/**
 * Point an endpoint host at the edge. Idempotent: creates the CNAME, or corrects
 * its target if it drifted, or does nothing if it already matches.
 */
export async function ensureHostDns(host: string): Promise<void> {
  if (config.dnsProvisioner !== "cloudflare") return;
  requireCloudflareConfig();
  const body = {
    type: "CNAME",
    name: host,
    content: config.dnsTarget,
    proxied: config.dnsProxied,
    ttl: 1, // 1 = "automatic"
  };
  const existing = await findRecord(host);
  if (!existing) {
    await cf(`/zones/${config.cloudflareZoneId}/dns_records`, { method: "POST", body });
  } else if (existing.content !== config.dnsTarget) {
    await cf(`/zones/${config.cloudflareZoneId}/dns_records/${existing.id}`, {
      method: "PUT",
      body,
    });
  }
}

/**
 * Remove an endpoint host's DNS record. Idempotent, and conservative: it only
 * deletes a record that points at our configured target, so a hand-managed or
 * unrelated record at the same name is never touched.
 */
export async function destroyHostDns(host: string): Promise<void> {
  if (config.dnsProvisioner !== "cloudflare") return;
  if (!config.cloudflareDnsToken || !config.cloudflareZoneId) return;
  const existing = await findRecord(host);
  if (!existing || existing.content !== config.dnsTarget) return;
  await cf(`/zones/${config.cloudflareZoneId}/dns_records/${existing.id}`, {
    method: "DELETE",
  });
}
