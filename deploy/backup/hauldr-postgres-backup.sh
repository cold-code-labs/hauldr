#!/usr/bin/env bash
# Off-site backup of the Hauldr shared Postgres → S3-compatible object store (R2).
#
# Strategy: `pg_dumpall` (globals + every database) → gzip → a temp file we verify
# (gzip integrity + non-trivial size) BEFORE uploading, so a partial/corrupt dump
# is never published. Named by timestamp, pruned by age. Runs via systemd timer.
#
# Logical dump (not PITR): each database is dumped in a consistent snapshot. Good
# for "restore the cluster as of last night". For finer RPO, layer WAL archiving
# on top later. Restore: `gunzip -c <dump> | docker exec -i <db> psql -U postgres`.
set -uo pipefail

LOG=${LOG_FILE:-/var/log/hauldr-postgres-backup.log}
exec >>"$LOG" 2>&1

# Resolve the running Postgres container by name (Coolify appends a random suffix).
DB_CONTAINER=${DB_CONTAINER:-$(docker ps --format '{{.Names}}' | grep -m1 hauldr-db)}
REMOTE=${RCLONE_REMOTE:-r2:hauldr-garage-backup/postgres}
RETAIN_DAYS=${RETAIN_DAYS:-14}
MIN_BYTES=${MIN_BYTES:-1000}
TS=$(date -u +%Y%m%d-%H%M%S)

echo "=== $(date -u +%FT%TZ) postgres backup start (hauldr-pgdumpall-$TS.sql.gz) ==="

if [ -z "$DB_CONTAINER" ]; then
  echo "!!! no hauldr-db container found"; exit 1
fi

TMP=$(mktemp /tmp/hauldr-pgdump.XXXXXX.sql.gz)
trap 'rm -f "$TMP"' EXIT

if ! docker exec "$DB_CONTAINER" pg_dumpall -U postgres | gzip > "$TMP"; then
  echo "!!! pg_dumpall failed"; exit 1
fi
if ! gzip -t "$TMP"; then
  echo "!!! gzip integrity check failed"; exit 1
fi
SIZE=$(stat -c%s "$TMP")
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  echo "!!! dump suspiciously small ($SIZE bytes) — aborting"; exit 1
fi

if rclone copyto "$TMP" "$REMOTE/hauldr-pgdumpall-$TS.sql.gz"; then
  echo "uploaded hauldr-pgdumpall-$TS.sql.gz ($SIZE bytes)"
else
  echo "!!! upload failed"; exit 1
fi

# Retention: drop dumps older than RETAIN_DAYS.
rclone delete "$REMOTE" --min-age "${RETAIN_DAYS}d" 2>&1 | tail -1

echo "state on remote:"; rclone size "$REMOTE" 2>&1 | tail -2
echo "=== $(date -u +%FT%TZ) postgres backup done ==="
