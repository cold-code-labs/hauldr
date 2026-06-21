# Postgres health monitor

Logical decoding (Realtime broadcast + postgres-changes) has a known footgun: an
inactive or invalidated replication slot keeps pinning WAL until the disk fills.

**Prevention** (the real guard) lives on the server: `max_slot_wal_keep_size=4GB`
in the compose command — Postgres invalidates a slot that falls further behind
than that instead of letting WAL grow unbounded (Realtime recreates its slot on
reconnect). **This monitor adds visibility**: it alerts when a slot is at
risk/invalidated, an inactive slot retains a lot of WAL, or the disk is filling.

`hauldr-pg-health.sh` runs via a systemd timer (every 15 min). It emails via
Resend **only on breach**, de-duped (re-alert at most every 6h).

## Configure (env, defaults in parentheses)

- `RESEND_TOKEN_FILE` (`/root/.resend_token`), `ALERT_TO`, `ALERT_FROM` — the alert channel.
- `WARN_RETAIN_BYTES` (1 GiB) — inactive slot retaining more than this.
- `WARN_DISK_PCT` (85), `DISK_PATH` (`/var/lib/docker`).
- `REALERT_SECS` (21600 = 6h) — minimum gap between repeat alerts.
- `DB_CONTAINER` (auto: first container matching `hauldr-db`).

## Install (systemd)

```sh
install -m 0755 hauldr-pg-health.sh /usr/local/bin/
cp hauldr-pg-health.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hauldr-pg-health.timer
hauldr-pg-health.sh --test    # verify the alert path (sends one email)
```
