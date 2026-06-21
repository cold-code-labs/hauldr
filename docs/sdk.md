# SDK — `@hauldr/client`

`@hauldr/client` is the layer that makes a decomposed backend feel like a single
product. It hides the pooler, the auth server, and the object store behind one
small, coherent surface, so application developers never wire those up by hand.

> The SDK is in design. The surface below is the intended shape; expect changes
> until a tagged release.

## Creating a client

```ts
import { createClient } from "@hauldr/client"

const hauldr = createClient({
  url: process.env.HAULDR_URL!,        // the project's endpoint
  anonKey: process.env.HAULDR_ANON_KEY!, // public, RLS-guarded key
})
```

Two keys exist per project:

- **anon key** — public, safe to ship to the browser; every request is still
  subject to RLS.
- **service key** — server-only, for trusted backend code; use with care.

## The four namespaces

```
hauldr.auth   → GoTrue (lifecycle / OAuth / magic-link / MFA)
hauldr.db     → typed queries through the pooler (injects the RLS claim)
hauldr.files  → upload / signed URL over standard S3
hauldr.live   → WebSocket (shared Realtime): broadcast · private channels · changes
```

### `hauldr.auth`

The full GoTrue lifecycle:

```ts
await hauldr.auth.signUp({ email, password })
await hauldr.auth.signInWithPassword({ email, password })
await hauldr.auth.signInWithOAuth({ provider: "github" })
await hauldr.auth.signInWithOtp({ email })          // magic link
await hauldr.auth.resetPasswordForEmail(email)

const { user } = await hauldr.auth.getUser()
await hauldr.auth.signOut()
```

### `hauldr.db`

Typed queries through the pooler. The SDK injects the auth claim per transaction,
so RLS applies automatically — you never set it yourself.

```ts
// read
const posts = await hauldr.db.query.posts.findMany({
  where: { published: true },
  orderBy: { createdAt: "desc" },
})

// write
await hauldr.db.insert("posts", { title, body, published: false })
```

The typed schema comes from Drizzle, generated from the project's SQL migrations.

### `hauldr.files`

S3-style object storage, scoped to the project's bucket:

```ts
const { path } = await hauldr.files.upload("avatars", file)
const { url } = await hauldr.files.getSignedUrl("avatars", path, { expiresIn: 3600 })
await hauldr.files.remove("avatars", path)
```

File metadata lives in the project's database under RLS, so listing and access
checks are the same model as the rest of your data.

### `hauldr.live`

Realtime over a shared, multi-tenant Realtime service (WebSocket) — broadcast and
postgres-changes. One service serves every project; each is a Realtime tenant
whose JWT secret IS the project's GoTrue secret, so the token that signs a user in
also authorizes the channel.

**Broadcast** — fan a named event out to every subscriber on a topic (the
app-driven model: a server action publishes right after a write):

```ts
const sub = hauldr.live.on("room:42", (msg) => {
  // msg.event, msg.payload
  render(msg)
})

await hauldr.live.broadcast("room:42", "message", { text: "hi" })
sub.unsubscribe()
```

**Private channels** — pass `{ private: true }` and Realtime authorizes the socket
against the project's RLS policies on `realtime.messages` (role + claims from the
token), so only users the policies allow can subscribe or broadcast. The default
policy admits any authenticated user; scope it per topic in SQL. Requires an
`accessToken` in the realtime config:

```ts
hauldr.live.on("room:42", render, { private: true })
await hauldr.live.broadcast("room:42", "message", { text: "hi" }, { private: true })
```

**Presence** — track who is on a channel right now. `onSync` fires with the full
state (member key → the state each published) on every join, leave, or update:

```ts
const here = hauldr.live.presence(
  "room:42",
  (state) => render(Object.keys(state)), // who's online
  { key: user.id, initial: { name: user.name } },
)

here.track({ name: user.name, typing: true }) // update own state
here.unsubscribe()                              // leave
```

**postgres-changes** — stream row changes straight from the database, delivered
RLS-filtered (only rows the user may SELECT reach the socket). Needs
`wal_level=logical` + wal2json on the cluster and the table in the
`supabase_realtime` publication:

```ts
const sub = hauldr.live.onChanges(
  "posts-feed",
  { schema: "public", table: "posts", event: "*" },
  (change) => {
    // change.type: "INSERT" | "UPDATE" | "DELETE"; change.record / change.old
    render(change)
  },
)

sub.unsubscribe()
```

## Design intent

- **One surface, many backends.** The four namespaces map to four independent
  services, but the developer sees one client.
- **RLS is invisible but always there.** You never inject claims by hand; the SDK
  does it, and the database enforces it.
- **Typed where it counts.** `hauldr.db` is typed from your real schema; the rest
  is a thin, predictable wrapper over standard protocols (S3, SSE, JWT).
