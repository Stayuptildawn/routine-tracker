-- Telegram bridge: maps a Telegram chat to an app user.
-- Only the telegram-webhook Edge Function (service role) touches this table;
-- RLS is enabled with no policies so anon/authenticated clients see nothing.
create table telegram_links (
  chat_id bigint primary key,
  user_id uuid not null references auth.users,
  created_at timestamptz default now()
);

alter table telegram_links enable row level security;
