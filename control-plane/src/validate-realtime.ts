/**
 * Realtime end-to-end test — private channels (RLS) + broadcast.
 *
 * Drives `@hauldr/client`'s `live` namespace against the LIVE shared Realtime
 * service, over the public WSS/HTTPS edge, exactly as a browser app would. Proves:
 *   1. public broadcast round-trips (regression),
 *   2. a PRIVATE channel delivers to an authenticated subscriber,
 *   3. RLS on realtime.messages DENIES an unauthorized (anon-role) subscriber.
 *
 * The project's JWT secret signs the tokens here exactly as its GoTrue would, so
 * "authenticated" / "anon" are real role claims Realtime authorizes against.
 *
 * Run (against tpldev):
 *   REALTIME_URL=https://realtime-tpldev.coldcodelabs.com \
 *   REALTIME_JWT_SECRET=<project jwt secret> \
 *   pnpm validate:realtime
 */
import crypto from "node:crypto";
import { createClient } from "../../packages/client/src/index";

const URL = process.env.REALTIME_URL ?? "https://realtime-tpldev.coldcodelabs.com";
const SECRET = process.env.REALTIME_JWT_SECRET ?? "";
if (!SECRET) {
  console.error("set REALTIME_JWT_SECRET (the project's JWT secret)");
  process.exit(2);
}

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** Mint a JWT the project's GoTrue would issue (HS256, role + subject, ttl secs). */
function mint(role: "authenticated" | "anon", sub: string, ttl = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, sub, exp: now + ttl, iat: now })}`;
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Subscribe, wait for the first matching broadcast event (or time out). */
function waitForEvent(
  client: ReturnType<typeof createClient>,
  topic: string,
  event: string,
  opts: { private?: boolean },
  timeoutMs: number,
): { received: Promise<boolean>; close: () => void } {
  let done!: (v: boolean) => void;
  const received = new Promise<boolean>((res) => (done = res));
  const sub = client.live.on(
    topic,
    (m) => {
      if (m.event === event) done(true);
    },
    opts,
  );
  const timer = setTimeout(() => done(false), timeoutMs);
  return {
    received: received.then((v) => {
      clearTimeout(timer);
      return v;
    }),
    close: () => sub.unsubscribe(),
  };
}

async function main() {
  const aliceId = "11111111-1111-1111-1111-111111111111";
  const aliceToken = mint("authenticated", aliceId);
  const anonToken = mint("anon", "00000000-0000-0000-0000-000000000000");

  const stamp = Date.now();
  const evt = `ping-${stamp}`;

  // The authenticated app client (token = a real GoTrue-style access token).
  const app = createClient({ url: "https://unused.invalid", realtime: { url: URL, accessToken: aliceToken } });
  // A second client carrying only an anon-role token — used to prove RLS denial.
  const anonApp = createClient({ url: "https://unused.invalid", realtime: { url: URL, accessToken: anonToken } });

  // ---- 1. Public broadcast still round-trips (regression) -------------------
  {
    const topic = `public-${stamp}`;
    const watch = waitForEvent(app, topic, evt, {}, 6000);
    await sleep(1500); // let the socket join
    await app.live.broadcast(topic, evt, { hi: "public" });
    assert(await watch.received, "public channel: broadcast is delivered");
    watch.close();
  }

  // ---- 2. Private channel delivers to an authenticated subscriber -----------
  {
    const topic = `room-${stamp}`;
    const watch = waitForEvent(app, topic, evt, { private: true }, 6000);
    await sleep(1500);
    await app.live.broadcast(topic, evt, { hi: "private" }, { private: true });
    assert(await watch.received, "private channel: authenticated user receives the broadcast (RLS allows)");
    watch.close();
  }

  // ---- 3. RLS denies an unauthorized (anon-role) subscriber -----------------
  {
    const topic = `room-secret-${stamp}`;
    const watch = waitForEvent(anonApp, topic, evt, { private: true }, 5000);
    await sleep(1500);
    // Authorized author broadcasts; the anon subscriber must NOT receive it,
    // because its private subscribe is denied by RLS (policy is to authenticated).
    await app.live.broadcast(topic, evt, { hi: "secret" }, { private: true });
    const got = await watch.received;
    assert(!got, "private channel: anon-role subscriber is DENIED (RLS gate holds)");
    watch.close();
  }

  // ---- 4. Presence: two members see each other on the channel ---------------
  {
    const topic = `presence-${stamp}`;
    let aliceSaw: string[] = [];
    const second = createClient({ url: "https://unused.invalid", realtime: { url: URL, accessToken: aliceToken } });
    const pa = app.live.presence(topic, (s) => (aliceSaw = Object.keys(s)), { key: "alice", initial: { name: "alice" } });
    const pb = second.live.presence(topic, () => {}, { key: "bob", initial: { name: "bob" } });
    await sleep(3000); // join + track + state sync
    assert(
      aliceSaw.includes("alice") && aliceSaw.includes("bob"),
      `presence: alice sees both members on the channel (saw: ${aliceSaw.join(",")})`,
    );
    pa.unsubscribe();
    pb.unsubscribe();
  }

  // ---- 5. Token refresh keeps a long-lived private channel authorized -------
  {
    const topic = `refresh-${stamp}`;
    let refreshes = 0;
    // Subscriber boots with a token that expires in 25s; getToken hands back a
    // fresh one, which the client pushes to the channel before expiry.
    const refreshing = createClient({
      url: "https://unused.invalid",
      realtime: {
        url: URL,
        accessToken: mint("authenticated", aliceId, 25),
        getToken: () => {
          refreshes++;
          return mint("authenticated", aliceId, 3600);
        },
      },
    });
    let got = false;
    const sub = refreshing.live.on(topic, (m) => { if (m.event === "rfx") got = true; }, { private: true });
    await sleep(32000); // past the 25s expiry — the refresh fired ~5s in
    await app.live.broadcast(topic, "rfx", { x: 1 }, { private: true });
    await sleep(2500);
    assert(refreshes >= 1, `token refresh: getToken was called to renew the token (${refreshes}x)`);
    assert(got, "token refresh: private channel still delivers after the original token expired");
    sub.unsubscribe();
  }

  await sleep(300);
  console.log(
    failures === 0 ? "\nALL REALTIME ASSERTIONS PASSED ✓" : `\n${failures} ASSERTION(S) FAILED ✗`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", (e as Error).message);
  process.exit(1);
});
