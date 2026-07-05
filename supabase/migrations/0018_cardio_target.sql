-- Cardio plan baseline: the user's easy-week weekly volume in km. The plan
-- progresses from this (Zone 2 base, ~10%/week build, deload every 6th week).
-- Null = use the default (10 km, i.e. two easy 5k runs).
alter table user_settings add column cardio_target_km numeric;
