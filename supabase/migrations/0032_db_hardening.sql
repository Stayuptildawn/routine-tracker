-- Database hardening from the 2026-11 audit. None of this changes what the
-- app can do; it closes doors the app never uses.

-- 1. Nothing is read before sign-in (the demo runs on an in-browser fake), so
--    the anon role needs no table or function access at all. The old legacy
--    auto-grants are removed, and new objects stop getting them.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function explore_buckets(text, text, timestamp) to authenticated, service_role;
grant execute on function claim_ai_call(text, int) to authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- 2. A child row may only point at a parent the same account owns. RLS used
--    to check the child's own user_id only, so a row could be attached to
--    someone else's session or routine id (service-role code that walks a
--    parent's children would then pick it up).
drop policy "own planned_sessions" on planned_sessions;
create policy "own planned_sessions" on planned_sessions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from training_blocks b where b.id = block_id and b.user_id = auth.uid()));

drop policy "own planned_sets" on planned_sets;
create policy "own planned_sets" on planned_sets for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from planned_sessions s where s.id = session_id and s.user_id = auth.uid()));

drop policy "own recovery_checkins" on recovery_checkins;
create policy "own recovery_checkins" on recovery_checkins for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from planned_sessions s where s.id = session_id and s.user_id = auth.uid()));

drop policy "own cardio_logs" on cardio_logs;
create policy "own cardio_logs" on cardio_logs for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and (session_id is null
      or exists (select 1 from planned_sessions s where s.id = session_id and s.user_id = auth.uid())));

drop policy "own reminders" on reminders;
create policy "own reminders" on reminders for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and (routine_id is null
      or exists (select 1 from routines r where r.id = routine_id and r.user_id = auth.uid())));

-- 3. Text that ends up in AI prompts gets a hard ceiling in the database, not
--    only in the client (src/lib/limits.ts). Generous on purpose - these bound
--    abuse, they don't style the UI.
alter table routines add constraint routines_name_len check (char_length(name) <= 200);
alter table tasks add constraint tasks_label_len check (char_length(label) <= 300);
alter table reminders add constraint reminders_raw_text_len check (char_length(raw_text) <= 2000);
alter table planned_sets add constraint planned_sets_exercise_len check (char_length(exercise) <= 300);
alter table workout_logs add constraint workout_logs_exercise_len check (char_length(exercise) <= 300);

-- 4. Realtime: keep only the tables a screen actually listens to. A delete
--    event carries the row's primary key to every subscriber regardless of
--    RLS, and daily_state's key is (user_id, date).
alter publication supabase_realtime drop table daily_state, workout_logs, ai_actions, planned_sessions;
