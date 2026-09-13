-- Somewhere to put work done on the place.
--
-- Every material the app shipped with is something a farm holds — feed,
-- hay, seed, parts. Running electric to a barn is none of those, and had no
-- sensible home: reported exactly that way, by someone who had just paid an
-- electrician and could not record it.
--
--   Improvements — the lasting kind: wiring, fencing, a concrete pad, a well
--   Utilities    — the bill that arrives every month afterwards
--
-- Two terms rather than one catch-all, because they part company at tax
-- time: an improvement is depreciated over years, a utility bill is an
-- expense in the year it is paid. A farm that merged them would have to
-- unpick them again come filing.
--
-- Both are recorded as service-origin purchases by the app (see
-- SERVICE_MATERIALS in src/screens/Today.tsx), so they carry their cost
-- without piling up in Stores as stock that can never be used up.
--
-- Idempotent, same shape as 002/004/005/006: safe on every app start, and
-- these are farm_id null so every farm sees them.

insert into term (farm_id, vocabulary, name)
select null, 'material', v.name
  from (values ('Improvements'), ('Utilities')) as v(name)
 where not exists (
   select 1 from term
    where vocabulary = 'material' and name = v.name and farm_id is null
 );
