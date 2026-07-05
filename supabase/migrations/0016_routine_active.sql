-- Routines can be paused: inactive ones disappear from Now, the AI's
-- candidates, nudges and reflections, but stay on the Week page (dimmed)
-- where they can be re-activated. Existing rows default to active.
alter table routines add column active boolean not null default true;
