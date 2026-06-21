#!/usr/bin/env bash
# Hauldr Postgres health check — guards against the logical-decoding footgun:
# an inactive/invalidated replication slot pinning WAL until the disk fills.
# `max_slot_wal_keep_size` (set on the server) PREVENTS the disk-fill; this gives
# VISIBILITY — it alerts when a slot is at risk/invalidated, an inactive slot is
# retaining a lot of WAL, or the disk is filling. Runs via systemd timer; emails
# (Resend) only on breach, de-duped so an ongoing issue doesn't spam.
#
# Test the alert path:  hauldr-pg-health.sh --test
set -uo pipefail

LOG=${LOG_FILE:-/var/log/hauldr-pg-health.log}
exec >>"$LOG" 2>&1

DB_CONTAINER=${DB_CONTAINER:-$(docker ps --format '{{.Names}}' | grep -m1 hauldr-db)}
WARN_RETAIN_BYTES=${WARN_RETAIN_BYTES:-1073741824}   # 1 GiB on an INACTIVE slot
WARN_DISK_PCT=${WARN_DISK_PCT:-85}
DISK_PATH=${DISK_PATH:-/var/lib/docker}
STATE=${STATE_FILE:-/var/lib/hauldr-pg-health.state}
REALERT_SECS=${REALERT_SECS:-21600}                  # re-alert at most every 6h
RESEND_TOKEN_FILE=${RESEND_TOKEN_FILE:-/root/.resend_token}
ALERT_FROM=${ALERT_FROM:-Hauldr Monitor <alerts@mail.coldcodelabs.com>}
ALERT_TO=${ALERT_TO:-vitoralvesinfo@gmail.com}

TS=$(date -u +%FT%TZ)
issues=""
add() { issues="${issues}${issues:+; }$1"; }

if [ "${1:-}" = "--test" ]; then
  add "TEST alert — verifying the notification path"
elif [ -z "$DB_CONTAINER" ]; then
  add "hauldr-db container not found"
else
  bad=$(docker exec "$DB_CONTAINER" psql -U postgres -tAc \
    "select string_agg(slot_name||'('||wal_status||')', ', ') from pg_replication_slots where wal_status in ('unreserved','lost');" 2>/dev/null)
  [ -n "${bad// /}" ] && add "slot(s) at risk/invalidated: $bad"
  fat=$(docker exec "$DB_CONTAINER" psql -U postgres -tAc \
    "select string_agg(slot_name||' ('||pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn))||')', ', ') from pg_replication_slots where active=false and pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn) > $WARN_RETAIN_BYTES;" 2>/dev/null)
  [ -n "${fat// /}" ] && add "inactive slot(s) retaining WAL: $fat"
fi

pct=$(df --output=pcent "$DISK_PATH" 2>/dev/null | tail -1 | tr -dc '0-9')
[ -n "$pct" ] && [ "$pct" -ge "$WARN_DISK_PCT" ] && add "disk $DISK_PATH at ${pct}% (>= ${WARN_DISK_PCT}%)"

if [ -z "$issues" ]; then
  echo "$TS OK (slots healthy, disk ${pct:-?}%)"
  echo 0 >"$STATE" 2>/dev/null || true
  exit 0
fi

echo "$TS BREACH: $issues"

last=$(cat "$STATE" 2>/dev/null || echo 0)
now=$(date -u +%s)
if [ "${1:-}" != "--test" ] && [ $((now - last)) -lt "$REALERT_SECS" ]; then
  echo "$TS (alert suppressed; last sent $((now - last))s ago)"
  exit 0
fi

if [ -r "$RESEND_TOKEN_FILE" ]; then
  payload=$(python3 -c "import json,sys; print(json.dumps({'from':sys.argv[1],'to':[sys.argv[2]],'subject':sys.argv[3],'text':sys.argv[4]}))" \
    "$ALERT_FROM" "$ALERT_TO" "⚠️ Hauldr Postgres health" "Hauldr Postgres health alert ($TS):"$'\n'"$issues")
  if curl -s -X POST https://api.resend.com/emails \
       -H "Authorization: Bearer $(cat "$RESEND_TOKEN_FILE")" \
       -H "content-type: application/json" -d "$payload" | grep -q '"id"'; then
    echo "$TS alert emailed to $ALERT_TO"
    echo "$now" >"$STATE" 2>/dev/null || true
  else
    echo "$TS alert email FAILED"
  fi
else
  echo "$TS no Resend token ($RESEND_TOKEN_FILE) — alert not sent (issues: $issues)"
fi
