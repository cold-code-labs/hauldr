# Schedules — the Cron plane (design + consumption)

Status: control-plane API implementado (`schedulesapi.ts` + rotas `/v1/projects/:name/schedules`),
validado no substrato v17. Companion da [ADR 0006] e de `docs/pg-supabase-image-migration.md`.

## O que é

Uma primitiva **única e compartilhada** de agendamento sobre **um** scheduler pg_cron, servindo a
frota inteira — **sem instância/timer por projeto**. Substitui os `hauldr-fn-*` systemd timers
escritos à mão. O control-plane é o **dono do registro**; a **execução fica no app** (endpoint HTTP /
edge function) ou no **DB do tenant** (SQL). Namespaced `"<project>__<name>"` no catálogo `cron.job`
compartilhado → isolamento entre tenants.

Dois tipos (`kind`):
- **`http`** — `net.http_post`/`net.http_get` (pg_net) pra uma URL, no horário. Registrado no DB do
  cron (onde vive o worker do pg_net). É o **"chame meu app/edge fn no horário"** — o app roda a
  lógica no próprio runtime (env/deps dele). O caller passa a URL e os headers (ex. um cron secret);
  o control-plane **nunca precisa do segredo do app**.
- **`sql`** — `cron.schedule_in_database` roda SQL **dentro do `db_<project>`**. Pra trabalho
  DB-nativo: enfileirar no pgmq, refresh de materialized view, varrer linhas velhas.

## Camadas de consumo (do privilegiado ao app)

### 1. Control-plane API — a fonte da verdade (implementado)
Gated pela management key (`HAULDR_API_KEY`). Consumido por Heimdall, provisioning e operadores —
**não** pelo app end-user direto (é privilegiado, cria jobs superuser).

```
POST   /v1/projects/:name/schedules      # cria/atualiza (upsert por nome)
GET    /v1/projects/:name/schedules      # lista (namespaced)
DELETE /v1/projects/:name/schedules/:job # remove (idempotente)
```

Body (http):
```jsonc
{ "name": "daily-digest", "schedule": "0 6 * * *", "kind": "http",
  "url": "http://<app>:3000/api/cron/daily-digest",
  "headers": { "x-cron-secret": "<segredo do app>" },
  "body": { "window": "24h" } }
```
Body (sql):
```jsonc
{ "name": "enqueue-scan", "schedule": "*/5 * * * *", "kind": "sql",
  "command": "select pgmq.send('jobs', '{\"kind\":\"scan\"}'::jsonb)" }
```
`schedule` = expressão cron (`0 6 * * *`) ou intervalo (`30 seconds`). `kind` é inferido quando
omitido (`url`⇒http, `command`⇒sql). Resposta: `{ project, name, jobid, kind, schedule, database, active }`.

### 2. App-facing — declarativo, no repo, aplicado no deploy (**a melhor forma p/ apps**)
Um seam **`lib/jobs`** no `template-light` (irmão de `lib/events`, `lib/realtime`, `lib/storage`,
`lib/brokk`). O app **declara os schedules em código** e o deploy os reconcilia via a API — igual às
migrations (`db/migrations` aplicadas via `/v1/projects/:name/migrate`). Ninguém edita cron à mão.

```ts
// jobs.config.ts — declarado pelo app, versionado
export default defineJobs({
  "daily-digest": { schedule: "0 6 * * *", http: "/api/cron/daily-digest" },
  "enqueue-scan": { schedule: "*/5 * * * *", sql: "select pgmq.send('jobs','{}'::jsonb)" },
});
```
- **http job** → o app expõe `app/api/cron/<name>/route.ts`; o schedule faz POST nele com um
  **cron secret**. O seam dá `verifyCron(req)` (compara `x-cron-secret`/Bearer) — roda no runtime do
  app, com env e deps dele. É o caso comum (digest, sync de API externa, relatório).
- **sql job** → SQL declarado, roda no DB do tenant (pgmq/MV/sweep).
- **reconcile no deploy**: um passo `hauldr-jobs sync` (como o dev-migrate) faz `GET` dos schedules
  atuais + `POST`/`DELETE` pra bater com o `jobs.config.ts`. Idempotente (upsert por nome).

### 3. Fila (pgmq) — o par durável (a metade "workers")
Schedule = **gatilho**; pgmq = **buffer durável**; worker = **execução**. Um job (http ou sql)
enfileira no pgmq; um worker (o app, ou um consumidor compartilhado) drena. É assim que "workers +
crons" convergem numa primitiva só: cron dispara, pgmq segura, worker processa — tudo no mesmo
Postgres do tenant, sem infra nova. (Ver `~/ccl/workers-crons-map.md`; complementa o pg-boss de
`hauldr_jobs` p/ jobs de aplicação.)

### 4. Heimdall `/jobs` — o painel humano (a fazer)
UI sobre a API (listar/criar/pausar/remover) + histórico de execução de `cron.job_run_details`
(status/duração/erro por run). Mesmo padrão de `/routing` e `/runas`. "Centraliza a visão".

## Segurança & multi-tenancy

- **Namespacing** `"<project>__<name>"` → um tenant não vê/derruba job de outro.
- **API gated** pela management key; **não** exposta a end-users. Apps recebem schedules via o seam
  no deploy (canal privilegiado), não chamando a API direto.
- **Segredo do http job**: reusar a convenção `CRON_SECRET` (já existe em `functionsapi.ts` p/ as edge
  fns) — o app verifica. ⚠️ hoje os headers vão **inline no `command`** do `cron.job` (texto, visível
  a quem lê o catálogo como superuser). Aceitável p/ interno; evoluir p/ referência a um secret
  (GUC/vault) em vez de literal.
- **Privilégio de execução**: jobs rodam como o role da conexão admin (superuser). SQL de tenant roda
  como superuser (bypassa RLS) — ok p/ manutenção registrada pelo control-plane; futuro = passar
  `username` (o role do projeto) no `schedule_in_database` p/ menor privilégio.
- **Blast radius**: jobs pg_cron/pg_net rodam dentro do cluster compartilhado → observar CPU/IO
  (Netdata) e evitar comandos pesados; preferir "enfileira no pgmq + worker fora" p/ trabalho longo.

## Pré-requisito de deploy (transição)

A feature exige o **substrato pg_cron/pg_net** → só funciona pra projetos num cluster **v17**
(`supabase/postgres`). O control-plane precisa que `HAULDR_DB_ADMIN_URL` aponte pra um cluster v17 e
conecte como **superuser** (`supabase_admin` — no v17 `postgres` é demovido, ver
`pg-supabase-image-migration.md §5b`) pra criar `pg_cron`/`pg_net` e registrar jobs. Enquanto a frota
está dividida (16.14 + v17), schedules valem pros projetos do cluster que o admin do control-plane
alcança. Num cluster sem o substrato, `createSchedule` falha com mensagem clara (não meio-registra).

## Migração dos `hauldr-fn-*` (Fase 6)

Cada systemd timer atual (ex. `hauldr-fn-viken-vindi-sync-subscriptions`) vira um **http schedule**
(POST na edge fn com `x-cron-secret`) registrado via a API → aposentar as units à mão. O
`hauldr-functions-cron.sh` deixa de existir; o disparo passa a ser pg_cron+pg_net dentro do banco.
