-- Keep each minute worker invocation inside the Edge runtime budget.
-- Claim one send at a time; the worker gives sends exclusive priority over mailbox sync.
create or replace function public.eren_mail_claim(p_id uuid default null)
returns setof public.eren_mail_outbox
language sql
security invoker
set search_path = ''
as $$
 update public.eren_mail_outbox
 set status='processing',locked_until=now()+interval '2 minutes',attempts=attempts+1
 where id in (
  select id from public.eren_mail_outbox
  where (p_id is null or id=p_id)
    and send_at<=now()
    and (status='pending' or status='processing' and locked_until<now())
  order by send_at
  for update skip locked
  limit 1
 )
 returning *;
$$;

revoke all on function public.eren_mail_claim(uuid) from public,anon,authenticated;
grant execute on function public.eren_mail_claim(uuid) to service_role;
