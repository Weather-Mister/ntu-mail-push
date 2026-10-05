-- Rotate accounts by attempt time so a failing provider cannot starve other accounts.
alter table public.eren_mail_accounts add column last_sync_attempt_at timestamptz;
