import type {
  ChangeFilter,
  ChannelOptions,
  LiveClient,
  LiveMessage,
  PostgresChange,
  PresenceChannel,
  PresenceOptions,
  PresenceState,
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
// before letting the socket subscribe or broadcast.
//
// No WS dependency: uses the runtime's global WebSocket (browsers, and Node ≥ 18
// via undici). `broadcast` works anywhere fetch does (incl. server actions).

const HEARTBEAT_MS = 30_000;

/** One frame off the socket: Phoenix `{ event, payload, ref }`. */
type Frame = { event?: string; payload?: unknown; ref?: string };

/** Server presence shape: member key → { metas: [ { phx_ref, ...state } ] }. */
type MetaState = Record<string, Array<Record<string, unknown>>>;

function flatten(meta: MetaState): PresenceState {
  const out: PresenceState = {};
  for (const [key, metas] of Object.entries(meta)) {
    out[key] = metas.map((m) => {
      const { phx_ref: _r, phx_ref_prev: _p, ...rest } = m;
      return rest;
    });
  }
  return out;
}

function applyState(meta: MetaState, state: Record<string, { metas?: Array<Record<string, unknown>> }>) {
  for (const k of Object.keys(meta)) delete meta[k];
  for (const [key, v] of Object.entries(state)) meta[key] = [...(v.metas ?? [])];
}

function applyDiff(
  meta: MetaState,
  diff: { joins?: Record<string, { metas?: Array<Record<string, unknown>> }>; leaves?: Record<string, { metas?: Array<Record<string, unknown>> }> },
) {
  for (const [key, v] of Object.entries(diff.leaves ?? {})) {
    const gone = new Set((v.metas ?? []).map((m) => m.phx_ref));
    meta[key] = (meta[key] ?? []).filter((m) => !gone.has(m.phx_ref));
    if (!meta[key].length) delete meta[key];
  }
  for (const [key, v] of Object.entries(diff.joins ?? {})) {
    const have = new Set((meta[key] ?? []).map((m) => m.phx_ref));
    meta[key] = [...(meta[key] ?? []), ...(v.metas ?? []).filter((m) => !have.has(m.phx_ref))];
  }
}

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
    const h = this.open(topic, opts, {}, (f) => {
      if (f.event === "broadcast" && f.payload) {
        const p = f.payload as { event?: string; payload?: unknown };
        cb({ event: p.event ?? "", payload: p.payload });
      }
    });
    return { unsubscribe: h.stop };
  }

  /**
   * Subscribe to Postgres row changes (postgres-changes / CDC), delivered
   * RLS-filtered — only rows the token's user may SELECT reach the socket. Needs
   * `postgres-changes` enabled + the table in the `supabase_realtime` publication.
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
    const h = this.open(topic, opts, { postgres_changes: list }, (f) => {
      if (f.event === "postgres_changes" && f.payload) {
        const d = (f.payload as { data?: Record<string, unknown> }).data;
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
    return { unsubscribe: h.stop };
  }

  /**
   * Track presence on a channel — who is currently here. `onSync` fires with the
   * full state whenever a member joins, leaves, or updates. Call `track` to (re)
   * publish this client's own state.
   */
  presence(
    topic: string,
    onSync: (state: PresenceState) => void,
    opts: PresenceOptions = {},
  ): PresenceChannel {
    const meta: MetaState = {};
    const emit = () => onSync(flatten(meta));
    const h = this.open(topic, opts, { presence: { key: opts.key ?? "" } }, (f) => {
      if (f.event === "presence_state" && f.payload) {
        applyState(meta, f.payload as Record<string, { metas?: Array<Record<string, unknown>> }>);
        emit();
      } else if (f.event === "presence_diff" && f.payload) {
        applyDiff(meta, f.payload as Parameters<typeof applyDiff>[1]);
        emit();
      }
    });
    if (opts.initial) h.send("presence", { type: "presence", event: "track", payload: opts.initial });
    return {
      track: (state) => h.send("presence", { type: "presence", event: "track", payload: state }),
      untrack: () => h.send("presence", { type: "presence", event: "untrack" }),
      unsubscribe: h.stop,
    };
  }

  /**
   * Open a channel: join, route every frame to `onFrame`, and expose `send` for
   * channel pushes (presence). `configOverride` is merged into the join config;
   * `private` adds the RLS authorization gate. Pushes before the join is
   * acknowledged are queued and flushed on join.
   */
  private open(
    topic: string,
    opts: ChannelOptions,
    configOverride: Record<string, unknown>,
    onFrame: (frame: Frame) => void,
  ): { stop(): void; send(event: string, payload: unknown): void } {
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
    const joinRef = "1";
    let ref = 1;
    const nextRef = () => String(++ref);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let joined = false;
    const pending: string[] = [];

    const rawSend = (s: string) => {
      try {
        ws.send(s);
      } catch {
        // socket closing
      }
    };
    const send = (event: string, payload: unknown) => {
      const s = JSON.stringify({ topic: realtimeTopic, event, ref: nextRef(), payload });
      if (joined) rawSend(s);
      else pending.push(s);
    };

    ws.onopen = () => {
      rawSend(
        JSON.stringify({
          topic: realtimeTopic,
          event: "phx_join",
          ref: joinRef,
          join_ref: joinRef,
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
        rawSend(JSON.stringify({ topic: "phoenix", event: "heartbeat", ref: nextRef(), payload: {} }));
      }, HEARTBEAT_MS);
    };

    ws.onmessage = (ev: MessageEvent) => {
      let m: Frame;
      try {
        m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (!joined && m.event === "phx_reply" && m.ref === joinRef) {
        const status = (m.payload as { status?: string } | undefined)?.status;
        if (status === "ok") {
          joined = true;
          for (const s of pending.splice(0)) rawSend(s);
        }
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

    return { stop, send };
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
