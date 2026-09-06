-- Engine-hours tracking on the Maintenance form (queries.ts: lastServiceHours,
-- InputForm's "Hour meter now" field) records a quantity with measure =
-- 'hours' — an hour meter's cumulative reading, distinct from 'time' (a
-- duration). quantity_measure_check never had it in its allow-list, so every
-- such quantity was rejected at the database the moment it tried to sync,
-- with "violates check constraint quantity_measure_check".
--
-- Idempotent: the constraint is dropped by name and re-added, same pattern
-- as 007_equipment_terminal.sql, safe to repeat on every app start.

alter table quantity drop constraint if exists quantity_measure_check;

alter table quantity add constraint quantity_measure_check
  check (measure in ('weight','count','volume','area','length',
                      'temperature','price','time','hours'));
