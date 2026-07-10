-- One pre-reflection nudge per user per day (21:30 local, half an hour before
-- the nightly reflection) - written only by send-nudges (service role); RLS
-- on with no policies so clients can't see or touch it, like nudges_sent.
create table reflect_nudges_sent (
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  primary key (user_id, date)
);

alter table reflect_nudges_sent enable row level security;
