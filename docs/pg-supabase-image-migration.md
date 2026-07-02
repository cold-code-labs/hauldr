# Migração do Postgres core do Hauldr → `supabase/postgres` (PG 17)

Plano de execução. Companion de `docs/supabase-compat.md` (Fase 1b) e do mapa
`~/ccl/workers-crons-map.md`. Estado: PLANEJAMENTO.

## 0. Reframe — o que isto realmente é

**NÃO é um swap de imagem.** `supabase/postgres` só existe em PG **15 e 17** (sem
16.x). O cluster vive em **16.14-alpine**. Alvo forçado = **17** (16→15 é downgrade
impossível). Logo cruzamos ao mesmo tempo:

1. **Major version** 16 → 17 → exige `pg_upgrade` OU dump/restore lógico.
2. **libc** musl (alpine) → glibc (debian) → muda o provider de collation →
   índices em `text` precisam de reindex. Volume **não** é reutilizável.

Conclusão: **cluster novo em paralelo + dump lógico por DB + cutover**, nunca bump
de imagem sobre o volume atual. O dump/restore num cluster recém-init (glibc) já
**resolve a collation de graça** e o restore para de precisar do stripping de
`CREATE EXTENSION` (`preflight.ts:28`), porque a imagem Supabase tem as extensões.

## 1. Estado atual (levantado 2026-07-02)

- Cluster único `hauldr-db` (Coolify: `hauldr-db-rddi39yxzzgg7l9njbj8odna-*`), imagem
  custom `postgres:16.14-alpine` + wal2json_2_6 + pgvector v0.8.0 (`deploy/postgres/Dockerfile`).
- **31 databases**, 639 MB total. `shared_preload_libraries` VAZIO.
- DBs de sistema: `hauldr`, `hauldr_zero`, `_supabase`, `_realtime`, `hauldr_jobs`
  (já roda **pg-boss**), `postgres`. Control-plane do Heimdall = `db_heimdall`.
- Sidecars por app: `hauldr-auth-<proj>` (GoTrue v2.190.0), `hauldr-rest-<proj>`
  (PostgREST v12.2.3). Realtime = serviço compartilhado (tenants em `_realtime`).
  Pooler = `supabase/supavisor:2.9.7`. Bridge WG = `hauldr-db-wg` (socat 10.10.0.2:5434).
- Backups: `hauldr-postgres-backup.timer` (pg_dumpall → R2), `hauldr-garage-backup`.

## 2. Decisões travadas

- **Alvo:** `supabase/postgres:17.x` (pin exato definido na Fase 1; 17 é o default
  self-host desde 06/2026). Imagem crua primeiro; **imagem derivada fina só se**
  faltar algo (nenhum gap conhecido — wal2json/pgvector/pg_cron/pg_net/pgmq inclusos).
- **Estratégia:** cluster paralelo `hauldr-db-v17` + **cutover rolling por app**
  (não big-bang). Blast radius = 1 app por vez; rollback = repontar de volta.
- **Ordem:** DBs `*_dev` primeiro → apps internos → clientes reais (`ufc`,
  `maglink`, `calsavara`, `gemone`) por último.
- **Cluster antigo fica vivo N dias** como rollback instantâneo, depois decomissiona.

## 3. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Collation musl→glibc corrompe índice text | dump/restore em cluster fresh glibc (não reusa volume) + `REINDEX DATABASE` pós-restore + `amcheck` |
| Downtime da frota (big-bang) | cutover rolling por app; cada um janela de minutos |
| `pg_net` = SSRF de dentro do banco | egress allowlist no host + `pg_net` só via control-plane; não expor a tenants |
| Catálogo `cron.job` compartilhado | control-plane dono do registro; `schedule_in_database`; tenant sem SQL admin |
| Perda do pin dos plugins custom | aceitar os pins do Supabase; validar versão wal2json/pgvector no smoke |
| Realtime tenants quebram | re-registrar/repointar tenants em `_realtime` na cutover |
| supavisor/pooler aponta pro cluster velho | repointar `POSTGRES_HOST`/DATABASE_URL na cutover |
| Extensão ausente na imagem nova | Fase 1 audita `pg_extension` esperadas vs disponíveis ANTES |

## 4. Fases

