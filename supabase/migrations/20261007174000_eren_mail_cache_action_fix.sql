-- Fix PL/pgSQL variable/column ambiguity in the cache-coherence batch helper.
create or replace function public.eren_mail_apply_cache_actions(p_actions jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  v_account_id uuid;
  v_thread_id text;
  v_action text;
begin
  if jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) > 100 then
    raise exception 'Invalid action batch';
  end if;

  for item in select value from jsonb_array_elements(p_actions)
  loop
    v_account_id := (item->>'accountId')::uuid;
    v_thread_id := item->>'threadId';
    v_action := item->>'action';

    if v_action = 'trash' then
      update public.eren_mail_messages as m
      set labels = case
        when 'TRASH' = any(array_remove(m.labels,'INBOX')) then array_remove(m.labels,'INBOX')
        else array_append(array_remove(m.labels,'INBOX'),'TRASH')
      end,
      updated_at = now()
      where m.account_id = v_account_id and m.thread_id = v_thread_id;
    elsif v_action = 'untrash' then
      update public.eren_mail_messages as m
      set labels = case
        when 'INBOX' = any(array_remove(m.labels,'TRASH')) then array_remove(m.labels,'TRASH')
        else array_append(array_remove(m.labels,'TRASH'),'INBOX')
      end,
      updated_at = now()
      where m.account_id = v_account_id and m.thread_id = v_thread_id;
    elsif v_action = 'archive' then
      update public.eren_mail_messages as m set labels=array_remove(m.labels,'INBOX'),updated_at=now()
      where m.account_id=v_account_id and m.thread_id=v_thread_id;
    elsif v_action = 'unarchive' then
      update public.eren_mail_messages as m
      set labels=case when 'INBOX'=any(m.labels) then m.labels else array_append(m.labels,'INBOX') end,updated_at=now()
      where m.account_id=v_account_id and m.thread_id=v_thread_id;
    elsif v_action = 'read' then
      update public.eren_mail_messages as m set labels=array_remove(m.labels,'UNREAD'),updated_at=now()
      where m.account_id=v_account_id and m.thread_id=v_thread_id;
    elsif v_action = 'unread' then
      update public.eren_mail_messages as m
      set labels=case when 'UNREAD'=any(m.labels) then m.labels else array_append(m.labels,'UNREAD') end,updated_at=now()
      where m.account_id=v_account_id and m.thread_id=v_thread_id;
    elsif v_action = 'star' then
      update public.eren_mail_messages as m
      set labels=case when 'STARRED'=any(m.labels) then m.labels else array_append(m.labels,'STARRED') end,updated_at=now()
      where m.account_id=v_account_id and m.thread_id=v_thread_id;
    elsif v_action = 'unstar' then
      update public.eren_mail_messages as m set labels=array_remove(m.labels,'STARRED'),updated_at=now()
      where m.account_id=v_account_id and m.thread_id=v_thread_id;
    else
      raise exception 'Invalid mail action';
    end if;
  end loop;
end;
$$;

revoke all on function public.eren_mail_apply_cache_actions(jsonb) from public,anon,authenticated;
grant execute on function public.eren_mail_apply_cache_actions(jsonb) to service_role;
