<div align="center">

<img src="assets/hauldr.svg" alt="Hauldr" width="140" height="140" />

# Hauldr

**A multi-tenant, self-hostable Backend-as-a-Service on real Postgres.**

The developer experience of a managed platform, the lightweight footprint of an
embedded database, and true multi-tenancy — on infrastructure you own.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange.svg)](#status)
[![Built on Postgres](https://img.shields.io/badge/built%20on-Postgres-336791.svg)](https://www.postgresql.org/)

</div>

---

> In Old Norse law, a **hauldr** was a freeholder — someone who held their land
> outright, by inherited right, answering to no lord. Hauldr is a backend you
> hold the same way: your data, your Postgres, your box. No landlord.

## What is Hauldr?

Hauldr is an open-source backend platform you run yourself. It gives a small
team the same building blocks a managed BaaS would — authentication, a real SQL
database with row-level security, file storage, realtime, and a typed client SDK
— but each tenant project is isolated, lightweight, and provisioned in seconds,
all on top of **standard, battle-tested open-source components**.

It is designed for the shape of work where you run **many small applications**
(one per client, per product, per internal tool) and want each one to have a
proper database with real auth and access control — without paying the per-app
overhead of a heavyweight stack or the per-seat bill of a hosted vendor.

Three moving parts:

1. **Control plane** — a self-hosted panel (Supabase-like UX) plus a management
   API for creating and operating projects.
2. **Shared data plane** — a Postgres cluster fronted by a multi-tenant
   connection pooler, with **one database per project**.
3. **Per-project satellites** — only the services a given project asks for
   (auth always; a REST API layer à-la-carte).

## Why it exists

The two ends of the spectrum each have a cost:

- **Heavyweight managed stacks** are excellent but assume one big tenant. Running
  dozens of small isolated apps means dozens of full deployments, or giving up
  isolation.
- **Embedded single-file databases** are wonderfully light, but you eventually
  hit real ceilings: concurrent writers, true SQL, row-level security, point-in-
  time recovery, connection scaling.

Hauldr sits in the middle deliberately: **heavy things are shared** (one Postgres
cluster, one pooler, one object store, multi-tenant), **light things are per-
project and optional**. A project is just a database, an auth service, and a JWT
secret — measured in tens of megabytes, not gigabytes.

## Principles

1. **Shared is heavy, per-project is light and optional.** Multi-tenancy lives
   in the shared plane; each project only carries what it actually needs.
2. **One auth model, always.** Every project ships with its own
   [GoTrue](https://github.com/supabase/auth) instance and its own JWT secret.
   Row-level security is **always on** — access control is enforced by the
   database, reading the claims from the auth token.
3. **Real Postgres underneath.** No reimplemented query engine. Extensions
   (pgvector, etc.) are enabled per-database, on demand.
4. **Scale honestly.** A multi-tenant pooler keeps connections under control;
   **tiering** lets a project that outgrows the shared cluster move to a
   dedicated one without changing application code.
5. **Assemble upstream, don't reinvent.** Hauldr builds the panel, the
   provisioner, the SDK, and the conventions. It never rewrites the database,
   the pooler, or the auth server — those are proven projects, used as-is.

## Architecture at a glance

```
   CONTROL PLANE                         DATA PLANE  (shared)
 ┌─────────────────────┐           ┌──────────────────────────────────────┐
 │ Hauldr Panel        │           │  Connection pooler (multi-tenant)     │
 │  (SQL / tables /    │ ── API ──▶│   routes project → database           │
 │   auth / RLS /      │           │         │                             │
 │   keys / logs /     │◀── meta ──│  Postgres  (1+ cluster, 1 DB/project) │
 │   backups)          │           │   ├ db_acme   ├ db_shop   ├ …         │
 │                     │           └──────────────────────────────────────┘
 │ Hauldr API (mgmt)   │              ▲ per-project, à-la-carte
 └──────────┬──────────┘              │  ┌ Auth (GoTrue)   [always]
            │ called by               │  └ REST (PostgREST) [optional]
   your provisioning automation       │     realtime = shared WS · storage = S3
```

Full detail in [docs/architecture.md](docs/architecture.md).

## The SDK — `@hauldr/client`

The SDK is the layer that makes a decomposed backend feel like one thing. It
hides the pooler, the auth server, and the object store behind a small surface:

```ts
import { createClient } from "@hauldr/client"

const hauldr = createClient({ url: HAULDR_URL, anonKey: ANON_KEY })

// Auth — full lifecycle (signup, OAuth, magic-link, MFA, reset)
await hauldr.auth.signInWithPassword({ email, password })

// Data — typed queries; the RLS claim is injected for you
const posts = await hauldr.db.query.posts.findMany({ where: { published: true } })

// Files — S3-style upload + signed URLs
const { url } = await hauldr.files.upload("avatars", file)

// Realtime — WebSocket via a shared, multi-tenant Realtime service
hauldr.live.on("posts", (change) => render(change))
```

| Namespace     | Backed by                                       |
| ------------- | ----------------------------------------------- |
| `hauldr.auth` | GoTrue (lifecycle / OAuth / magic-link / MFA)   |
| `hauldr.db`   | Typed queries through the pooler (RLS-aware)     |
| `hauldr.files`| Object storage over standard S3                  |
| `hauldr.live` | Shared Realtime over WebSocket (broadcast · presence · changes) |

See [docs/sdk.md](docs/sdk.md).

## Documentation

| Doc | What's inside |
| --- | --- |
| [Architecture](docs/architecture.md) | The full system: control plane, data plane, satellites |
| [Concepts](docs/concepts.md) | Glossary and the model behind projects, tenancy, tiering |
| [Auth & data](docs/auth-and-data.md) | GoTrue, RLS, server actions vs. REST, claim injection |
| [Data plane](docs/data-plane.md) | Postgres, the pooler, migrations, backups, tiering |
| [Storage](docs/storage.md) | S3-compatible object storage, buckets, durability |
| [SDK](docs/sdk.md) | `@hauldr/client` surface and usage |
| [Self-hosting](docs/self-hosting.md) | Bootstrap, "project zero", running the stack |
| [Roadmap](docs/roadmap.md) | Phased delivery plan |

## Status

Hauldr is **pre-alpha** and developed in the open. The foundational
architectural decisions are settled. The control plane provisions projects
end-to-end — auth always, REST / storage / realtime à-la-carte — over a
multi-tenant pooler, and it already runs a real fleet of applications. What's
left is operational polish (backups / PITR, tiering, per-project metrics) and a
one-click migration path. Expect breaking changes until a tagged release.

See the [roadmap](docs/roadmap.md) for what's coming and in what order.

## Built on the shoulders of

Hauldr is an assembly of excellent open-source projects:

- [PostgreSQL](https://www.postgresql.org/) — the database
- [Supavisor](https://github.com/supabase/supavisor) — multi-tenant connection pooler
- [GoTrue](https://github.com/supabase/auth) — authentication
- [PostgREST](https://postgrest.org/) — optional REST API layer
- [Garage](https://garagehq.deuxfleurs.fr/) — S3-compatible object storage
- [Drizzle](https://orm.drizzle.team/) — the typed data layer in the SDK

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please also
read the [Code of Conduct](CODE_OF_CONDUCT.md) and our
[security policy](SECURITY.md).

## License

[Apache License 2.0](LICENSE).
