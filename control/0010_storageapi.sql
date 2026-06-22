-- Per-project Storage API (à-la-carte): the optional supabase/storage-api layer.
-- Like REST, it is opt-in — only projects that want the Supabase `/storage/v1`
-- surface (bucket/object REST) over their Garage bucket turn it on. The bucket +
-- scoped S3 key (the bytes) are tracked by the storage_* columns from 0007; these
-- track the API server in front of them.
alter table projects add column if not exists storage_api_url text;
alter table projects add column if not exists storage_api_container text;
