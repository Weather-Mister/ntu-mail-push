BEGIN;
LOCK TABLE public.eren_mail_outbox IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN IF (select count(*) from public.schedule_workspaces where app_slug='begum')<>1 OR EXISTS(select 1 from public.eren_mail_outbox o join public.schedule_workspaces w using(workspace_hash) where w.app_slug='begum' and o.status in ('pending','processing','sending','uncertain')) THEN RAISE EXCEPTION 'Reconcile Begum deliveries before migration'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.eren_mail_claim(p_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF eren_mail_outbox
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 with exhausted as (
  update public.eren_mail_outbox
  set status='failed',locked_until=null,
      error='Automatic delivery stopped after 5 attempts. Open Outbox to recover the draft.'
  where id in (
   select id from public.eren_mail_outbox
   where (p_id is null or id=p_id)
    and workspace_hash not in (select workspace_hash from public.schedule_workspaces where app_slug in ('eren','begum'))
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
    and workspace_hash not in (select workspace_hash from public.schedule_workspaces where app_slug in ('eren','begum'))
    and send_at<=now() and attempts<5
    and (status='pending' or status='processing' and locked_until<now())
  order by send_at,id
  for update skip locked
  limit 1
 )
 returning *;
$function$
;
COMMIT;
