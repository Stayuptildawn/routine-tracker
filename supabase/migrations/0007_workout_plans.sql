-- Workout periodization: the planned program (blocks -> split days ->
-- exercises with per-phase rep schemes). Seeded from the private spreadsheet
-- (see private/workout-plans-seed.sql); interpret-message uses it to infer
-- split_day and target_scheme when logging by voice/text.
create table workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  block int not null default 1,
  split_day text not null,      -- 'Push A', 'Legs B', ...
  sort_order int,
  exercise text not null,
  type text,                    -- Compound / Isolation
  safety_note text,             -- neck-safe execution cues
  schemes jsonb,                -- {"1-2": "4 x 8-10", "3-4": "5 x 5", "5-6": "3 x 12-15"}
  cardio text                   -- session-level cardio, if any
);

alter table workout_plans enable row level security;

create policy "own workout_plans" on workout_plans for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
