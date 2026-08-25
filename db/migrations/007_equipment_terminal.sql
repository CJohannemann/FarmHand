-- Equipment ends differently than livestock. The original terminal_event
-- list was written when only animals and plantings were archived, so a
-- tractor could only ever be "sold" — picking Retired or Scrapped violated
-- the check constraint and the archive silently failed.
--
-- Idempotent: the constraint is dropped by name and re-added, which is safe
-- to repeat on every app start.

alter table asset drop constraint if exists asset_terminal_event_check;

alter table asset add constraint asset_terminal_event_check
  check (terminal_event in
    ('sold','died','culled','harvested','consumed','processed',
     'retired','scrapped'));
