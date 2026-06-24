# Storage

Hauldr provides object/blob storage as a **single shared, S3-compatible store**
with **one bucket per project**.

## The model

- A **per-project storage gateway** — `storage-api`, the same service Supabase
  runs — exposed at `<project-host>/storage/v1` (alongside `/auth` and `/rest`).
  It's **Supabase-compatible**, so `supabase-js`'s `.storage` client works
  unchanged; see [supabase-compat](supabase-compat.md).
- Requests authenticate with the **project's GoTrue JWT** — the same token used
  for auth and data. Storage access control rides the **same identity** as the
  rest of the data.
- **File metadata is a table** (the `storage` schema) in the project's own
  database, protected by **RLS** — so who-may-touch-what is just SQL + RLS.
- **One bucket per project** keeps a project's files isolated; the gateway proxies
  to an S3-compatible object store that stays **internal-only**, so the app holds
  zero S3 credentials.
- The gateway is provisioned **per project and per environment** — each
  prod/dev project gets its own `storage-api` against its own database. Provision
  them **symmetrically**: code that talks to the gateway will 404 in an
  environment where it was never provisioned.

```
client.storage.from("avatars").upload(path, file)
        │  (project GoTrue JWT)
        ▼
  storage-api gateway  ──▶ object store (bucket: project)   ── stores the bytes
   <host>/storage/v1   ──▶ project database (storage schema, RLS)  ── who/what/when
```

The default object backend is [Garage](https://garagehq.deuxfleurs.fr/) — a
lightweight, S3-compatible, self-hosted store; swapping it for another
S3-compatible store is a configuration change.

## Why metadata in the project database

The storage gateway keeps file metadata as an ordinary table set (the `storage`
schema) in the **project's own database**, rather than in a separate central
metadata service. That means:

- file access control is **the same RLS** as everything else,
- a project's file metadata lives and migrates **with that project's database**,
- listing and querying files is just SQL.

The object store holds bytes; the database holds the truth about who may touch
them.

## Durability is the operator's job

This is the honest cost of self-hosting object storage: **durability is yours to
provide.** A managed cloud object store hands you many-nines durability for free;
a self-hosted store does not.

Recommended patterns, in rough order of effort:

1. **Multi-node replication.** When you run more than one node, the object store
   replicates objects across nodes natively.
2. **Off-site cold backup.** Asynchronously copy each bucket to a cheap, separate
   destination (another region, another provider) as a disaster-recovery copy.
3. **Volume snapshots.** Snapshot the underlying storage volumes on a schedule.

Pick at least one before putting anything you can't lose into storage. For most
deployments, off-site cold backup plus snapshots is a reasonable baseline; add
replication once there's a second node.

## Advanced storage

Because the gateway is `storage-api`, resumable (TUS) and S3-protocol uploads come
with it. **Image transformations are intentionally disabled** for now (no imgproxy
sidecar) to keep the footprint small; they can be enabled later if real demand
appears. See the [roadmap](roadmap.md).
