-- Time anchors: an optional "around this time" per routine (time blindness aid).
-- Feeds the Now view sort + countdown ring, and the send-nudges push windows.
alter table routines add column anchor_time time;
