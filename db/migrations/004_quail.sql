-- Quail are poultry too, and increasingly common on small homesteads — they
-- start laying inside two months, and are legal in places that restrict
-- chickens. Missed from the original species seed. Idempotent and run on
-- every app start, same as 002.

insert into term (farm_id, vocabulary, name)
select null, 'species', 'Quail'
 where not exists (
   select 1 from term
    where vocabulary = 'species' and name = 'Quail' and farm_id is null
 );
