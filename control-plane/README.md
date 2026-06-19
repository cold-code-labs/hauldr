# Hauldr — control plane

The management API and provisioner. It creates and tears down projects: a
database + an authenticator role + the base schema, a Supavisor tenant route,
and a per-project GoTrue (its own JWT secret). It also bootstraps the control
database and "project zero".

## Run it locally

From the repo root, bring up the shared core, then bootstrap and provision:

```bash
cp .env.example .env        # then fill in secrets (see comments in the file)
docker compose up -d db     # Postgres

cd control-plane
pnpm install
pnpm bootstrap              # control db + migrations + pooler metadata db
cd .. && docker compose up -d pooler

cd control-plane
pnpm cli create acme        # provision a project → prints its connection details
pnpm cli list
pnpm cli destroy acme
```

`pnpm bootstrap` and the CLI load the repo-root `.env` automatically.

## Management API

```bash
pnpm start                  # serves on HAULDR_API_PORT (default 8787)

curl -XPOST localhost:8787/v1/projects \
  -H "Authorization: Bearer $HAULDR_API_KEY" \
  -H 'content-type: application/json' -d '{"name":"acme"}'
```

`/v1/*` requires `Authorization: Bearer $HAULDR_API_KEY`. `/health` is open.

## Validate

Against a running stack:

```bash
HAULDR_AUTH_PROVISIONER=none pnpm validate   # data plane: pooled isolation + RLS
pnpm validate:auth                            # GoTrue per project, end to end
pnpm validate:sdk                             # the @hauldr/client SDK contract
```

## Auth provisioner

`createProject` brings up a GoTrue per project. The reference implementation
runs it as a Docker container on the stack network (`HAULDR_AUTH_PROVISIONER=docker`,
the default). Set `HAULDR_DOCKER_CMD="sudo docker"` if your user is not in the
`docker` group, or `HAULDR_AUTH_PROVISIONER=none` to skip auth (data plane only).
A platform that runs services through an orchestrator swaps this one step for an
API call — the database preparation and JWT-secret contract are identical.

## Layout

```
src/
  index.ts        management API (Hono)
  cli.ts          create / destroy / list / zero / master
  bootstrap.ts    control db + project zero + pooler metadata db
  provision.ts    createProject / provisionDatabase / destroyProject
  gotrue.ts       per-project auth (GoTrue) provisioner
  supavisor.ts    pooler tenant registration
  zero.ts         project zero (the panel's own GoTrue)
  config.ts       env-driven configuration
```
