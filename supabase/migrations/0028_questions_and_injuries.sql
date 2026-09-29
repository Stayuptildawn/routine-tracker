-- Two features:
--
-- 1. Questions in the Now composer. A message that only asks something
--    ("how many runs this month?") is logged in ai_actions with status
--    'answered': nothing to undo, and it stays out of the kept/undone
--    accuracy stats (those count 'applied'/'confirmed' vs 'undone').
--
-- 2. Injury reports. The user picks a body part + severity; the app previews
--    how the upcoming (unlogged) planned sets change - lighter, swapped or
--    dropped - and applies it on a yes. `changes` records every row it
--    touched with its before/after state, so "healed" restores exactly what
--    this injury changed and nothing else.

alter table ai_actions drop constraint if exists ai_actions_status_check;
alter table ai_actions add constraint ai_actions_status_check
  check (status in ('applied','confirmed','undone','answered'));

create table injuries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  body_part text not null
    check (body_part in ('neck','shoulder','elbow','wrist','lower_back','hip','knee','ankle')),
  severity text not null check (severity in ('mild','moderate','severe')),
  note text check (char_length(note) <= 300),
  started_on date not null default current_date,
  healed_on date,                       -- null = still active
  changes jsonb not null default '[]',  -- see lib/injuries.ts InjuryChange
  created_at timestamptz default now()
);

create index injuries_user_active_idx on injuries (user_id) where healed_on is null;

alter table injuries enable row level security;

create policy "own injuries" on injuries for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- the cue shown on an adjusted exercise in the session screen
-- ("Knee: pain-free range, lighter load")
alter table planned_sets add column injury_note text;

grant select, insert, update, delete on injuries to authenticated, service_role;
