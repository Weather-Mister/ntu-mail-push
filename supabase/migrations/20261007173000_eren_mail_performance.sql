-- Fast cached mailbox reads + immediate cache coherence for idempotent mail actions.
create index if not exists eren_mail_messages_labels_gin
  on public.eren_mail_messages using gin(labels);

create or replace function public.eren_mail_apply_cache_actions(p_actions jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  account_id uuid;
  thread_id text;
  action text;
begin
  if jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) > 100 then
    raise exception 'Invalid action batch';
  end if;

  for item in select value from jsonb_array_elements(p_actions)
  loop
    account_id := (item->>'accountId')::uuid;
    thread_id := item->>'threadId';
    action := item->>'action';

    if action = 'trash' then
      update public.eren_mail_messages
      set labels = case
        when 'TRASH' = any(array_remove(labels,'INBOX')) then array_remove(labels,'INBOX')
        else array_append(array_remove(labels,'INBOX'),'TRASH')
      end,
      updated_at = now()
      where eren_mail_messages.account_id = account_id and eren_mail_messages.thread_id = thread_id;
    elsif action = 'untrash' then
      update public.eren_mail_messages
      set labels = case
        when 'INBOX' = any(array_remove(labels,'TRASH')) then array_remove(labels,'TRASH')
        else array_append(array_remove(labels,'TRASH'),'INBOX')
      end,
      updated_at = now()
      where eren_mail_messages.account_id = account_id and eren_mail_messages.thread_id = thread_id;
    elsif action = 'archive' then
      update public.eren_mail_messages set labels=array_remove(labels,'INBOX'),updated_at=now()
      where eren_mail_messages.account_id=account_id and eren_mail_messages.thread_id=thread_id;
    elsif action = 'unarchive' then
      update public.eren_mail_messages
      set labels=case when 'INBOX'=any(labels) then labels else array_append(labels,'INBOX') end,updated_at=now()
      where eren_mail_messages.account_id=account_id and eren_mail_messages.thread_id=thread_id;
    elsif action = 'read' then
      update public.eren_mail_messages set labels=array_remove(labels,'UNREAD'),updated_at=now()
      where eren_mail_messages.account_id=account_id and eren_mail_messages.thread_id=thread_id;
    elsif action = 'unread' then
      update public.eren_mail_messages
      set labels=case when 'UNREAD'=any(labels) then labels else array_append(labels,'UNREAD') end,updated_at=now()
      where eren_mail_messages.account_id=account_id and eren_mail_messages.thread_id=thread_id;
    elsif action = 'star' then
      update public.eren_mail_messages
      set labels=case when 'STARRED'=any(labels) then labels else array_append(labels,'STARRED') end,updated_at=now()
      where eren_mail_messages.account_id=account_id and eren_mail_messages.thread_id=thread_id;
    elsif action = 'unstar' then
      update public.eren_mail_messages set labels=array_remove(labels,'STARRED'),updated_at=now()
      where eren_mail_messages.account_id=account_id and eren_mail_messages.thread_id=thread_id;
    else
      raise exception 'Invalid mail action';
    end if;
  end loop;
end;
$$;

revoke all on function public.eren_mail_apply_cache_actions(jsonb) from public,anon,authenticated;
grant execute on function public.eren_mail_apply_cache_actions(jsonb) to service_role;
