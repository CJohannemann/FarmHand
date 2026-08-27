-- A vet visit often bills a service fee separately from whatever medication
-- was given — "Office call" lets that fee get its own line (and its own
-- cost-breakdown category) instead of being folded into a treatment name
-- that's really describing what was administered, not the visit itself.
-- Idempotent and run on every app start, same as 002/004/005/006.

insert into term (farm_id, vocabulary, name)
select null, 'treatment', 'Office call'
 where not exists (
   select 1 from term
    where vocabulary = 'treatment' and name = 'Office call' and farm_id is null
 );
