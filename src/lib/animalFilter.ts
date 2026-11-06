/**
 * Records' "which animal?" filter.
 *
 * The choice is one animal, one group, or a whole species — and what counts
 * as touching it follows how the farm actually logs things. A pen fed as
 * one ("Fed Pigs") is a feeding of every pig in it, so picking one of those
 * pigs has to include it; picking the pen has to include what was logged
 * against any one of its members (a weigh-in, a vet visit).
 *
 * Pure, so db/test/verify-animal-filter.ts can pin it down.
 */

export interface FilterAnimal {
  id: string
  type: string
  parent_id: string | null
  attributes: Record<string, unknown>
}

/** A picked value: an asset id, or a whole species. */
export const SPECIES_FILTER = 'species:'

/**
 * Every asset id a log may name for it to count as being about `picked`.
 * Null means no filter.
 */
export function idsForAnimalFilter(picked: string, assets: FilterAnimal[]): Set<string> | null {
  if (!picked) return null
  const ids = new Set<string>()
  if (picked.startsWith(SPECIES_FILTER)) {
    const species = picked.slice(SPECIES_FILTER.length)
    for (const a of assets) {
      if ((a.type === 'animal' || a.type === 'group')
          && String(a.attributes?.species ?? '') === species) ids.add(a.id)
    }
    return ids
  }
  ids.add(picked)
  const self = assets.find((a) => a.id === picked)
  // One animal: also its group, for whatever was logged against the group.
  if (self?.parent_id) ids.add(self.parent_id)
  // A group: also each member, for whatever was logged against just one.
  for (const a of assets) if (a.parent_id === picked) ids.add(a.id)
  return ids
}

/** Whether a log whose subjects are `subjectIds` (comma-separated) is about the pick. */
export function logMatchesAnimal(subjectIds: string | null | undefined, ids: Set<string> | null): boolean {
  if (!ids) return true
  if (!subjectIds) return false
  return subjectIds.split(',').some((id) => ids.has(id))
}
