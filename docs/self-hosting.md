# Self-hosting

Hauldr is built to run on infrastructure you own. This document covers how the
stack comes up, the "project zero" bootstrap, and what an operator is
responsible for.

> Implementation is in progress. This describes the intended deployment shape;
> exact commands and a reference `compose` file will land with the first
> milestone (see the [roadmap](roadmap.md)).

## What runs

The shared stack:

- **Postgres** — the database cluster (as a container).
- **Connection pooler** — multi-tenant, in front of Postgres.
- **Object store** — S3-compatible, shared, one bucket per project.

Per project, attached on demand:

- **Auth (GoTrue)** — always.
- **REST layer (PostgREST)** — optional.

The **panel** and the **management API** make up the control plane and run as
ordinary services.

Because Postgres and the object store run inside the stack, the whole thing comes
up on any Docker host. A single reverse proxy in front routes the panel and the
per-project endpoints.

## The bootstrap problem

The panel runs *as a Hauldr project* (it dogfoods the platform — same Postgres,
same auth, same SDK). That is great for confidence and as a reference
implementation, but it creates a chicken-and-egg: the panel needs a project to
exist before it can run, but projects are created *through the panel*.

## Project zero

The answer is **project zero** — the panel's own project, created by the
**installer at bootstrap**, not through the UI.

```
INSTALLER (bootstrap)
   │
   ├─▶ bring up Postgres + pooler + object store
   ├─▶ create "project zero": its database + an ADMIN auth service + JWT secret
   └─▶ start the panel, authenticated against project zero
                                    │
                                    ▼
                       operators sign in and create
                       tenant projects normally
```

Key points:

- **The platform's own auth is just project zero.** There is no special
  "platform" identity system — the panel authenticates against an ordinary
  GoTrue, the one that belongs to project zero. It is isolated from tenant
  projects by construction (its own database and JWT secret).
- **The management API authenticates two ways:**
  - an **admin JWT** (issued by project zero's auth) for the panel, and
  - **service tokens** for machine callers (e.g. an external provisioning system).

After bootstrap, everything else is created through the normal `createProject`
flow.

## Creating a project

Once the stack is up, a project is created via the management API (the panel is
just one caller of it):

```
createProject("acme")
   │
   ├─ CREATE DATABASE db_acme + a role
   ├─ register the route in the pooler
   ├─ run the project's migrations
   ├─ bring up the project's auth (GoTrue) + generate its JWT secret
   ├─ publish its auth endpoint (auth-acme.<domain>) at the edge
   └─ create a bucket for the project
   →  returns a connection string + keys
```

The same call is what an external provisioning system invokes to give a brand-new
application its backend.

## Operator responsibilities

Self-hosting means a few things are yours to own:

- **Backups.** Configure cluster-level WAL archiving (point-in-time recovery) and
  per-database dumps (granular restore). See [data-plane.md](data-plane.md).
- **Storage durability.** Self-hosted object storage does not give you many-nines
  durability for free — set up replication and/or off-site cold backup. See
  [storage.md](storage.md).
- **Secrets.** JWT secrets, service tokens, and database credentials live with
  your deployment; rotate them as you would any production secret.
- **TLS / routing.** A reverse proxy terminates TLS and routes the panel and the
  per-project endpoints — see [Routing per-project auth](#routing-per-project-auth)
  for how those hostnames get their DNS.

## Routing per-project auth

Each project's auth (GoTrue) is reachable at its own host, derived from
`HAULDR_AUTH_DOMAIN_PATTERN` — e.g. `auth-{project}.example.com` yields
`auth-acme.example.com`. The reverse proxy in front of the stack routes that host
to the project's auth service; the host just needs **DNS** pointing at that edge.

Two ways to manage that DNS:

- **Operator-managed (default).** Point one wildcard record at the edge — a single
  `*.example.com` covers every project's auth host. The control plane touches no
  DNS; this is `HAULDR_DNS_PROVISIONER=none`, the default, so the stock build
  needs no DNS credentials.
- **Automatic.** Let the control plane publish a record per project on create and
  retract it on teardown, through a pluggable DNS provisioner. The Cloudflare
  backend (`HAULDR_DNS_PROVISIONER=cloudflare`) upserts a CNAME to a configured
  target (`HAULDR_DNS_TARGET`, e.g. a tunnel hostname) with a scoped API token —
  useful when a wildcard can't cover the hosts, for instance when auth sits behind
  a different edge than the rest of your domain. Teardown only removes a record it
  owns (one pointing at the configured target).

The endpoint's scheme follows `HAULDR_AUTH_SCHEME`: `https` by default, or `http`
when TLS is terminated at the edge (e.g. a tunnel), so the origin never blocks on
issuing a certificate for a name it can't validate directly. See
[`.env.example`](../.env.example) for the full set of variables.

## Tiering a project later

A project that outgrows the shared cluster can be promoted to a dedicated one.
The pooler re-points its route and the application keeps its connection logic
unchanged. See [data-plane.md](data-plane.md#tiering).