### Fase 0 — Harness de conformance + freeze de inventário
- Fixture de conformance (o do `supabase-compat.md`, derivado do Viken): schema+RLS+RPC+
  auth+realtime+storage rodando contra um projeto Hauldr throwaway. **DoD do cutover.**
- Snapshot do inventário: por DB → tamanho, extensões (`select extname...`), roles,
  encoding/collation, publications (realtime), owners. Guardar em `ops/pg17/inventory.json`.

### Fase 1 — Imagem alvo + cluster paralelo (ZERO toque em prod)
- Pin `supabase/postgres:17.<patch>` exato; `docker pull`; auditar extensões da imagem
  (`create extension` dry em DB descartável) vs o inventário da Fase 0.
- Subir `hauldr-db-v17` como recurso Coolify **separado**, volume novo, network alias
  próprio (`hauldr-db-v17`), na rede `coolify` + WG. NÃO tocar `hauldr-db`.
- Validar preload: `show shared_preload_libraries` inclui `pg_cron`,`pg_net`,`pgsodium`.

### Fase 2 — Dry-run ponta-a-ponta em UMA DB dev
- Alvo: `db_svalinn_dev` (descartável). Fluxo completo cronometrado:
  `pg_dump -Fc` (old) → `pg_restore` (v17) → `REINDEX DATABASE` → `amcheck` →
  `NOTIFY pgrst` → subir sidecars auth/rest apontando pro v17 → smoke do app dev.
- Produz o **runbook por-app** exato (comandos + tempos + gotchas) e valida a fixture.

### Fase 3 — Baseline de compat no cluster novo (Fase 1a embutida)
- No template de projeto do v17: roles `anon`/`authenticated`/`service_role`/
  `authenticator` + helpers `auth.uid()`/`auth.role()`/`auth.jwt()` + extensões default
  (`uuid-ossp`,`pgcrypto`,`pg_trgm`). Atualizar `createProject`/migrations base.

### Fase 4 — Migrar DBs de sistema
Ordem cuidadosa: `_supabase` (supavisor) → `_realtime` (tenants) → `hauldr`/`hauldr_zero`
(GoTrue base) → `hauldr_jobs` (pg-boss) → `db_heimdall` (control-plane). Cada uma com
dump/restore/reindex + repoint do serviço dono + smoke. Heimdall por último dentro dos internos.

### Fase 5 — Cutover rolling por app (o grosso)
Por app, na ordem (dev → internos → clientes), cada um numa janela curta:
1. Anunciar/janela. Pausar writes (parar o app Next ou pôr em manutenção).
2. `pg_dump -Fc db_<app>` do cluster velho.
3. `pg_restore` no v17 → `REINDEX DATABASE` → `amcheck` → `NOTIFY pgrst`.
4. Repointar **todas** as connection strings pro `hauldr-db-v17`:
   - GoTrue sidecar `GOTRUE_DB_DATABASE_URL`
   - PostgREST sidecar `PGRST_DB_URI`
   - tenant Realtime em `_realtime` (db_host)
   - supavisor (se o app usa pooler)
   - control-plane admin URL (se aplicável)
   Redeploy dos sidecars.
5. Smoke: login (auth), CRUD via rest, realtime, storage. Rodar a fixture.
6. Marcar app como migrado. Rollback = repointar strings de volta + reiniciar sidecars.

### Fase 6 — Ligar o substrato cron/webhook (o motivo de tudo)
- `pg_cron`: 1 scheduler compartilhado; jobs por tenant via `cron.schedule_in_database`,
  registro **só** pelo control-plane (novo endpoint `/v1/projects/:name/schedules`).
- Migrar os `hauldr-fn-*` systemd timers (viken vindi-sync etc.) → `pg_cron`; aposentar
  as units à mão. Manter o `x-cron-secret` p/ funções que ainda são edge fn.
- `pg_net`: DB webhooks via `supabase_functions.http_request`, com egress allowlist.

### Fase 7 — Observabilidade + decomissão
- Heimdall `/jobs`: agrega `cron.job_run_details` das DBs + `pgboss.*` do `hauldr_jobs`
  num painel (padrão de `/routing`+`/runas`).
- Após N dias verde: parar e remover `hauldr-db` velho; repointar backup timer + bridge WG.

## 5. Rollback

- Por app (Fase 5): repointar as connection strings de volta pro cluster velho +
  reiniciar sidecars. O cluster velho fica intacto até a decomissão → rollback é minutos.
