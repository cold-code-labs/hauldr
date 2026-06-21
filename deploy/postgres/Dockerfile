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
