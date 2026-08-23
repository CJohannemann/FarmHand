# FarmHand Domain Model

Draft. This document exists to settle the schema *before* any UI is built, so
that adding a new kind of farming later is a data change, not a rewrite.

## Principle

Five abstractions cover essentially all of farming:

| Concept | What it is |
|---|---|
| **Asset** | A thing you manage over time |
| **Location** | Where assets are, hierarchically |
| **Log** | A dated event involving assets — *the spine* |
| **Quantity** | A typed measurement attached to a log |
| **Term** | User-extensible vocabulary (species, varieties, treatments) |

New farm types should require new **Terms**, not new tables.

---

## 1. Asset

Anything managed over time. One table, discriminated by `type`.

```
Asset
  id
  farm_id            -- tenant isolation, on every table
  type               -- animal | group | planting | land | equipment | structure | lot
  name
  status             -- active | archived
  terminal_event     -- null | sold | died | culled | harvested | consumed
  parent_id          -- optional; e.g. an animal belonging to a group
  attributes         -- JSON; type-specific and user-defined fields
  created_at, updated_at, deleted_at
```

### Asset types

- **animal** — an individually tracked animal. Tag number, sex, birth date, breed.
- **group** — a batch tracked collectively: a flock of broilers, a hive, a pen of
  weaners. Has a headcount rather than an identity.
- **planting** — a crop in a place for a season. Variety, seeding date, expected harvest.
- **land** — field, paddock, bed, greenhouse, pasture. Also acts as a Location.
- **equipment** — tractor, mower, waterer. Carries maintenance logs.
- **structure** — barn, coop, hoop house, fence line.
- **lot** — a quantity of material. Either `purchased` (feed, seed, medicine,
  fuel) or `produced` (meat in the freezer, eggs in the fridge, hay in the barn).
  Carries cost, supplier, and disposition. See section 6.

### Individual vs. group is not optional

Dairy cattle are tracked one at a time; broilers and lettuce only ever in
batches. A model supporting only individuals fails poultry. Only groups fails
livestock. Both exist from day one, and an `animal` may optionally belong to a
`group` via `parent_id`.

---

## 2. Location

Hierarchical containers. Pasture rotation and bed rotation are the same mechanic.

```
Location
  id, farm_id
  name
  type               -- farm | field | paddock | bed | barn | pen | greenhouse
  parent_id          -- nests arbitrarily deep
  geometry           -- optional GeoJSON; deferred, but reserve the column
```

Asset placement is **not** a column on Asset — it is derived from movement logs,
so that location history is preserved. "Where is this animal" is a query for its
most recent movement log.

---

## 3. Log — the spine

A dated record of something that happened, or is planned to happen.

```
Log
  id, farm_id
  type               -- see below
  timestamp
  status             -- planned | done | cancelled
  name               -- short summary
  notes
  location_id
  created_by
  attributes         -- JSON; type-specific fields
  created_at, updated_at, deleted_at

LogAsset            -- many-to-many; one log can touch many assets
  log_id, asset_id, role   -- role: subject | input | output
```

### Log types

`observation` `activity` `harvest` `seeding` `transplant` `input_application`
`birth` `death` `weight` `breeding` `movement` `sale` `purchase` `maintenance`
`processing` `disposition`

### Planned and done are the same table

A log with `status = planned` is a task on the calendar. The same row flips to
`done` when the work happens. This gives scheduling, task lists, and history from
one structure — and it is genuinely painful to add later.

### Why roles matter

`role` on LogAsset is what makes traceability fall out for free. A feeding log
has the feed lot as `input` and the flock as `subject`. A harvest has the
planting as `subject` and a new lot as `output`. Follow the graph backward
from a carton of eggs and you reach the feed lot and its supplier.

---

## 4. Quantity

Typed measurements hang off logs. Units are typed from the start — retrofitting
unit handling is a classic and avoidable disaster.

```
Quantity
  id, log_id
  measure            -- weight | count | volume | area | length | temperature | price | time
  value              -- decimal
  unit               -- kg | lb | head | gal | L | acre | ha | USD ...
  label              -- optional, e.g. "morning milking"
  asset_id           -- optional; attributes this quantity to one asset in the log
```

Money is just `measure = price`. That is how cost-per-animal, cost-per-bed and
enterprise profitability come out of the same structure as everything else,
rather than needing a parallel accounting system.

---

## 5. Term

User-extensible vocabularies. The escape hatch that makes "all farm types" real.

```
Term
  id, farm_id        -- farm_id null = system-provided default
  vocabulary         -- species | breed | variety | treatment | unit | log_category | supplier
  name
  parent_id          -- vocabularies may be hierarchical
```

Combined with `attributes` JSON on Asset and Log, a beekeeper can add
hive-specific fields and a "queen replaced" log category without a migration.

---

## 6. Lots and disposition

A **lot** is a quantity of material. The insight is that purchased inputs and
farm-produced product are the same shape — both are a measured quantity with a
cost, a date, and an eventual fate.

```
Asset(type = lot)
  attributes:
    origin           -- purchased | produced
    material         -- Term: feed | seed | medicine | meat | eggs | hay | milk
    source_log_id    -- for produced lots, the harvest/slaughter log that made it
    supplier_id      -- for purchased lots
```

A produced lot is created as the `output` of a harvest log, and the assets
consumed to make it are that same log's `subject`. That single link is what
carries cost forward: the broiler flock's accumulated feed cost flows into the
meat lot it became.

### Disposition

