// The reads behind "What to charge" (saleCostInputs() in queries.ts), kept
// in a file with no imports so db/test/verify-sale-cost.ts can run these
// exact statements under node:sqlite. queries.ts itself can't be loaded
// there — it talks to the browser's database worker — and the other tests'
// habit of copying statements out of it is how a test ends up passing
// against a query the app no longer runs.

/**
 * Every animal of one species the farm has had, with when it came and went.
 *
 * Arrived is the earlier of when the record was made and when it (or its
 * group) was bought or born: animals are often entered after the fact, and
 * a pig typed in today that was bought in May was eating feed in June.
 * Left is dated the way closedOutStock() dates it, and is null while it is
 * still here. External sire/dam stubs never lived here, so never ate here.
 */
export const SALE_COST_ANIMALS_SQL = `
  select a.id, a.name, a.parent_id,
         coalesce(
           (select min(l.timestamp) from log_asset la
              join log l on l.id = la.log_id and l.deleted_at is null
             where la.asset_id in (a.id, a.parent_id) and la.role = 'subject'
               and l.type in ('purchase', 'birth')
               and l.timestamp < a.created_at),
           a.created_at) as arrived,
         case when a.status = 'archived' then coalesce(
           (select max(l.timestamp) from log_asset la
              join log l on l.id = la.log_id and l.deleted_at is null
             where la.asset_id = a.id and la.role = 'subject'
               and l.type in ('sale', 'harvest', 'death')),
           a.updated_at) end as left_at
    from asset a
   where a.type = 'animal'
     and a.farm_id = (select id from active_farm)
     and a.deleted_at is null
     and a.attributes->>'species' = $1
     and a.attributes->>'external' is null`

/**
 * Every purchase and feeding with one of this species (or its group) as a
 * subject, as raw log_asset rows — the split itself happens in
 * lib/saleCost.ts. Done only: a feeding still planned on the calendar has
 * not eaten anything yet.
 */
export const SALE_COST_LOGS_SQL = `
  select l.id as log_id, l.type, l.timestamp, la.asset_id, la.role, la.amount,
         (select sum(q.value) from quantity q
           where q.log_id = l.id and q.deleted_at is null
             and q.measure = 'price') as price
    from log l
    join log_asset la on la.log_id = l.id
   where l.farm_id = (select id from active_farm)
     and l.deleted_at is null
     and l.status = 'done'
     and l.type in ('purchase', 'input_application')
     and exists (
       select 1 from log_asset s join asset a on a.id = s.asset_id
        where s.log_id = l.id and s.role = 'subject'
          and a.type in ('animal', 'group')
          and a.attributes->>'species' = $1)`

/**
 * The lots worth pricing: every one marked for this species, and every one
 * drawn on at a feeding or treatment of it. Price and size come off the
 * lot's own purchase log.
 */
export const SALE_COST_LOTS_SQL = `
  select a.id, a.name,
         a.attributes->>'material' as material,
         a.attributes->>'category' as category,
         coalesce(
           (select min(p.timestamp) from log_asset ls
              join log p on p.id = ls.log_id
                   and p.type = 'purchase' and p.deleted_at is null
             where ls.asset_id = a.id and ls.role = 'subject'),
           a.created_at) as purchased_at,
         (select sum(q.value) from log_asset ls
            join log p on p.id = ls.log_id
                 and p.type = 'purchase' and p.deleted_at is null
            join quantity q on q.log_id = p.id
                 and q.deleted_at is null and q.measure = 'price'
           where ls.asset_id = a.id and ls.role = 'subject') as price,
         (select max(q.value) from log_asset ls
            join log p on p.id = ls.log_id
                 and p.type = 'purchase' and p.deleted_at is null
            join quantity q on q.log_id = p.id
                 and q.deleted_at is null and q.measure = 'weight'
           where ls.asset_id = a.id and ls.role = 'subject') as bought
    from asset a
   where a.type = 'lot'
     and a.farm_id = (select id from active_farm)
     and a.deleted_at is null
     and (a.attributes->>'category' = $1
          or a.id in (
            select li.asset_id from log_asset li
              join log l on l.id = li.log_id
                   and l.type = 'input_application'
                   and l.deleted_at is null and l.status = 'done'
              join log_asset s on s.log_id = l.id and s.role = 'subject'
              join asset sa on sa.id = s.asset_id
             where li.role = 'input'
               and sa.attributes->>'species' = $1))`
