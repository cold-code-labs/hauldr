-- Per-project object storage: the bucket + scoped S3 key minted on Garage.
-- The secret is kept so re-provisioning is idempotent (Garage returns a key's
-- secret only once, at creation).
alter table projects add column if not exists storage_bucket text;
alter table projects add column if not exists storage_access_key_id text;
alter table projects add column if not exists storage_secret_key text;
