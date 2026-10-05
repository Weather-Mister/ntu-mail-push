-- Mail attachment bytes are large binary objects and must not be stored in Vault.
-- Keep the bucket private; only the service-role Edge Function accesses it.
insert into storage.buckets (id,name,public,file_size_limit)
values ('eren-mail-attachments','eren-mail-attachments',false,20971520)
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit;
