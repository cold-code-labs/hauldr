import { createHmac } from "node:crypto";
import type { FleetJob } from "./types";
import { config } from "../config";

/**
 * The payload an app enqueues for a durable callback. The app does NOT compute
 * the signature — the worker signs `body` at delivery time with the shared
 * secret, so a queued row never carries a credential.
 */
export type AppCallbackData = {
  /** Absolute URL of the app's internal endpoint. Host must be allowlisted. */
  url: string;
  /** JSON body POSTed to the endpoint. Signed with SKULD_HMAC_SECRET. */
  body?: unknown;
};

/**
 * app-callback — Skuld's generic durable webhook. An app enqueues `{ url, body }`
 * (via the control plane) and the worker POSTs `body` to `url`, signing it so
 * the app can trust the call really came from Skuld. A non-2xx response throws,
 * which hands retry/backoff to pg-boss.
 *
 * This is the seam that keeps app logic in the app: the *motor* (durability,
 * retry, scheduling) lives here; the *work* lives behind the app's endpoint.
 * The worker never imports app code.
 */
export const appCallback: FleetJob = {
  name: "app-callback",
  run: async (data) => {
    const { url, body } = (data ?? {}) as AppCallbackData;
    if (!url) throw new Error("app-callback: missing url");
    if (!config.callback.hmacSecret) {
      throw new Error("app-callback: SKULD_HMAC_SECRET not configured");
    }
    // Refuse any host not on the allowlist — an enqueue must not become an SSRF
    // primitive that POSTs signed requests to arbitrary destinations.
    const host = new URL(url).host;
    if (!config.callback.allowlist.includes(host)) {
      throw new Error(`app-callback: host not allowed: ${host}`);
    }

    const raw = JSON.stringify(body ?? {});
    const sig = createHmac("sha256", config.callback.hmacSecret)
      .update(raw)
      .digest("hex");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-skuld-signature": `sha256=${sig}`,
      },
      body: raw,
    });
    if (!res.ok) {
      throw new Error(`app-callback ${host} → ${res.status}`);
    }
  },
};
