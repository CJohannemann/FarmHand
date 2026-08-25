# Code review — 25 August 2026

A review of the uncommitted working tree (18 modified files, 9 new) found 11
issues. Nine are fixed; two are left open below because they are decisions
rather than defects.

Most of these were introduced by the same batch of work that shipped
individual animal records, the Analytics tab and the Equipment pages. The
pattern is consistent and worth naming: **`createGroupWithMembers` changed
what a group *is*, and several places still treated it as a bare headcount.**
Findings 2, 3 and 10 are all that one change meeting older code.

---

## Fixed

### 1. "Sold / retired" failed for two of its three options

`RetireForm` offered Sold, Retired and Scrapped, but `asset.terminal_event`
is constrained to a livestock-flavoured list that never anticipated
equipment:

```sql
check (terminal_event in
  ('sold','died','culled','harvested','consumed','processed'))
```

Picking Retired or Scrapped violated the constraint. `save()` had no
`catch`, so the promise rejected unhandled: the sheet stayed open, the asset
was never archived, and nothing on screen said why. Only Sold worked.

**Fix:** `db/migrations/007_equipment_terminal.sql` extends the constraint
with `retired` and `scrapped`; `db/schema.sql` matches. The migration drops
and re-adds by name, so it is safe on every app start.

> ⚠️ **Supabase needs this applied manually.** Until it is, a synced
> "Retired" will be rejected by the server even though it succeeded locally.

### 2. Selling a flock left every bird active

Groups now carry one real `animal` per head. Close out archived only the
group row, so the members stayed `status = 'active'` — each still carrying
`species: 'Chicken'`, `purpose: 'eggs'`.

Two consequences: `tilesFor()` scans every active asset, so the Eggs tile
stayed on Today forever for birds that were gone; and the Stock list hides
anything with a `parent_id`, so those birds were unreachable except through
the archived group.

**Fix:** `archiveAsset()` archives live members too. A bird that had already
been closed out keeps the ending it was given — one that died in June is not
relabelled "sold" in October.

### 3. "Name an individual" grew the herd

`SplitForm` predated member-backed groups. It created a **new** animal and
then decremented an `attributes.headcount` that such groups do not have, so
`Math.max(0 - 1, 0)` wrote `headcount: 0`. Both readouts use
`liveMembers || attributes.headcount`, and `liveMembers` had just gone up.

Naming one cow out of three displayed **four head** — the exact double-count
the function's own doc comment claimed to prevent.

**Fix:** it renames an existing member, which is what the action always meant.
Only still-unnamed members (`"<group> <n>"`) are offered, so a name someone
chose is never recycled. The old create-and-decrement path is kept for
groups stored as a bare headcount before this change.

### 4. Editing a turkey pen turned it into a laying flock

```js
if (wantsSpecies && purposeOptions && purpose) attributes.purpose = purpose
else delete attributes.purpose          // ← fires when purposeOptions is undefined
```

Setup seeds Goose and Turkey as `purpose: 'meat'` without offering chips, and
neither is in `SPECIES_PURPOSES` — so `purposeOptions` was `undefined` and
**any** save stripped `purpose`. `producibleMaterial()` reads an absent
purpose on a bird as "lays eggs", so a rename produced a bogus Eggs tile on
Today and a Collect → Eggs button on the pen.

**Fix:** `purpose` is only touched where the form actually offered chips for it.

### 5. A custom species was assumed to produce

`category` was treated as equal to `species`:

```js
const isDairyish = MILKERS.includes(species) || a.attributes?.category === 'livestock'
if (isDairyish && (purpose === undefined || purpose === 'dairy')) return 'milk'
```

Anything typed under Setup's Livestock heading — an alpaca, a llama — arrived
with a Milk tile purely for having been added on that page. Meanwhile the
curated `Pig` row, which sets no `category`, correctly produced nothing.

**Fix:** `category` is now weaker than `species`. "I keep this under
Livestock" is not a claim that it gives milk, so a category-only match must
state its purpose; an unset purpose there yields nothing.

### 6. The one non-skippable step could wedge permanently

`StockStep.save` set `busy` and then ran a long unguarded chain of awaits.
Any rejection skipped both `setBusy(false)` and `onNext()`, leaving the
finish button disabled forever on a half-written farm — on the one step with
no Skip.

**Fix:** `try/catch/finally` with a visible message, matching the pattern the
location step already used. `EditAsset.save`/`remove` had the same shape and
got the same treatment.

### 7. A big flock was inserted one bird at a time

`createGroupWithMembers` looped `createAsset`, so a 500-bird flock was 501
sequential round-trips — each re-reading the farm id and firing its own
outbox trigger — behind a disabled button with no progress shown.

**Fix:** chunked multi-row inserts. 250 birds now take **2 statements
instead of 250**. Chunked at 200 because each row costs four bind
parameters. No cap imposed: a 500-bird flock is a real farm.

### 8. Every vet bill piled up in Stores forever

`InputForm` called `createPurchase` with a cost but no amount, so the lot got
only a `price` quantity. `lotBalances()` sums just `weight`/`count`/`volume`
for `came_in`, leaving `remaining = 0` — filed under "Used up" permanently. A
year of vet visits and oil changes accumulated there as junk.

**Fix:** those lots are marked `origin: 'service'` and excluded from
`lotBalances()`. They are spent the moment they are recorded, so they were
never stock. **Cost accounting is unaffected** — `assetCosts()` reads the
purchase log directly, and a test pins that the $75 still counts.

### 9. Unrounded floats shown to the user

The new "on hand" hints printed raw `::float` sums: buy 100 lb, feed 33.3
three times, and the hint read `0.10000000000000853 lb on hand`.

**Fix:** `roundQty` moved into `src/lib/numeric.ts` and shared. Stores'
private `round` helper now points at it rather than duplicating it.

### 10. Editing a group's headcount was a silent no-op

Covered by the fix for #3 — both readouts prefer `liveMembers`, so the
written `headcount` was ignored with no indication the edit had not taken.

---

## Open — decisions, not defects

### 11. A named-out animal cannot have feed logged against it

`AssetSelect` excludes group members (correctly — it was showing duplicates),
and there is no Feed action on a profile; Weigh and Vet/Med cover the other
two. So `assetCosts()` for a named animal can never accrue feed cost, which
undercuts the stated reason for naming one out.

Two ways forward, both reasonable:

- add a **Feed** button to the individual's profile, matching Weigh and Vet/Med; or
- let members back into the picker, accepting a longer list.

### Supabase schema drift

Migration 007 alters a constraint. It runs automatically against the local
PGlite database on every app start, but the hosted Supabase instance needs it
applied by hand. Until then a synced `retired`/`scrapped` will be rejected
server-side.

---

## Test coverage added

The review caught what the tests did not, so the gaps are now pinned. Each
new check was confirmed to **fail** when its fix is reverted — a test that
has never failed has not been shown to test anything.

| Suite | Checks | Covers |
|---|---|---|
| `verify:equipment` *(new)* | 13 | Findings 1, 2, 7, 8 — against a real PGlite database |
| `verify:tiles` *(extended)* | +10 | Findings 4, 5 — purpose and category rules |

`verify-tiles` was also **already failing** before this review, and had been
since Weigh moved off Today onto the animal profile earlier in the session.
Four stale assertions and a now-wrong comment in `tiles.ts` are corrected.

```
npm run verify     # 7 suites
npx tsc --noEmit   # clean
npm run lint       # 0 warnings, 0 errors
```

All 11 fixes were additionally exercised in a real browser against an
isolated dev server — including the herd-count arithmetic, the cascade
archive, and the Retired option that used to throw.
