-- Existing mail tables remain service-only with their existing RLS and grants.
-- Old accounts retain Gmail semantics; NTU credentials use the same Vault path.
alter table public.eren_mail_accounts
 add column if not exists provider text not null default 'gmail'
 check (provider in ('gmail','ntu')),
 add column if not exists provider_state jsonb not null default '{}'::jsonb;
alter table public.eren_mail_messages
 add column if not exists provider_ref jsonb;
comment on column public.eren_mail_messages.provider_ref is
 'NTU server folder/UID and RFC Message-ID. Logical message IDs survive app moves.';
