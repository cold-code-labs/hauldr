# Storage

Hauldr provides object/blob storage as a **single shared, S3-compatible store**
with **one bucket per project**.

## The model

- **One shared object store** in the data plane, self-hosted, S3-compatible.
- **One bucket per project**, so a project's files are isolated from others'.
- The SDK speaks **standard S3** (presigned URLs), which keeps the backend fully
  pluggable.
- **File metadata is a table** in the project's own database, protected by
  **RLS** — so storage access control follows the exact same model as the rest of
  the data.

```
hauldr.files.upload("avatars", file)
        │
        ├─▶ object store (bucket: project)  ── stores the bytes
        └─▶ project database (metadata row, RLS-guarded)  ── who/what/when
```

The default backend is [Garage](https://garagehq.deuxfleurs.fr/) — a
lightweight, S3-compatible, self-hosted object store. Because the SDK only speaks
S3, swapping the backend (for another S3-compatible store) is a drop-in change.

## Why metadata in the project database

Rather than running a separate metadata service per project, Hauldr keeps file
metadata as an ordinary table in the project's database. That means:

- file access control is **the same RLS** as everything else,
- there is **no extra per-project service** to run for storage,
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

## Advanced storage (later)

Things like image transforms and resumable (TUS) uploads are intentionally out
of scope for the first iterations. The plan is to keep them thin in the SDK at
first and only adopt a heavier storage service if real demand appears. See the
[roadmap](roadmap.md).
