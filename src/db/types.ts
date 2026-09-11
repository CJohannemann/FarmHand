export type AssetType =
  | 'animal' | 'group' | 'planting' | 'land' | 'equipment' | 'structure' | 'lot'

export type AssetRole = 'subject' | 'input' | 'output'

export type Measure =
  | 'weight' | 'count' | 'volume' | 'area' | 'length'
  | 'temperature' | 'price' | 'time'
  // An hour meter's cumulative reading (a tractor's engine hours) — distinct
  // from 'time', which is a duration (labor spent), not an odometer.
  | 'hours'

export interface Asset {
  id: string
  type: AssetType
  name: string
  status: 'active' | 'archived'
  terminal_event: string | null
  parent_id: string | null
  attributes: Record<string, unknown>
}

export interface LogRow {
  id: string
  type: string
  timestamp: string
  status: 'planned' | 'done' | 'cancelled'
  name: string | null
  notes: string | null
}

export interface LogWithDetail extends LogRow {
  subjects: string | null
  /** What was drawn on to do it — a feeding's lot, a processing's inputs. */
  uses: string | null
  summary: string | null
  /** What a one-off service lot (a vet visit, a repair) used here cost. */
  cost: string | null
  /** Whoever entered this record — an auth user id, or null on a
   * local-only install with no accounts to distinguish. */
  created_by: string | null
  /** When it was actually entered, as opposed to `timestamp`, which is
   * whenever the person logging it says the event happened and can be
   * backdated freely. */
  created_at: string
  /** Whoever last made a real change to this record after it was created,
   * or null if it never has been. */
  edited_by: string | null
  edited_at: string | null
  /** Who bought it, on a sale or a sold disposition — null on everything
   * else, and on a sale recorded without one. */
  buyer: string | null
}

export interface QuantityInput {
  measure: Measure
  value: number
  unit: string
  label?: string
}

/** A buyer (or anyone else worth keeping a phone number and email for). */
export interface Contact {
  id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
}