- Global: enquanto ambos vivem, a frota é um mosaico velho/novo; nunca há ponto sem volta
  até a Fase 7. Dado cifrado com `pgsodium` (se adotado) trava rollback → só ligar
  pgsodium DEPOIS de decomissionar o velho.

## 5b. Fase 0/1 EXECUTADA — resultados (2026-07-02)

Cluster paralelo **`hauldr-db-v17`** de pé na surtr (rede `coolify`, alias próprio, volume
`hauldr-pgdata-v17`, **sem porta pública**, senha = a do cluster 16.14). Imagem pinada
**`supabase/postgres:17.6.1.142`**. Cluster 16.14 intacto o tempo todo.

**Achado crítico p/ o runbook — inicializar como `supabase_admin`:**
A imagem só faz o bootstrap (hierarquia de roles + schemas auth/realtime + setup de extensões)
via `migrate.sh`, que roda **conectando como `supabase_admin`**. Subir com `POSTGRES_USER=postgres`
(a convenção do cluster atual) **quebra** o bootstrap: `role "supabase_admin" does not exist` →
sem roles, `CREATE EXTENSION pg_cron/pgmq` falha. **Correto: `POSTGRES_USER=supabase_admin`.**

**Achado — `postgres` deixa de ser superuser.** No substrato Supabase:
`supabase_admin` = superuser; `postgres` = `rolsuper=f` (mantém `createdb`+`createrole`).
⇒ `createProject` (CREATE DATABASE/ROLE) segue OK como postgres, mas instalar pg_cron/pgmq e ops
superuser exigem `supabase_admin`. **Ação:** control-plane admin URL do v17 deve usar `supabase_admin`.

**Roles já criados de fábrica (após bootstrap correto):** `anon`, `authenticated`, `authenticator`,
`service_role`, `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `postgres`.
⇒ cobre boa parte da Fase 1a; faltam só os helpers `auth.uid()/role()/jwt()` (vêm das migrations GoTrue).

**Extensões default no template `postgres`:** pg_stat_statements, pgcrypto, plpgsql, supabase_vault,
uuid-ossp. **Disponíveis p/ CREATE:** pg_cron 1.6.4, pg_net 0.20.3, pgmq 1.5.1, vector 0.8.2,
pgsodium 3.1.8, pg_graphql 1.6.1, postgis, http, pg_tle, wrappers, pg_trgm.
`shared_preload_libraries` (fixo na imagem): inclui `pg_cron, pg_net, pgsodium, supabase_vault`.

**Testes funcionais VERDES:**
- `pg_cron.schedule_in_database('smoke_job','*/5 * * * *','select 1','v17_smoke')` → agendou, listou
  em `cron.job` (com coluna `database`), desagendou. **Modelo de scheduler único compartilhado provado.**
- `pgmq`: `create` → `send` (msg_id 1) → `read` (recuperou `{"hello":"v17"}`) → `drop_queue`. **Round-trip OK.**
- `vector`: distância L2 `[1,2,3]<->[3,2,1]` = 2.828. OK.

DB de teste `v17_smoke` fica no cluster (descartável). `cron.database_name` = `postgres`.

## 5c. Fase 2 — DRY-RUN executado em `db_svalinn_dev` (2026-07-02)

Migração de dados 16.14 → v17 validada ponta-a-ponta (pipe local no surtr, cluster velho intacto):

| Passo | Resultado |
|---|---|
| DB origem | `db_svalinn_dev` 9.4 MB, 26 tabelas, roles referenciados: só `anon`/`authenticated`/`postgres` (todos no v17) |
| dump `-Fc` + `pg_restore` | **2.7s**, 0 erros |
| paridade (count por tabela) | **idêntica** old↔v17 (ex.: auth.schema_migrations=69, public._hauldr_migrations=2) |
| `REINDEX DATABASE` | **546ms** |
| `amcheck` (bt_index_check) | **90 índices btree, 0 falhas** → collation musl→glibc limpa |

**Runbook de dados validado (por app):**
```sh
OLD=<container-16.14>
docker exec $NEW psql -U supabase_admin -d postgres -c \
  "create database db_<app> with owner postgres template template0"       # template0 = pristino
