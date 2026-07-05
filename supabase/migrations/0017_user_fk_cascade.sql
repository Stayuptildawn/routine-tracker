-- Deleting an auth user was blocked by non-cascading FKs (workout_plans,
-- routines, reminders, and the rest all reference auth.users with the
-- default RESTRICT). Convert every public FK to auth.users to ON DELETE
-- CASCADE, so removing a user cleans up all their data in one go.
do $$
declare r record;
begin
  for r in
    select con.conname, con.conrelid::regclass::text as tbl, att.attname as col
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and con.connamespace = 'public'::regnamespace
      and con.confdeltype <> 'c'   -- skip ones already cascading
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references auth.users(id) on delete cascade',
      r.tbl, r.conname, r.col
    );
  end loop;
end $$;
