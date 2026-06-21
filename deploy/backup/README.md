# Off-site backups

Hauldr keeps two off-site backups to an S3-compatible object store (Cloudflare R2
in our deployment), each a `systemd` timer on the host running the stack.

| What | Script | Default schedule | Restore |
|------|--------|------------------|---------|
| **Postgres** (all databases) | `hauldr-postgres-backup.sh` | daily 04:00 UTC | `gunzip -c dump.sql.gz \| docker exec -i <db> psql -U postgres` |
| **Garage** (object store) | host-managed | daily 04:30 UTC | unpack the tarball over the Garage volumes |

The Postgres job runs `pg_dumpall`, gzips to a temp file, verifies it (gzip
integrity + non-trivial size) **before** uploading, then prunes by age.

## Configure

The script reads env (sensible defaults in parentheses):

- `RCLONE_REMOTE` (`r2:hauldr-garage-backup/postgres`) — an rclone remote + path.
- `RETAIN_DAYS` (`14`) — prune dumps older than this.
- `DB_CONTAINER` (auto: first container whose name matches `hauldr-db`).
- `LOG_FILE` (`/var/log/hauldr-postgres-backup.log`).

It needs `rclone` configured on the host with the named remote (a bucket-scoped
token is enough — the script never lists or creates buckets).

## Install (systemd)

```sh
install -m 0755 hauldr-postgres-backup.sh /usr/local/bin/
cp hauldr-postgres-backup.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hauldr-postgres-backup.timer
systemctl start hauldr-postgres-backup.service   # run once now
```
