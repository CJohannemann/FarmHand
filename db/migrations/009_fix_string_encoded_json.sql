-- Repairs rows pushed while the client was sending JSON columns as strings.
--
-- SQLite has no JSON type, so `attributes`/`geometry` come back from the
-- local database as TEXT. push() handed those straight to PostgREST, which
-- wrote them into the remote `jsonb` columns as JSON *strings*
-- (`"{\"species\":\"Pig\"}"`) rather than objects (`{"species": "Pig"}`).
-- The client-side fix is in src/db/json.ts; this repairs what was already
-- written.
--
-- `#>> '{}'` extracts a jsonb scalar as its raw text, which for one of these
-- string values is the original JSON document — re-casting that to jsonb
-- gives the object it should always have been. Guarded by jsonb_typeof so a
-- correctly-stored object is never touched, which also makes this safe to
-- run more than once.
--
-- Safe to run repeatedly.

update asset
   set attributes = (attributes #>> '{}')::jsonb
 where jsonb_typeof(attributes) = 'string';

update log
   set attributes = (attributes #>> '{}')::jsonb
 where jsonb_typeof(attributes) = 'string';

update location
   set geometry = (geometry #>> '{}')::jsonb
 where geometry is not null
   and jsonb_typeof(geometry) = 'string';
