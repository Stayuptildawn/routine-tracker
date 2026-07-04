-- Cardio: first-class logging (the plan schedules Zone 2 runs on Pull days,
-- but any run/walk/cycle counts). Written by NL logging, the session
-- completion screen, or nothing at all - cardio is never nagged about.
create table cardio_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  session_id uuid references planned_sessions on delete set null,
  date date not null default current_date,
  kind text not null default 'run',   -- run / walk / cycle / swim / other
  minutes numeric,
  distance_km numeric,
  notes text,
  created_at timestamptz default now()
);

alter table cardio_logs enable row level security;

create policy "own cardio_logs" on cardio_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create index cardio_logs_user_date_idx on cardio_logs (user_id, date desc);
