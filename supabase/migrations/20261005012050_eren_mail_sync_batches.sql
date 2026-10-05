-- Keep large Gmail history events resumable within Edge Function runtime limits.
alter table public.eren_mail_accounts add column sync_pending jsonb;
