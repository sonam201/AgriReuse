import type { Listing, Settings, Tab, Transaction } from './types'

// Per-viewer UI state (tab, filters, logistics assumptions); shared data lives in Supabase.
export const STORAGE_KEY = 'agrireuse-ui'
export const REF = '2026-10-03'

export const CITY: Record<string, [number, number]> = {
  Pukekohe: [-37.2, 174.95], Hastings: [-39.64, 176.84], Whangarei: [-35.73, 174.32], Rotorua: [-38.14, 176.25],
  Nelson: [-41.27, 173.28], Hamilton: [-37.78, 175.28], Auckland: [-36.85, 174.76], Tauranga: [-37.69, 176.17],
  Cambridge: [-37.89, 175.47], 'Palmerston North': [-40.36, 175.61],
}

// kg CO2e/t, kg/km/trip: ILLUSTRATIVE demo assumptions, not sourced
export const EF = { disp: 450, alt: 60, truck: 0.9, proc: 20 }

export const STEPS = ['Terms agreed by both parties', 'Demo payment held', 'Pickup scheduled', 'Pickup confirmed', 'Receipt confirmed', 'Demo payment released', 'Completed']

export const TABS: Tab[] = ['Dashboard', 'Create Listing', 'Marketplace', 'Matches', 'Transactions', 'Impact', 'Profile']

export const DEFAULT_SETTINGS: Settings = { mult: 1.3, speed: 60, cap: 3, perkm: 2.2, fixed: 40, ret: true, subst: 0.7 }

// Fictional seed data. Loaded into the database via scripts/generate-seed.ts -> supabase/seed.sql.
const seed0 = (): { L: Listing[]; T: Transaction[] } => ({
  L: [
    { id: 's2', type: 'Supply', ownerId: null, biz: 'Cambridge Orchard Co (fictional)', mat: 'Apple pomace', cond: 'Post-harvest residue', qty: 3, loc: 'Cambridge', price: 10, disp: 90, chem: 'declared-none', use: ['composting', 'worm farming'], from: '2026-10-05', to: '2026-10-30', done: 1.5, res: 0, arch: false },
    { id: 's3', type: 'Supply', ownerId: null, biz: 'Manawatu Grains (fictional)', mat: 'Wheat straw', cond: 'Post-harvest residue', qty: 5, loc: 'Palmerston North', price: 0, disp: 40, chem: 'unknown', use: ['composting'], from: '2026-10-06', to: '2026-10-30', done: 0, res: 0, arch: false },
    { id: 's4', type: 'Supply', ownerId: null, biz: 'Franklin Veg Packers (fictional)', mat: 'Vegetable trimmings', cond: 'Transport-damaged', qty: 2, loc: 'Auckland', price: 0, disp: 110, chem: 'declared-none', use: ['feed', 'worm farming'], from: '2026-10-05', to: '2026-10-25', done: 0, res: 0, arch: false },
    { id: 's5', type: 'Supply', ownerId: null, biz: 'Pukekohe Spuds (fictional)', mat: 'Potato waste', cond: 'Unsellable/overripe', qty: 4, loc: 'Pukekohe', price: 0, disp: 100, chem: 'declared-none', moveR: true, use: ['composting'], from: '2026-10-05', to: '2026-10-25', done: 0, res: 0, arch: false },
    { id: 's6', type: 'Supply', ownerId: null, biz: 'Bay Kiwifruit (fictional)', mat: 'Kiwifruit pulp', cond: 'Post-harvest residue', qty: 6, loc: 'Tauranga', price: 40, disp: 30, chem: 'declared-none', use: ['composting'], from: '2026-11-05', to: '2026-11-30', done: 0, res: 0, arch: false },
    { id: 'd1', type: 'Demand', ownerId: null, biz: 'Waikato Compost Co (fictional)', mat: 'Plant material', use1: 'composting', min: 0.5, max: 3, loc: 'Hamilton', maxKm: 120, maxPrice: 30, alt: 45, from: '2026-10-05', to: '2026-10-20', arch: false },
    { id: 'd2', type: 'Demand', ownerId: null, biz: 'Hauraki Feed Mix (fictional)', mat: 'Plant material', use1: 'feed', min: 1, max: 3, loc: 'Tauranga', maxKm: 200, maxPrice: 30, alt: 80, from: '2026-10-05', to: '2026-10-30', arch: false },
    { id: 'd3', type: 'Demand', ownerId: null, biz: 'Auckland Worm Farm (fictional)', mat: 'Plant material', use1: 'worm farming', min: 1, max: 2, loc: 'Auckland', maxKm: 80, maxPrice: 20, alt: 35, from: '2026-10-05', to: '2026-10-30', arch: false },
    { id: 'd4', type: 'Demand', ownerId: null, biz: 'Manawatu Mulch (fictional)', mat: 'Plant material', use1: 'composting', min: 10, max: 20, loc: 'Palmerston North', maxKm: 300, maxPrice: 25, alt: 30, from: '2026-10-05', to: '2026-10-30', arch: false },
  ],
  T: [{ id: 't0', s: 's2', d: 'd1', q: 1.5, price: 10, step: 6, log: [['Completed (seed)', '2026-09-20']], co2: null, supplierId: null, receiverId: null, proposerId: null, supplierBenefit: null, receiverBenefit: null }],
})

