-- Crash recovery must share the application's five-attempt budget. Runtime
-- termination never reaches deliver()'s catch handler. Keep payloads and objects
-- intact so the existing Outbox restore action can recover exhausted jobs.
create or replace function public.eren_mail_claim(p_id uuid default null)
returns setof public.eren_mail_outbox
language sql
security invoker
set search_path = ''
as $$
 with exhausted as (
  update public.eren_mail_outbox
  set status='failed',locked_until=null,
      error='Automatic delivery stopped after 5 attempts. Open Outbox to recover the draft.'
  where id in (
   select id from public.eren_mail_outbox
   where (p_id is null or id=p_id)
     and send_at<=now() and attempts>=5
     and (status='pending' or status='processing' and locked_until<now())
   order by send_at,id
   for update skip locked
   limit 100
  )
 )
 update public.eren_mail_outbox
 set status='processing',locked_until=now()+interval '2 minutes',attempts=attempts+1
 where id in (
  select id from public.eren_mail_outbox
  where (p_id is null or id=p_id)
    and send_at<=now() and attempts<5
    and (status='pending' or status='processing' and locked_until<now())
  order by send_at,id
  for update skip locked
  limit 1
 )
 returning *;
$$;

revoke all on function public.eren_mail_claim(uuid) from public,anon,authenticated;
grant execute on function public.eren_mail_claim(uuid) to service_role;
