-- Length units. There was no way to record 30 ft of wire run to a barn, a
-- roll of fencing, or a length of pipe: the seeded units covered weight,
-- volume, count, area and time, and skipped length entirely.
--
-- Reported alongside the same purchase that needed migration 017.
--
-- Note these are grouped in the picker but NOT reclassified for storage:
-- see groupUnits vs measureForUnit in src/lib/units.ts for why calling a
-- foot a 'length' measure would stop 50 ft drawn off a 200 ft roll from
-- reducing the roll's balance.
--
-- Idempotent, same shape as 002/004/005/006/017.

insert into term (farm_id, vocabulary, name)
select null, 'unit', v.name
  from (values ('ft'), ('in'), ('yd'), ('m')) as v(name)
 where not exists (
   select 1 from term
    where vocabulary = 'unit' and name = v.name and farm_id is null
 );
