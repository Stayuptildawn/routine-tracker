-- Cardio check-in, the strength recovery questions adapted: how it felt,
-- how the body was, whether the amount was right. Lives on the entry.
alter table cardio_logs
  add column effort text check (effort in ('easy', 'steady', 'pushed', 'all_out')),
  add column body text check (body in ('fresh', 'okay', 'heavy')),
  add column amount text check (amount in ('could_take_more', 'right', 'stretch', 'over_the_line'));
