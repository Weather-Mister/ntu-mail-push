-- Eren Mail is isolated from all schedule tables and Begüm. Service-only API access.
create schema if not exists eren_mail_private;
revoke all on schema eren_mail_private from public, anon, authenticated;
grant usage on schema eren_mail_private to service_role;

create table public.eren_mail_accounts (
 id uuid primary key default gen_random_uuid(),
 workspace_hash text not null references public.schedule_workspaces(workspace_hash),
 email text not null, display_name text not null, secret_name text not null,
 status text not null default 'active' check(status in ('active','reauthorize','disconnecting')),
 history_id text, sync_page text, backfill_page text, initial_history text,
 sync_lock_until timestamptz, sync_lock_id uuid, last_sync_at timestamptz,
 sync_error text, created_at timestamptz not null default now(),
 unique(workspace_hash,email)
);
create table public.eren_mail_oauth (
 state_hash text primary key, workspace_hash text not null references public.schedule_workspaces(workspace_hash),
 browser_challenge text not null, verifier text not null, status text not null default 'waiting',
 expires_at timestamptz not null default now()+interval '10 minutes',
 pending_secret text, email text, scopes text
);
create table public.eren_mail_messages (
 account_id uuid not null references public.eren_mail_accounts(id) on delete cascade,
 id text not null, thread_id text not null, sender text not null, sender_name text not null,
 subject text not null, snippet text not null, internal_date bigint not null, labels text[] not null default '{}',
 classification jsonb not null default '{}', list_id text not null default '',
 updated_at timestamptz not null default now(), primary key(account_id,id)
);
create index eren_mail_messages_thread on public.eren_mail_messages(account_id,thread_id);
create index eren_mail_messages_time on public.eren_mail_messages(account_id,internal_date desc);
create table public.eren_mail_rules (
 id uuid primary key default gen_random_uuid(),
 workspace_hash text not null references public.schedule_workspaces(workspace_hash),
 account_id uuid references public.eren_mail_accounts(id) on delete cascade,
 scope text not null check(scope in ('sender','domain','list','thread','message')),
 match_value text not null check(length(match_value) between 1 and 500),
 type_match text, effects jsonb not null, enabled boolean not null default true,
 created_at timestamptz not null default now()
);
create index eren_mail_rules_workspace on public.eren_mail_rules(workspace_hash);
create table public.eren_mail_outbox (
 id uuid primary key, workspace_hash text not null references public.schedule_workspaces(workspace_hash),
 account_id uuid not null references public.eren_mail_accounts(id),
 to_address text not null, subject text not null, thread_id text,
 secret_name text not null, payload_hash text not null, rfc_message_id text not null,
 send_at timestamptz not null, status text not null default 'pending'
 check(status in ('pending','processing','sending','sent','failed','uncertain','cancelled')),
 locked_until timestamptz, attempts integer not null default 0, gmail_id text,
 error text, created_at timestamptz not null default now(), sent_at timestamptz
);
create index eren_mail_outbox_due on public.eren_mail_outbox(send_at) where status='pending';
create table public.eren_mail_drafts (
 id uuid primary key, workspace_hash text not null references public.schedule_workspaces(workspace_hash),
 account_id uuid not null references public.eren_mail_accounts(id) on delete cascade,
 secret_name text not null, subject text not null, updated_at timestamptz not null default now()
);
create table public.eren_mail_preferences (
 workspace_hash text primary key references public.schedule_workspaces(workspace_hash),
 preferences jsonb not null default '{}'
);
create table public.eren_mail_unsubscribes (
 account_id uuid not null references public.eren_mail_accounts(id) on delete cascade,
 message_id text not null, status text not null, updated_at timestamptz not null default now(),
 primary key(account_id,message_id)
);
create table public.eren_mail_health (
 id text primary key, last_started_at timestamptz, last_finished_at timestamptz, result jsonb
);
create table public.eren_mail_limits (
 bucket text primary key, started_at timestamptz not null default now(), hits integer not null default 1
);

