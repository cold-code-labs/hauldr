# Hauldr shared Postgres + wal2json.
#
# wal2json is the logical-decoding output plugin that Realtime's `postgres_cdc_rls`
# driver (the postgres-changes feature) needs. Stock postgres:16-alpine ships only
# the built-in `pgoutput`, which serves Realtime's broadcast / realtime.messages
# path but NOT postgres-changes — that path errors with `could not access file
# "wal2json"` until the plugin is present.
#
# Pinned to the SAME patch the data volume was initialized with (16.14), so
# swapping this image in is byte-identical Postgres plus one plugin .so: no
# data-directory migration, and rollback is just reverting to postgres:16.14-alpine.
# Bump this pin in lockstep with any minor upgrade of the base.
#
# Built without LLVM bitcode (`with_llvm=no`) — the plugin needs no JIT, which
# keeps the build to a plain C toolchain and avoids pinning a clang/llvm version.
FROM postgres:16.14-alpine

ARG WAL2JSON_REF=wal2json_2_6
RUN set -eux; \
    apk add --no-cache --virtual .wal2json-build build-base git; \
    git clone --depth 1 --branch "${WAL2JSON_REF}" https://github.com/eulerto/wal2json.git /tmp/wal2json; \
    cd /tmp/wal2json; \
    make PG_CONFIG=/usr/local/bin/pg_config with_llvm=no; \
    make PG_CONFIG=/usr/local/bin/pg_config with_llvm=no install; \
    cd /; rm -rf /tmp/wal2json; \
    apk del .wal2json-build; \
    test -f "$(pg_config --pkglibdir)/wal2json.so"

# pgvector — vector type + HNSW/ivfflat indexes, for semantic search over a
# project's data (e.g. Brokk's per-repo memory). Like wal2json: just a plugin
# .so, dormant until a project runs `CREATE EXTENSION vector` — zero impact on
# tenants that don't. Built with OPTFLAGS="" (no -march=native, for a portable
# reproducible binary) and with_llvm=no — the alpine base ships no clang for the
# optional JIT bitcode, and HNSW needs no JIT (verified the .so links + the
# extension installs without it). Same plain-C-toolchain approach as wal2json.
ARG PGVECTOR_REF=v0.8.0
RUN set -eux; \
    apk add --no-cache --virtual .pgvector-build build-base git; \
    git clone --depth 1 --branch "${PGVECTOR_REF}" https://github.com/pgvector/pgvector.git /tmp/pgvector; \
    cd /tmp/pgvector; \
    make PG_CONFIG=/usr/local/bin/pg_config OPTFLAGS="" with_llvm=no; \
    make PG_CONFIG=/usr/local/bin/pg_config OPTFLAGS="" with_llvm=no install; \
    cd /; rm -rf /tmp/pgvector; \
    apk del .pgvector-build; \
    test -f "$(pg_config --pkglibdir)/vector.so"
