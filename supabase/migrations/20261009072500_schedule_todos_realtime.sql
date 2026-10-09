-- Publish minimal invalidations when schedule manual tasks change.
-- No task contents or pairing keys are included in realtime messages.
create or replace function public.schedule_task_ping()
returns trigger
language plpgsql
set search_path = ''
as $
declare ws text;
begin
  if TG_OP = 'DELETE' then ws := old.workspace_hash;
  else ws := new.workspace_hash; end if;
  perform realtime.send('{}'::jsonb, 'changed', 'schedule-todos:' || ws, false);
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end
$$;

create or replace trigger schedule_task_realtime_changed
after insert or update or delete on public.schedule_manual_tasks
for each row execute function public.schedule_task_ping();
