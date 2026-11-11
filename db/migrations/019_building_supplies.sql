-- Somewhere for a barn's lumber, nails and hardware to go.
--
-- Improvements covers work paid for on the place — an electrician, a
-- concrete pad. The materials for a build the farm does itself had no
-- home short of "Parts", which is the tractor's. The quick Buy sheet offers
-- this as one of its one-tap kinds, and records it as a service-origin
-- purchase (SERVICE_MATERIALS in src/lib/purchaseKinds.ts): lumber goes
-- into the barn the day it arrives, and is never stock to draw down.
--
-- Idempotent, same shape as 017: safe on every app start, farm_id null so
-- every farm sees it.

insert into term (farm_id, vocabulary, name)
select null, 'material', v.name
  from (values ('Building supplies')) as v(name)
 where not exists (
   select 1 from term
    where vocabulary = 'material' and name = v.name and farm_id is null
 );
