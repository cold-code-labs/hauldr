import type { LiveClient, LiveMessage, RealtimeConfig } from "./types";

// The realtime namespace — a thin client over the shared Realtime service.
// Subscribes ride a WebSocket (Phoenix channels, vsn 1.0.0); publishes go over
// HTTP POST /api/broadcast. The Realtime service resolves the project (tenant)
// from the URL host's first label, and authorizes the channel from the token —
// the SAME GoTrue token that signs the user in, so RLS holds on the socket too.
//
// No WS dependency: uses the runtime's global WebSocket (browsers, and Node ≥ 18
// via undici). `broadcast` works anywhere fetch does (incl. server actions).

const HEARTBEAT_MS = 30_000;

export class RealtimeClient implements LiveClient {
  private readonly httpUrl: string;
  private readonly wsUrl: string;
  private readonly accessToken?: string;

  constructor(cfg: RealtimeConfig) {
    this.httpUrl = cfg.url.replace(/\/+$/, "");
    this.wsUrl = this.httpUrl.replace(/^http/, "ws");
    this.accessToken = cfg.accessToken;
  }

  /** Subscribe to a topic. `cb` fires once per broadcast event on that topic. */
  on(topic: string, cb: (message: LiveMessage) => void): { unsubscribe(): void } {
    const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) {
      throw new Error("hauldr.live.on needs a WebSocket (browser, or Node ≥ 18)");
    }
    const apikey = encodeURIComponent(this.accessToken ?? "");
    const ws = new WS(`${this.wsUrl}/socket/websocket?vsn=1.0.0&apikey=${apikey}`);
    const realtimeTopic = `realtime:${topic}`;
    let ref = 0;
    const nextRef = () => String(++ref);
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          topic: realtimeTopic,
          event: "phx_join",
          ref: nextRef(),
          join_ref: "1",
          payload: {
            config: { broadcast: { self: true }, presence: { key: "" }, postgres_changes: [] },
            ...(this.accessToken ? { access_token: this.accessToken } : {}),
          },
        }),
      );
      heartbeat = setInterval(() => {
        try {
          ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", ref: nextRef(), payload: {} }));
        } catch {
          // socket closing — the next tick is cleared by unsubscribe/onclose
        }
      }, HEARTBEAT_MS);
    };

    ws.onmessage = (ev: MessageEvent) => {
      let m: { event?: string; payload?: { event?: string; payload?: unknown } };
      try {
        m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (m.event === "broadcast" && m.payload) {
        cb({ event: m.payload.event ?? "", payload: m.payload.payload });
      }
    };

    const stop = () => {
      if (heartbeat) clearInterval(heartbeat);
      try {
        ws.close();
      } catch {
        // already closed
      }
    };
    ws.onclose = () => {
      if (heartbeat) clearInterval(heartbeat);
    };

    return { unsubscribe: stop };
  }

  /** Publish an event to a topic. Server-side after a write, or client-to-client. */
  async broadcast(topic: string, event: string, payload: unknown): Promise<void> {
    const r = await fetch(`${this.httpUrl}/api/broadcast`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.accessToken
          ? { apikey: this.accessToken, Authorization: `Bearer ${this.accessToken}` }
          : {}),
      },
      body: JSON.stringify({ messages: [{ topic, event, payload, private: false }] }),
    });
    // Realtime returns 202 Accepted on success.
    if (!r.ok && r.status !== 202) {
      throw new Error(`hauldr.live.broadcast → ${r.status}: ${await r.text()}`);
    }
  }
}
