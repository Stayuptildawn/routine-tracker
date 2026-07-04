-- Tiny per-user settings row. First use: program_start anchors "which week
-- of the workout block am I in" - picked on the Gym tab, read by
-- interpret-message when stamping logs with week/target scheme.
create table user_settings (
  user_id uuid primary key default auth.uid() references auth.users,
  program_start date,
  updated_at timestamptz default now()
);

alter table user_settings enable row level security;

create policy "own user_settings" on user_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
