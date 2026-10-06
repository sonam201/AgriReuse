export type Tab = 'Create Listing' | 'Dashboard' | 'Marketplace' | 'Matches' | 'Transactions' | 'Impact' | 'Profile'
export type Role = 'Supplier' | 'Receiver'
export type GateStatus = 'eligible' | 'restricted' | 'blocked'
export type Gate = [GateStatus, string]

// role = the starting role picked at sign-up; canSupply/canReceive = what the account may list.
export interface Profile {
  id: string; businessName: string; role: Role; location: string | null; canSupply: boolean; canReceive: boolean
}

// ownerId is null for seeded fictional businesses.
export interface Supply {
  id: string; type: 'Supply'; ownerId: string | null; biz: string; mat: string; cond: string
  qty: number; loc: string; price: number; disp: number; chem: string; use: string[]
  from: string; to: string; done: number; res: number; arch: boolean; moveR?: boolean
  deletedAt?: string | null // retired: deleted by its owner but kept for others' exchange history
  // Compliance Check (null/empty on older and seeded listings).
  category?: string | null; suburb?: string | null; answers?: Record<string, string>; declaredAt?: string | null
}

export interface Demand {
  id: string; type: 'Demand'; ownerId: string | null; biz: string; mat: string; use1: string
  min: number; max: number; loc: string; maxKm: number; maxPrice: number; alt: number
  accepts?: string[] | null // categories the buyer takes; empty/null = any kind
  keywords?: string[] | null // materials the buyer wants, e.g. ['banana', 'apple pomace']
  from: string; to: string; arch: boolean
  deletedAt?: string | null
}

export type Listing = Supply | Demand

export interface Settings {
  mult: number; speed: number; cap: number; perkm: number; fixed: number; ret: boolean; subst: number
}

export interface Transaction {
  id: string; s: string; d: string; q: number; price: number; step: number
  supplierId: string | null; receiverId: string | null; proposerId: string | null
  log: [string, string][]; co2: number | null; cx?: 'cancelled' | 'dispute' | null
  // Money result for each side, stored when the exchange completes (null for older/seeded rows).
  supplierBenefit: number | null; receiverBenefit: number | null
}

export interface Notification { id: number; txt: string; read: boolean; tab: Tab }

// An offer on a near-miss pair. from/to are null for fictional (seeded) businesses.
export interface Offer {
  id: string; s: string; d: string; from: string | null; to: string | null; price: number; q: number
  message: string | null; status: 'pending' | 'accepted' | 'declined' | 'countered' | 'withdrawn'
  note: string | null; parentId: string | null; transactionId: string | null; createdAt: string
}

// Shared data from the database plus this viewer's UI state and logistics assumptions.
export interface State {
  me: Profile
  set: Settings; L: Listing[]; T: Transaction[]; N: Notification[]; O: Offer[]
  verified: Record<string, true>
  zone: import('./compliance').DemoZone
  tab: Tab
  // Which side the user is currently acting as (only switchable when the account has both roles).
  view: Role
  inputMode?: 'chat' | 'form' // how this viewer prefers to create listings
  q?: string; ft?: 'All' | 'Supply' | 'Demand'; lim?: number
}

export interface Econ {
  t: number; dist: number; ck: number; tc: number; sup: number; rec: number
  disp: number; alt: number; tr: number; pr: number; net: number; lo: number; hi: number; mins: number
}

export type Factor = [string, number, number]

interface MatchBase { s: Supply; d: Demand; g: Gate; key: string }
// Why a pair didn't match. Offers can stretch 'price', 'distance' and 'min'; the rest are hard limits.
export type BlockKind = 'location' | 'compliance' | 'category' | 'use' | 'min' | 'dates' | 'distance' | 'price'
export type Match =
  | (MatchBase & { block: string; kinds?: BlockKind[] })
  | (MatchBase & { block: null; q: number; e: Econ; fac: Factor[]; score: number; notes: string[] })

// The editable listing form. Numbers stay strings while typing; publish() converts and validates.
export interface Draft {
  type: 'Supply' | 'Demand'; mat: string; cond: string; qty: number | string; loc: string
  from: string; to: string
  // Supply
  price: number | string; disp: number | string; chem: string; uses: string[]
  // Demand
  use1: string; min: number | string; maxKm: number | string; maxPrice: number | string; alt: number | string
  raw: string
  // Compliance Check (supply only)
  category: string; suburb: string; answers: Record<string, string>; declared: boolean
  accepts: string[] // demand only: accepted categories (empty = any)
  keywords: string // demand only: comma-separated materials wanted
  source?: 'ai' | 'rules' // how the fields were filled, shown to the user
  notes?: string          // anything the assistant couldn't map (e.g. an unsupported town)
  editId?: string         // set when editing an existing listing
}