docker exec $OLD pg_dump -Fc -U postgres db_<app> \
  | docker exec -i $NEW pg_restore -U supabase_admin -d db_<app>            # ownership=postgres preservado
docker exec -i $NEW psql -U supabase_admin -d db_<app> -c "reindex database db_<app>"
# amcheck opcional; depois NOTIFY pgrst; então repoint dos sidecars.
```

**Achado p/ o repoint (não p/ o restore):** o cluster velho tem **role por-app** `<app>_authenticator`
(ex. `svalinn_dev_authenticator`) que o PostgREST usa p/ logar. Os *dados* de `db_svalinn_dev` só
referenciam anon/authenticated/postgres, então o **restore não precisa** dele — mas o **repoint do
PostgREST sim**: criar `<app>_authenticator` (LOGIN, senha = a do sidecar) no v17 antes de apontar o
`PGRST_DB_URI` pra lá. `create database ... template template0` evita herdar seed supabase do template1.

Estado: cópia restaurada de `db_svalinn_dev` fica no v17 como artefato do dry-run (descartável;
re-dumpar fresh no cutover real).

## 5d. Cutover REAL do svalinn-dev — tentado, PostgREST OK, GoTrue BLOQUEADO, rollback limpo (2026-07-02)

Repoint dos 2 sidecars Coolify (`hauldr-rest-svalinn_dev` uuid `viynn6…`, `hauldr-auth-svalinn_dev`
uuid `tqk9ps…`) do `hauldr-db` → `hauldr-db-v17` via PATCH de env + redeploy. Prep: role
`svalinn_dev_authenticator` replicado no v17 via `pg_dumpall --roles-only` (senha=hash preservado,
memberships anon+authenticated) + re-dump fresh de `db_svalinn_dev`.

**PostgREST → VERDE no v17:** log `Successfully connected to PostgreSQL 17.6`, schema cache OK,
`GET /`=200, `GET /todos`=200, `svalinn_dev_authenticator` com 2 conexões no v17. Role model do
PostgREST (authenticator NOINHERIT + SET ROLE anon/authenticated) funciona sem mudança.

**GoTrue → BLOQUEADO no v17 (blocker de onboarding):** crash-loop re-executando a migration
`20250731150234_add_oauth_clients_table` (já aplicada!) → `ERROR: column "client_id" does not exist`.
Dados byte-idênticos old↔v17 (colunas de `auth.oauth_clients` iguais, migration registrada nos dois,
mesmas últimas migrations `20260302000000…`). **Teste de isolamento:** a MESMA imagem
(`supabase/gotrue:v2.190.0`, digest `f106c0…`) sobe SAUDÁVEL contra o old (PG16) e falha só no v17
(PG17) → **problema é do substrato PG17, não da imagem/redeploy.**

**CAUSA RAIZ CONFIRMADA (§5e) + fix:** GoTrue conecta como **`postgres`**. No substrato Supabase o
bootstrap seta `postgres` com `search_path = "$user", public, extensions` (**sem `auth`**), e o
dump traz um **`public.schema_migrations` do realtime** (55 linhas) que **sombra** a busca
não-qualificada `schema_migrations`. GoTrue lê a tabela errada (public, sem as versões dele) →
"acha" que nada foi aplicado → re-roda migration obsoleta (`20250731150234`, cujo `client_id` já
não existe) → crash. Confirmado com search_path=auth a mesma query resolve `auth.schema_migrations`
(69). **Não é privilégio nem imagem — é resolução de search_path.**

**Rollback:** PATCH env de volta p/ `hauldr-db` + redeploy nos 2 → dev 100% saudável no cluster velho
(PostgREST 200, GoTrue /health 200). Cluster 16.14 nunca foi tocado; janela de divergência evitada
(rollback antes de qualquer escrita nova no v17). **Reversibilidade do plano confirmada na prática.**

## 5e. GoTrue no PG17 — RESOLVIDO (search_path), validado em throwaway (2026-07-02)

Root cause = resolução de search_path (acima), NÃO privilégio/imagem. **Fix mínimo e reversível
(passo obrigatório do runbook de onboarding), por-DB:**
```sql
ALTER ROLE postgres IN DATABASE db_<app> SET search_path = auth, public, extensions;
```
Faz a conexão do GoTrue (que loga como `postgres`) resolver `auth.schema_migrations` primeiro →
migrations vistas como aplicadas → boot no-op. Alternativa Supabase-nativa (não escolhida p/ o
piloto por ser mais invasiva): apontar GoTrue p/ `supabase_auth_admin` (search_path=auth de fábrica)
+ reassign de ownership do schema `auth` — `supabase_auth_admin` existe mas **sem senha** no v17.

**Validado:** throwaway `db_gttest` (cópia de db_svalinn_dev) + `ALTER ROLE ... search_path` + GoTrue
descartável (env clonado do app Coolify, só DB trocado) → **subiu limpo** (`status=running`,
`restarts=0`, `/health`=200, **0 erros** no log, sem re-run de migration). Throwaway removido.

### Runbook de onboarding por app — CONSOLIDADO (validado no dry-run + piloto)
1. **Roles no v17** (globals): `svalinn_dev_authenticator` etc. via `pg_dumpall --roles-only` filtrado
   (senha=hash preservado, memberships anon/authenticated). Shared roles já existem.
2. **Dados**: `create database db_<app> ... template template0` → `pg_dump -Fc | pg_restore` → `reindex database`.
3. **Fix GoTrue**: `ALTER ROLE postgres IN DATABASE db_<app> SET search_path = auth, public, extensions;`
4. **Repoint sidecars** (Coolify PATCH env host `hauldr-db`→`hauldr-db-v17`) + redeploy: PostgREST
   (`PGRST_DB_URI`) e GoTrue (`GOTRUE_DB_DATABASE_URL`).
5. **Smoke**: PostgREST `/` + `/todos` = 200; GoTrue `/health` = 200 + login; conexões visíveis no v17.
6. **Rollback** (se preciso): PATCH env de volta p/ `hauldr-db` + redeploy.

## 5f. Cutover E2E COMPLETO do svalinn-dev + estreia da fila de jobs (2026-07-02)

**svalinn-dev ONBOARDADO no v17** (1º app real no substrato Supabase 17). Runbook §5e aplicado:
re-dump fresh + reindex + `ALTER ROLE postgres IN DATABASE ... search_path` + repoint dos 2 sidecars
+ redeploy. Resultado: **GoTrue subiu limpo** (`restarts=0`, 0 erros, `/health`=200), PostgREST
`/todos`=200.

**E2E validado (auth + data plane no v17):** `POST /signup` no GoTrue → **JWT emitido** + linha em
`auth.users` gravada no v17 → `GET /todos` autenticado no PostgREST com esse token → **200** (JWT
verificado + RLS + read no v17). Usuário de teste removido. **Onboarding por app comprovado ponta a
ponta.** (svalinn-dev agora serve do v17; a cópia no 16.14 ficou stale — decomissionar junto no fim.)

**Estreia da fila de jobs (a primitiva que a migração destrava):** provado o modelo da [ADR 0006],
scheduler ÚNICO → job por-tenant → fila durável:
- `pgmq.create('jobs_demo')` no DB do tenant (`db_svalinn_dev`).
- `cron.schedule_in_database('svalinn_dev_heartbeat','10 seconds', <send p/ pgmq>, 'db_svalinn_dev')`
  registrado no scheduler único (DB `postgres`).
- Em ~40s: **5 execuções `succeeded`** (cron.job_run_details) → **5 mensagens** na fila (pgmq.metrics)
  → `pgmq.read` consumiu o payload. Produce+schedule+consume ✅.
- Demo desagendada + fila removida (era prova; sem consumidor real não fica de pé).

**A capacidade cron+fila está LIVE no v17** para jobs reais. Próximo passo de produto: expor via
control-plane (`POST /v1/projects/:name/schedules` → `schedule_in_database`) + migrar os
`hauldr-fn-*` systemd timers pra cá (Fase 6), e o painel Heimdall `/jobs`.

## 6. Pré-flight checklist (antes da Fase 5)

- [ ] Fixture de conformance verde num projeto v17 limpo
- [ ] Dry-run (Fase 2) mediu tempo de dump+restore+reindex por tamanho de DB
- [ ] Roles + helpers `auth.*()` + extensões default no template v17
- [ ] Egress allowlist p/ pg_net desenhada
- [ ] Backup do cluster velho fresquíssimo (pg_dumpall) guardado off-site
- [ ] Janela combinada com clientes reais (ufc/maglink)
