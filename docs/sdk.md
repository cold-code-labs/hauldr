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
hauldr.live   → WebSocket (shared Realtime): broadcast · presence · changes
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

Realtime over a shared, multi-tenant Realtime service (WebSocket) — broadcast,
presence, and postgres-changes. One service serves every project; each is a
Realtime tenant whose JWT secret IS the project's GoTrue secret, so the token
that signs in also authorizes a channel (postgres-changes additionally needs
`wal_level=logical` on the cluster; broadcast/presence do not):

```ts
const sub = hauldr.live.on("posts", (change) => {
  // change.type: "insert" | "update" | "delete"
  render(change)
})

sub.unsubscribe()
```

## Design intent

- **One surface, many backends.** The four namespaces map to four independent
  services, but the developer sees one client.
- **RLS is invisible but always there.** You never inject claims by hand; the SDK
  does it, and the database enforces it.
- **Typed where it counts.** `hauldr.db` is typed from your real schema; the rest
  is a thin, predictable wrapper over standard protocols (S3, SSE, JWT).
