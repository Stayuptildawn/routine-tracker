-- Web push: browser subscriptions + a dedupe ledger for nudges.
create table push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

alter table push_subscriptions enable row level security;

create policy "own push_subscriptions" on push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- one nudge per routine per day, max - written only by send-nudges (service
-- role); RLS on with no policies so clients can't see or touch it
create table nudges_sent (
  routine_id uuid not null references routines on delete cascade,
  date date not null,
  primary key (routine_id, date)
);

alter table nudges_sent enable row level security;
