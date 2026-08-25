-- Hay comes as small square bales or large round ones, and they are not
-- interchangeable units for pricing — a round bale is several square
-- bales' worth. The generic "bale" from the original seed doesn't
-- distinguish them, so it is retired in favor of both specific terms.
-- Idempotent and run on every app start.

update term set deleted_at = now(), updated_at = now()
 where vocabulary = 'unit' and name = 'bale' and farm_id is null and deleted_at is null;

insert into term (farm_id, vocabulary, name)
select null, 'unit', 'Square Bale'
 where not exists (
   select 1 from term
    where vocabulary = 'unit' and name = 'Square Bale' and farm_id is null
 );

insert into term (farm_id, vocabulary, name)
select null, 'unit', 'Round Bale'
 where not exists (
   select 1 from term
    where vocabulary = 'unit' and name = 'Round Bale' and farm_id is null
 );
