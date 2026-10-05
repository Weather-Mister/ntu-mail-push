-- Independent from NTU POP3/GitHub notifications and the existing Hanzi jobs.
-- The token is resolved inside Postgres; it is never embedded in the cron command.
select cron.schedule('eren-mail-minute','* * * * *', $job$
 select net.http_post(
  url := 'https://evckshjtzikuusnkdnjn.supabase.co/functions/v1/eren-mail?route=worker',
  headers := jsonb_build_object('Content-Type','application/json','x-mail-cron',
   (select decrypted_secret from vault.decrypted_secrets where name='eren-mail:cron')),
  body := '{}'::jsonb,
  timeout_milliseconds := 110000
 );
$job$);