// Deterministic generator so every reset produces the same synthetic listings.
function generate(): Listing[] {
  let x = 7
  const r = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648
  const pk = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const C = Object.keys(CITY)
  const M: [string, string, number, number][] = [
    ['Apple pomace', 'Post-harvest residue', 10, 90], ['Grape marc', 'Post-harvest residue', 5, 70], ['Onion trimmings', 'Transport-damaged', 0, 110],
    ['Carrot tops', 'Post-harvest residue', 0, 80], ['Overripe avocados', 'Unsellable/overripe', 0, 130], ['Citrus peel', 'Post-harvest residue', 8, 60],
    ['Maize stover', 'Post-harvest residue', 0, 45], ['Pea vines', 'Post-harvest residue', 0, 50], ['Overripe tomatoes', 'Unsellable/overripe', 0, 140],
    ['Brassica leaves', 'Transport-damaged', 0, 95],
  ]
  const P = ['Green Valley', 'Hillside', 'Riverbend', 'Kauri Ridge', 'Sunny Flats', 'Tui Creek', 'Otago Fields', 'Harbour View', 'Southern Cross', 'Pohutukawa']
  const K = ['Orchards', 'Growers', 'Farms', 'Packers', 'Produce']
  const D = ['Compost Co', 'Worm Farm', 'Feed Mix', 'Mulch Ltd']
  const o: Listing[] = []
  for (let i = 7; i <= 50; i++) {
    const m = pk(M), u = r()
    o.push({
      id: 's' + i, type: 'Supply', ownerId: null, biz: P[i % 10] + ' ' + K[Math.floor(i / 10) % 5] + ' (fictional)', mat: m[0], cond: m[1],
      qty: +(0.5 + r() * 7).toFixed(1), loc: pk(C), price: m[2], disp: m[3], chem: r() < 0.15 ? 'unknown' : 'declared-none',
      moveR: r() < 0.04, use: u < 0.2 ? ['feed', 'composting'] : ['composting', 'worm farming'],
      from: '2026-10-' + String(5 + Math.floor(r() * 12)).padStart(2, '0'), to: '2026-10-30', done: 0, res: 0, arch: false,
    })
  }
  for (let i = 5; i <= 40; i++) {
    const mn = +(0.5 + r() * 2).toFixed(1), u = r()
    o.push({
      id: 'd' + i, type: 'Demand', ownerId: null, biz: P[i % 10] + ' ' + D[Math.floor(i / 10) % 4] + ' (fictional)', mat: 'Plant material',
      use1: u < 0.15 ? 'feed' : u < 0.6 ? 'composting' : 'worm farming', min: mn, max: +(mn + 1 + r() * 4).toFixed(1),
      loc: pk(C), maxKm: pk([80, 120, 200, 300]), maxPrice: pk([15, 25, 40]), alt: pk([30, 45, 60, 80]),
      from: '2026-10-05', to: '2026-10-30', arch: false,
    })
  }
  return o
}

export function seed() {
  const o = seed0()
  o.L.push(...generate())
  return o
}
