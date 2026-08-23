export type AssetType =
  | 'animal' | 'group' | 'planting' | 'land' | 'equipment' | 'structure' | 'lot'

export type AssetRole = 'subject' | 'input' | 'output'

export type Measure =
  | 'weight' | 'count' | 'volume' | 'area' | 'length'
  | 'temperature' | 'price' | 'time'

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
  summary: string | null
}

export interface QuantityInput {
  measure: Measure
  value: number
  unit: string
  label?: string
}
