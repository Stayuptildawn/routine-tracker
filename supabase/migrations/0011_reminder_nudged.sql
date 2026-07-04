-- Due-today reminder nudges: sent once per reminder by send-nudges
-- (morning window). nudged_at records the send so it never repeats.
alter table reminders add column nudged_at timestamptz;