do $$ declare t text; begin
 foreach t in array array['accounts','oauth','messages','rules','outbox','drafts','preferences','unsubscribes','health','limits'] loop
  execute format('alter table public.eren_mail_%I enable row level security',t);
  execute format('revoke all on public.eren_mail_%I from public,anon,authenticated',t);
  execute format('grant all on public.eren_mail_%I to service_role',t);
 end loop;
end $$;

-- Definer code lives in a non-exposed schema, fixed search path and service-only grants.
-- Public wrappers remain SECURITY INVOKER. Vault never reaches the browser.
create function eren_mail_private.secret(p_name text, p_value text default null, p_delete boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare sid uuid; result text;
begin
 if p_name not like 'eren-mail:%' then raise exception 'Invalid secret namespace'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_name,0));
 select id into sid from vault.secrets where name=p_name;
 if p_delete then delete from vault.secrets where id=sid; return null; end if;
 if p_value is not null then
  if sid is null then perform vault.create_secret(p_value,p_name);
  else perform vault.update_secret(sid,p_value,p_name); end if;
  return null;
 end if;
 select decrypted_secret into result from vault.decrypted_secrets where id=sid;
 return result;
end $$;
revoke all on function eren_mail_private.secret(text,text,boolean) from public,anon,authenticated;
grant execute on function eren_mail_private.secret(text,text,boolean) to service_role;
create function public.eren_mail_secret(p_name text,p_value text default null,p_delete boolean default false)
returns text language sql security invoker set search_path = '' as $$ select eren_mail_private.secret(p_name,p_value,p_delete); $$;
revoke all on function public.eren_mail_secret(text,text,boolean) from public,anon,authenticated;
grant execute on function public.eren_mail_secret(text,text,boolean) to service_role;

create function public.eren_mail_claim(p_id uuid default null)
returns setof public.eren_mail_outbox language sql security invoker set search_path = '' as $$
 update public.eren_mail_outbox set status='processing',locked_until=now()+interval '2 minutes',attempts=attempts+1
 where id in (select id from public.eren_mail_outbox
 where (p_id is null or id=p_id) and send_at<=now()
 and (status='pending' or status='processing' and locked_until<now())
 order by send_at for update skip locked limit 3) returning *;
$$;
revoke all on function public.eren_mail_claim(uuid) from public,anon,authenticated;
grant execute on function public.eren_mail_claim(uuid) to service_role;
create function public.eren_mail_rate(p_bucket text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
 insert into public.eren_mail_limits(bucket) values(p_bucket)
 on conflict(bucket) do update set
 hits=case when eren_mail_limits.started_at < now()-make_interval(secs=>p_seconds) then 1 else eren_mail_limits.hits+1 end,
 started_at=case when eren_mail_limits.started_at < now()-make_interval(secs=>p_seconds) then now() else eren_mail_limits.started_at end
 returning hits into n;
 return n<=p_limit;
end $$;
revoke all on function public.eren_mail_rate(text,integer,integer) from public,anon,authenticated;
grant execute on function public.eren_mail_rate(text,integer,integer) to service_role;

-- A private cron credential is generated inside Postgres, never written to Git or printed.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'eren-mail:cron')
where not exists(select 1 from vault.secrets where name='eren-mail:cron');
create index eren_mail_oauth_workspace on public.eren_mail_oauth(workspace_hash);
create index eren_mail_oauth_expiry on public.eren_mail_oauth(expires_at);
create index eren_mail_rules_account on public.eren_mail_rules(account_id);
create index eren_mail_outbox_account on public.eren_mail_outbox(account_id);
create index eren_mail_outbox_workspace on public.eren_mail_outbox(workspace_hash,created_at desc);
create index eren_mail_drafts_account on public.eren_mail_drafts(account_id);
create index eren_mail_drafts_workspace on public.eren_mail_drafts(workspace_hash,updated_at desc);
