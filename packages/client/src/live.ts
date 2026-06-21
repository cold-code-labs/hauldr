import type {
  ChangeFilter,
  ChannelOptions,
  LiveClient,
  LiveMessage,
  PostgresChange,
  RealtimeConfig,
  Subscription,
} from "./types";

// The realtime namespace — a thin client over the shared Realtime service.
// Subscribes ride a WebSocket (Phoenix channels, vsn 1.0.0); publishes go over
// HTTP POST /api/broadcast. The Realtime service resolves the project (tenant)
// from the URL host's first label, and authorizes the channel from the token —
// the SAME GoTrue token that signs the user in, so RLS holds on the socket too.
//
// Channels are public by default. Pass `{ private: true }` and Realtime runs the
// project's RLS policies on `realtime.messages` (role + claims from the token)
// before letting the socket subscribe or broadcast — so a private channel is
// only reachable by users the policies allow.
//
// No WS dependency: uses the runtime's global WebSocket (browsers, and Node ≥ 18
// via undici). `broadcast` works anywhere fetch does (incl. server actions).

const HEARTBEAT_MS = 30_000;

/** One frame off the socket: Phoenix `{ event, payload }`. */
type Frame = { event?: string; payload?: unknown };

export class RealtimeClient implements LiveClient {
  private readonly httpUrl: string;
  private readonly wsUrl: string;
  private readonly accessToken?: string;

  constructor(cfg: RealtimeConfig) {
    this.httpUrl = cfg.url.replace(/\/+$/, "");
    this.wsUrl = this.httpUrl.replace(/^http/, "ws");
    this.accessToken = cfg.accessToken;
  }

  /** Subscribe to broadcast events on a topic. `cb` fires once per event. */
  on(topic: string, cb: (message: LiveMessage) => void, opts: ChannelOptions = {}): Subscription {
    return this.subscribe(topic, opts, {}, (frame) => {
      if (frame.event === "broadcast" && frame.payload) {
        const p = frame.payload as { event?: string; payload?: unknown };
        cb({ event: p.event ?? "", payload: p.payload });
      }
    });
  }

  /**
   * Subscribe to Postgres row changes (postgres-changes / CDC). Each change is
   * delivered RLS-filtered — only rows the token's user may SELECT reach the
   * socket. Needs `postgres-changes` enabled on the tenant + the table in the
   * `supabase_realtime` publication.
   */
  onChanges(
    topic: string,
    filters: ChangeFilter | ChangeFilter[],
    cb: (change: PostgresChange) => void,
    opts: ChannelOptions = {},
  ): Subscription {
    const list = (Array.isArray(filters) ? filters : [filters]).map((f) => ({
      event: f.event ?? "*",
      schema: f.schema ?? "public",
      ...(f.table ? { table: f.table } : {}),
      ...(f.filter ? { filter: f.filter } : {}),
    }));
    return this.subscribe(topic, opts, { postgres_changes: list }, (frame) => {
      if (frame.event === "postgres_changes" && frame.payload) {
        const d = (frame.payload as { data?: Record<string, unknown> }).data;
        if (!d) return;
        const rec = d.record as Record<string, unknown> | undefined;
        const old = d.old_record as Record<string, unknown> | undefined;
        cb({
          type: d.type as PostgresChange["type"],
          schema: String(d.schema ?? ""),
          table: String(d.table ?? ""),
          record: rec && Object.keys(rec).length ? rec : undefined,
          old: old && Object.keys(old).length ? old : undefined,
          commitTimestamp: d.commit_timestamp as string | undefined,
        });
      }
    });
  }

  /**
   * Open a channel and route every frame to `onFrame`. `configOverride` is merged
   * into the join config (e.g. `{ postgres_changes: [...] }`); `private` adds the
   * RLS authorization gate.
   */
  private subscribe(
    topic: string,
    opts: ChannelOptions,
    configOverride: Record<string, unknown>,
    onFrame: (frame: Frame) => void,
  ): Subscription {
    const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) {
      throw new Error("hauldr.live needs a WebSocket (browser, or Node ≥ 18)");
    }
    if (opts.private && !this.accessToken) {
      throw new Error(
        "hauldr.live: a private channel needs an access token — createClient({ realtime: { url, accessToken } })",
      );
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
            config: {
              broadcast: { self: true },
              presence: { key: "" },
              postgres_changes: [],
              private: !!opts.private,
              ...configOverride,
            },
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
      let m: Frame;
      try {
        m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      onFrame(m);
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
  async broadcast(
    topic: string,
    event: string,
    payload: unknown,
    opts: ChannelOptions = {},
  ): Promise<void> {
    if (opts.private && !this.accessToken) {
      throw new Error(
        "hauldr.live: a private broadcast needs an access token — createClient({ realtime: { url, accessToken } })",
      );
    }
    const r = await fetch(`${this.httpUrl}/api/broadcast`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.accessToken
          ? { apikey: this.accessToken, Authorization: `Bearer ${this.accessToken}` }
          : {}),
      },
      body: JSON.stringify({ messages: [{ topic, event, payload, private: !!opts.private }] }),
    });
    // Realtime returns 202 Accepted on success.
    if (!r.ok && r.status !== 202) {
      throw new Error(`hauldr.live.broadcast → ${r.status}: ${await r.text()}`);
    }
  }
}