Product leaves the farm — or doesn't — in several ways, and a model that only
knows "sold" cannot cost a homestead. Disposition is a log type:

```
Log(type = disposition)
  attributes:
    kind             -- sold | home_use | given | traded | lost | fed_back
  Quantity(weight or count)   -- how much left the lot
  Quantity(price)             -- actual revenue, or imputed retail value for home_use
```

`home_use` with an imputed value is what answers *"what did this cost me versus
buying it?"* — the question small farms care about most and spreadsheets handle
worst. `fed_back` covers produce or milk returned to livestock, which is common
and otherwise vanishes from the books.

---

## 7. Processing — turning one thing into another

Most of homesteading, and a good deal of small-farm value-adding, is
transformation: raw product in, preserved or butchered product out. Without an
explicit concept for it, the freezer is a dead end.

```
Log(type = processing)
  LogAsset role `input`     -- lots and/or animals consumed
  LogAsset role `output`    -- lots produced
  Quantity(time)            -- labour spent
  attributes:
    method                  -- Term: canning | freezing | butchering | curing |
                               fermenting | rendering | pressing | drying | milling
```

Inputs are consumed in whole or in part; outputs are new lots whose cost is the
summed cost of the inputs — including incidental ones such as jars, salt, sugar
or fuel, which are themselves purchased lots listed as `input`.

**Yield is the number worth capturing.** 100 lb of tomatoes becoming 24 quarts of
sauce is the ratio that tells you next season how much to plant. It is derived —
output quantity over input quantity — not stored.

Processing chains. A pig becomes cuts, lard and trim; the trim becomes sausage;
the belly becomes bacon. Each step is another `processing` log whose inputs are
the previous step's outputs, and cost follows the chain the whole way down.

### Why this serves both audiences

A homesteader canning tomatoes and a creamery making cheese perform the same
operation at different scales. Processing is not a homesteading feature bolted
onto a farm app — it is the general case, and commercial value-adding is one
instance of it.

---

## Worked examples

These are the test of whether the model generalises. Each is expressed only in
the five abstractions above.

**Dairy cow, daily milking**
Asset(animal) "Bluebell". Log(`weight`, done) with Quantity(volume, 24, L,
label "morning milking"), asset role `subject`.

**Broiler flock, feed cost**
Asset(group) "Batch 14", headcount 200. Asset(lot, purchased) "Grower feed, lot 88"
with Quantity(price, 340, USD) on its purchase log. Log(`input_application`)
links feed lot as `input`, flock as `subject`. Cost per bird is a query.

**Market garden bed**
Asset(land) "Bed 7" and Location "Bed 7". Asset(planting) "Salanova, Apr sowing".
Log(`seeding`, planned → done), Log(`harvest`, done) with Quantity(weight, 18, kg).

**Orchard spray with withdrawal period**
Log(`input_application`) linking Asset(lot, purchased) "Copper fungicide" as `input`
and the planting as `subject`; `attributes.withdrawal_days = 14` drives a
compliance warning on harvest logs inside the window.

**Beehive inspection**
Asset(group) "Hive 3". Log(`observation`) with Term(log_category, "inspection"),
`attributes` holding brood pattern and mite count. No schema change required.

**A 12.5-acre mixed homestead (the reference case)**
Five Asset(animal) cattle, individually tagged. Four Asset(animal) pigs sharing
one Asset(group) "Spring pigs" as parent. Asset(group) "Layers", headcount 20,
producing Log(`harvest`) with Quantity(count, eggs) on a weekly cadence.
Asset(group) "Spring broilers", headcount 75, status `archived`, terminal_event
`harvested` — its slaughter Log(`harvest`) produced Asset(lot, produced) "Broiler
meat, spring batch" with Quantity(weight, lb). Freezer withdrawals are
Log(`disposition`, kind `home_use`) against that lot. Cost per pound is the
flock's feed lots, divided by the meat lot's starting weight.

**Butchering and preserving (the homestead case)**
Log(`processing`, method `butchering`) takes Asset(animal) "Pig 2" as `input`
and produces several Asset(lot, produced) outputs — "Chops", "Bacon belly",
"Lard", "Trim" — each with Quantity(weight, lb). A later
Log(`processing`, method `curing`) consumes the belly lot plus
Asset(lot, purchased) "Cure salt" and produces "Bacon". Cost per pound of bacon
traces back through both logs to the pig's feed. Jars of sauce work identically:
tomato lot plus jars and lids in, sauce lot out, yield ratio derived.

---

## Sync notes

Logs are append-only in practice: that you fed the herd on Tuesday does not
change. Append-only records rarely conflict, so the model that makes FarmHand
cover every farm type also makes offline sync tractable. Edit-heavy data
(asset details) is a small minority and can take last-write-wins.

Every table carries `farm_id` for tenant isolation and `deleted_at` for soft
deletes, because hard deletes and sync do not mix.

---

## Open questions

- Whether `land` is an Asset, a Location, or both. Currently both, which is
  slightly redundant but matches how farmers talk about fields.
- Whether group headcount is a column or derived from birth/death/sale logs.
  Derived is purer; a cached column is far faster. Probably both.
- Whether a lot needs its own table rather than an Asset subtype, once
  part-lot withdrawals and running balances get heavy use.
- Partial consumption of a lot: whether an input lot is consumed wholly or by
  amount needs a quantity on the LogAsset join, not just on the log.
- Labour tracking: `measure = time` on quantities may be enough, or may need
  its own treatment once payroll enters the picture.
