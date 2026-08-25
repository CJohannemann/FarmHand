-- Tractors, implements, and vehicles need their own kind of upkeep event —
-- a "treatment" is a vet's word, not a mechanic's. New vocabulary for what
-- was done, and a material category for the parts bought to do it.
-- Idempotent and run on every app start, same as 002/004/005.

insert into term (farm_id, vocabulary, name)
select null, 'service', v.name
  from (values
    ('Oil change'), ('Filter'), ('Tires'), ('Repair'),
    ('Inspection'), ('Registration'), ('Other')
  ) as v(name)
 where not exists (
   select 1 from term
    where vocabulary = 'service' and name = v.name and farm_id is null
 );

insert into term (farm_id, vocabulary, name)
select null, 'material', 'Parts'
 where not exists (
   select 1 from term
    where vocabulary = 'material' and name = 'Parts' and farm_id is null
 );
