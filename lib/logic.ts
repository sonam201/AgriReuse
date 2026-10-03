import { CITY, EF } from './data'
import { ALL_USES, CATEGORIES, USE_LABELS, evaluate } from './compliance'
import type { BlockKind, Demand, Draft, Econ, Factor, Gate, Listing, Match, Role, State, Supply, Transaction } from './types'

export const f1 = (x: number | string) => (+x).toFixed(1)
export const money = (x: number) => (x < 0 ? '−' : '') + '$' + Math.abs(x).toFixed(0)
export const avail = (l: Supply) => +(l.qty - l.done - l.res).toFixed(3)

export const listing = (S: State, id: string) => S.L.find(l => l.id == id) as Listing
export const supplies = (S: State) => S.L.filter((l): l is Supply => l.type == 'Supply')
export const demands = (S: State) => S.L.filter((l): l is Demand => l.type == 'Demand')
export const businessCount = (S: State) => new Set(S.L.map(l => l.biz)).size

// Straight-line (haversine) distance between cities, scaled by the road multiplier.
// Infinity for a town we can't place, so callers treat it as out of range instead of crashing.
export function km(S: State, a: string, b: string) {
  if (!CITY[a] || !CITY[b]) return Infinity
  const [p, q] = CITY[a], [r, s] = CITY[b], t = (x: number) => x * Math.PI / 180
  const h = Math.sin(t(r - p) / 2) ** 2 + Math.cos(t(p)) * Math.cos(t(r)) * Math.sin(t(s - q) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h)) * S.set.mult
}

// The listing's Compliance Check result, re-evaluated live (e.g. when the demo zone is switched on).
export const complianceOf = (S: State, s: Supply) => evaluate(s.category, s.answers ?? {}, s.suburb, S.zone)

export function gate(S: State, s: Supply, d: Demand, key: string): Gate {
  if (s.moveR) return ['blocked', 'Movement-restricted (simulated biosecurity scenario). Excluded from matching; cannot transact.']
  const c = complianceOf(S, s)
  if (c.level == 'blocked') return ['blocked', c.rules.filter(r => r.level == 'blocked').map(r => `${r.message} (${r.source})`).join(' ')]
  const need: string[] = []
  if (s.chem === 'unknown') need.push('Chemical history unknown: test result required')
  if (d.use1 === 'feed' || d.use1 === 'pig feed') need.push('Animal-feed pathway: lab/residue evidence required (declaration is not enough)')
  for (const r of c.rules) if (r.checkUses?.includes(d.use1)) need.push(`${r.message} (${r.source})`)
  if (need.length && !S.verified[key]) return ['restricted', need.join('; ')]
  return ['eligible', 'Required demo info present, no blocking issue. Not certification.']
}

// price: the agreed price per tonne (an accepted offer can differ from the listing's price).
export function econ(S: State, s: Supply, d: Demand, q: number, payer: 'receiver' | 'supplier' = 'receiver', price = s.price): Econ {
  const t = Math.ceil(q / S.set.cap), dist = km(S, s.loc, d.loc), ck = dist * (S.set.ret ? 2 : 1), tc = t * (S.set.fixed + ck * S.set.perkm)
  const sp = payer == 'supplier' ? tc : 0, rp = payer == 'receiver' ? tc : 0
  const sup = q * price + q * s.disp - sp, rec = q * d.alt - q * price - rp
  const disp = q * EF.disp, alt = q * S.set.subst * EF.alt, tr = t * ck * EF.truck, pr = q * EF.proc
  const net = disp + alt - tr - pr, lo = disp * 0.6 + alt * 0.6 - tr - pr, hi = disp * 1.4 + alt * 1.4 - tr - pr
  return { t, dist, ck, tc, sup, rec, disp, alt, tr, pr, net, lo, hi, mins: Math.round(dist / S.set.speed * 60) }
}

// A supply's category: the one chosen when listing, or inferred from the material name for
// older/seeded listings (null when it can't be told).
const INFER: [RegExp, string][] = [
  [/pomace|marc|peel|pulp|trimming|by-?product/i, 'processing'],
  [/straw|stover|vine|pruning|stalk|husk|residue|tops/i, 'crop_residue'],
  [/hay|silage|baleage|grain|feed/i, 'spare_feed'],
  [/manure|bedding|effluent/i, 'animal_waste'],
  [/fruit|veg|banana|apple|avocado|tomato|potato|onion|kiwi|citrus|brassica|lettuce|carrot/i, 'fruit_veg'],
]
export const categoryOf = (s: Supply): string | null => s.category || INFER.find(([re]) => re.test(s.mat))?.[1] || null
const PERISHABLE = ['fruit_veg', 'processing']
const catLabel = (id: string) => CATEGORIES.find(c => c.id == id)?.label.toLowerCase() ?? id

export function match(S: State, s: Supply, d: Demand): Match | null {
  if (s.arch || d.arch) return null
  if (s.ownerId && s.ownerId == d.ownerId) return null // an account can't trade with itself
  // Buyers whose use isn't allowed are hidden (a fully blocked listing still shows as "Not allowed").
  const comp = complianceOf(S, s)
  if (comp.level != 'blocked' && comp.hidden.has(d.use1)) return null
  const why: string[] = [], kinds: BlockKind[] = [], q = Math.min(avail(s), d.max)
  const no = (k: BlockKind, reason: string) => { kinds.push(k); why.push(reason) }
  const key = s.id + d.id, g = gate(S, s, d, key)
  if (!CITY[s.loc] || !CITY[d.loc]) return { s, d, g, key, block: 'Location not recognised', kinds: ['location'] }
  if (g[0] == 'blocked') return { s, d, g, key, block: s.moveR ? 'Movement restricted' : 'Not allowed: ' + g[1], kinds: ['compliance'] }
  const cat = categoryOf(s), accepts = d.accepts ?? []
  if (accepts.length && cat && !accepts.includes(cat)) no('category', `Buyer only takes ${accepts.map(catLabel).join(' / ')}`)
  if (!s.use.includes(d.use1)) no('use', 'Intended use (' + d.use1 + ') not an accepted pathway')
  if (q < d.min) no('min', 'Quantity: ' + f1(q) + ' t available vs ' + d.min + ' t minimum')
  if (s.from > d.to || s.to < d.from) no('dates', 'Availability dates do not overlap')
  const dist = km(S, s.loc, d.loc)
  if (dist > d.maxKm) no('distance', 'Distance ' + f1(dist) + ' km exceeds ' + d.maxKm + ' km limit')
  if (s.price > d.maxPrice) no('price', `Price $${s.price}/t is above the buyer's $${d.maxPrice}/t limit`)
  if (why.length) return { s, d, g, key, block: why.join('; '), kinds }

  const e = econ(S, s, d, q)
  // Every factor varies between matches (none is "always full marks"), so scores spread out.
  const categoryFit = !accepts.length ? 0.7 : cat ? 1 : 0.5 // named category beats "takes anything"
  const savings = d.alt > 0 ? e.rec / (q * d.alt) : 1 - s.price / Math.max(1, d.maxPrice) // share of the buyer's usual cost saved
  const perishable = !!cat && PERISHABLE.includes(cat)
  const start = [s.from, d.from, today()].sort().pop()!
  const horizon = perishable ? 14 : 45 // produce loses value fast; residues and feed keep
  const timing = 1 - Math.min(daysUntil(start), horizon) / horizon
  const fac: Factor[] = [
    ['Category fit', 20, categoryFit],
    ['Quantity', 20, Math.min(1, q / d.max)],
    ['Distance', 20, 1 - dist / d.maxKm],
    ['Buyer savings', 20, Math.min(1, savings)],
    [perishable ? 'Freshness (sooner is better)' : 'Timing', 20, timing],
  ]
  return { s, d, g, key, block: null, q, e, fac, score: Math.round(fac.reduce((a, [, w, v]) => a + w * Math.max(0, v), 0)) }
}

export function allMatches(S: State): Match[] {
  const o: Match[] = []
  const ds = demands(S)
  supplies(S).forEach(s => ds.forEach(d => { const m = match(S, s, d); if (m) o.push(m) }))
  return o
}

export const completed = (S: State) => S.T.filter(t => t.step == 6)
export const tonnes = (S: State) => completed(S).reduce((a, t) => a + t.q, 0)
export const txCo2 = (S: State, t: Transaction) => t.co2 ?? econ(S, listing(S, t.s) as Supply, listing(S, t.d) as Demand, t.q).net
export const co2 = (S: State) => completed(S).reduce((a, t) => a + txCo2(S, t), 0)


// ---- users, ownership and transaction roles (mirrors the SQL functions) ----
export const listingTypeFor = (role: Role) => role == 'Supplier' ? 'Supply' : 'Demand'
export const isMine = (S: State, l: Listing) => l.ownerId == S.me.id
export const isParty = (S: State, t: Transaction) => [t.supplierId, t.receiverId, t.proposerId].includes(S.me.id)

// Who performs the next step: 0 (terms agreed) is the party that did not propose.
export function stepActor(t: Transaction, next: number): 'supplier' | 'receiver' {
  if (next == 0) return t.proposerId != null && t.proposerId == t.supplierId ? 'receiver' : 'supplier'
  return [1, 4, 5].includes(next) ? 'receiver' : 'supplier'
}

// 'me' = my turn; 'simulated' = the actor is a fictional seeded business, so I act for them; 'waiting' = other user's turn.
export function turn(S: State, t: Transaction): 'me' | 'simulated' | 'waiting' {
  const who = stepActor(t, t.step + 1), id = who == 'supplier' ? t.supplierId : t.receiverId
  return id == S.me.id ? 'me' : id == null ? 'simulated' : 'waiting'
}

// ---- dates ----
// Local calendar date (toISOString would shift NZ dates back a day).
const iso = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('-')
export const today = () => iso(new Date())
export const addDays = (date: string, n: number) => { const d = new Date(date + 'T00:00'); d.setDate(d.getDate() + n); return iso(d) }
const nextWeekday = (day: number) => { const d = new Date(); d.setDate(d.getDate() + ((day - d.getDay() + 7) % 7 || 7)); return iso(d) }

// Form choices shared by the form, the keyword rules and the AI route.
export const CONDITIONS = ['Post-harvest residue', 'Unsellable/overripe', 'Transport-damaged', 'Processing by-product', 'Spare feed', 'Unknown']
export const USES: string[] = [...ALL_USES]

// Common materials the keyword rules recognise (the AI route handles anything else).
const MATERIALS: [RegExp, string][] = [
  [/banana/, 'Overripe bananas'], [/apple/, 'Apple pomace'], [/grape|marc/, 'Grape marc'], [/kiwi/, 'Kiwifruit pulp'],
  [/avocado/, 'Overripe avocados'], [/tomato/, 'Overripe tomatoes'], [/potato/, 'Potato waste'], [/onion/, 'Onion trimmings'],
  [/carrot/, 'Carrot tops'], [/citrus|orange|lemon/, 'Citrus peel'], [/straw/, 'Wheat straw'], [/maize|corn/, 'Maize stover'],
  [/brassica|cabbage|broccoli/, 'Brassica leaves'], [/pea vine|peas/, 'Pea vines'], [/veg/, 'Vegetable trimmings'],
]

// Keyword/regex extraction: the fallback when the AI assistant isn't configured or fails.
export function parse(txt: string): Draft {
  const t = txt.toLowerCase()
  const type = /\b(need|require|looking for|want to buy|seeking)\b/.test(t) ? 'Demand' : 'Supply'
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kg|tonnes?|tons?|t)\b/)
  const loc = Object.keys(CITY).find(c => t.includes(c.toLowerCase())) || ''
  const q = m ? (m[2] == 'kg' ? +m[1] / 1000 : +m[1]) : ''
  const from = /friday/.test(t) ? nextWeekday(5) : /next week/.test(t) ? nextWeekday(1) : today()
  const uses = USES.filter(u => t.includes(u.split(' ')[0].slice(0, 5)))
  return {
    type,
    mat: MATERIALS.find(([re]) => re.test(t))?.[1] ?? (type == 'Demand' ? 'Plant material' : ''),
    cond: /unsellable|overripe|rotten/.test(t) ? 'Unsellable/overripe' : /damaged|bruised/.test(t) ? 'Transport-damaged'
      : /residue|harvest/.test(t) ? 'Post-harvest residue' : 'Unknown',
    qty: q, loc, from, to: addDays(from, 30),
    price: 0, disp: '', chem: 'unknown',
    uses: uses.length ? uses : ['composting', 'worm farming'],
    use1: uses[0] ?? 'composting', min: q === '' ? '' : +(+q / 2).toFixed(2), maxKm: 120, maxPrice: 30, alt: 45,
    category: '', suburb: '', answers: {}, declared: false, accepts: [],
    raw: txt, source: 'rules',
  }
}

// Matches for the side I'm acting as: my supply when viewing as Supplier, my demand as Receiver.
export const myMatches = (S: State) => allMatches(S).filter(m => (S.view == 'Supplier' ? m.s : m.d).ownerId == S.me.id)

// ---- per-user views of exchanges ----
export const myTransactions = (S: State) => S.T.filter(t => isParty(S, t))
export const isOpen = (t: Transaction) => t.step < 6 && !t.cx
export const mySide = (S: State, t: Transaction): 'supplier' | 'receiver' => t.supplierId == S.me.id ? 'supplier' : 'receiver'
export const counterpartyName = (S: State, t: Transaction) => listing(S, mySide(S, t) == 'supplier' ? t.d : t.s).biz

// Money side of a deal for me: supplier = sales + disposal avoided; receiver = saving vs alternative, after transport.
// Uses the value stored at completion; older rows fall back to an estimate with current assumptions.
export function myBenefit(S: State, t: Transaction) {
  const stored = mySide(S, t) == 'supplier' ? t.supplierBenefit : t.receiverBenefit
  if (stored != null) return stored
  const e = econ(S, listing(S, t.s) as Supply, listing(S, t.d) as Demand, t.q, 'receiver', t.price)
  return mySide(S, t) == 'supplier' ? e.sup : e.rec
}

// ---- display helpers ----
export const fmtKm = (km: number) => km < 1 ? 'same town' : f1(km) + ' km'

// Plain-language reasons behind a match score, strongest factors first.
export function matchReasons(m: Extract<Match, { block: null }>) {
  const { s, d, q, e, fac } = m
  const cat = categoryOf(s)
  const start = [s.from, d.from, today()].sort().pop()!, days = daysUntil(start)
  const text: Record<string, string> = {
    'Category fit': d.accepts?.length && cat ? `buyer wants ${catLabel(cat)}` : `suits ${d.use1}`,
    Quantity: q >= d.max - 1e-9 ? `fills the whole ${d.max} t request` : `${f1(q)} of ${d.max} t requested`,
    Distance: e.dist < 1 ? 'same town' : `${f1(e.dist)} km away`,
    'Buyer savings': e.rec > 0 ? `buyer saves ~$${Math.round(e.rec / q)}/t` : s.price == 0 ? 'free material' : 'within budget',
  }
  const timing = days <= 0 ? 'available now' : `ready in ${days} day${days == 1 ? '' : 's'}`
  return [...fac]
    .sort((a, b) => b[2] - a[2])
    .map(([name]) => text[name] ?? timing)
    .slice(0, 3)
}

// Rough everyday equivalents (illustrative): average car ~0.2 kg CO2e/km; a 240 L wheelie bin of produce ~0.1 t.
export const EQUIV = { carKgPerKm: 0.2, binTonnes: 0.1 }
export const kmNotDriven = (kgCo2: number) => Math.round(kgCo2 / EQUIV.carKgPerKm)
export const wheelieBins = (t: number) => Math.round(t / EQUIV.binTonnes)

// ---- time ----
export const completedOn = (t: Transaction) => t.log[t.log.length - 1]?.[1] ?? ''
export const daysUntil = (date: string) => Math.round((new Date(date + 'T00:00').getTime() - new Date(today() + 'T00:00').getTime()) / 864e5)

// Completed exchanges bucketed into the last `weeks` weeks (Monday starts), oldest first.
export function weekly(txs: Transaction[], S: State, weeks = 8) {
  const now = new Date(today() + 'T00:00')
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(monday); start.setDate(monday.getDate() - 7 * (weeks - 1 - i))
    return { start: iso(start), co2: 0, tonnes: 0, deals: 0 }
  })
  for (const t of txs) {
    if (t.step != 6) continue
    const d = completedOn(t)
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (d >= buckets[i].start) { buckets[i].co2 += txCo2(S, t); buckets[i].tonnes += t.q; buckets[i].deals++; break }
    }
  }
  return buckets
}

// My active listings ending within `days` days (or already ended) that still have something open.
export function endingSoon(S: State, days = 7) {
  return S.L
    .filter(l => l.ownerId == S.me.id && !l.arch && (l.type == 'Demand' || avail(l) > 0) && daysUntil(l.to) <= days)
    .sort((a, b) => a.to.localeCompare(b.to))
}

// ---- roles ----
export const hasRole = (me: State['me'], role: Role) => role == 'Supplier' ? me.canSupply : me.canReceive
export const otherRole = (role: Role): Role => role == 'Supplier' ? 'Receiver' : 'Supplier'
// Exchanges where I'm on the side I'm currently viewing as.
export const sideTransactions = (S: State) => myTransactions(S).filter(t => mySide(S, t) == (S.view == 'Supplier' ? 'supplier' : 'receiver'))

// ---- listing form checks ----
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
const num = (v: number | string) => v === '' || v === null ? NaN : Number(v)

// Plain-language problems with a draft; empty when it's ready to publish.
export function draftProblems(d: Draft): string[] {
  const p: string[] = []
  if (!d.mat.trim()) p.push('Add the material')
  if (!(num(d.qty) > 0)) p.push('Quantity must be more than 0 tonnes')
  if (!CITY[d.loc]) p.push('Choose a location from the list')
  if (!isDate(d.from)) p.push('Choose an "available from" date')
  if (!isDate(d.to)) p.push('Choose an end date')
  else if (isDate(d.from) && d.to < d.from) p.push('End date must be on or after the start date')
  if (d.type == 'Supply') {
    if (!(num(d.price) >= 0)) p.push('Asking price must be 0 or more')
    if (!(num(d.disp) >= 0)) p.push('Add your disposal cost per tonne (an estimate is fine)')
    if (!d.uses.length) p.push('Tick at least one accepted use')
    if (!CATEGORIES.some(c => c.id == d.category)) p.push('Choose a category')
    else if (evaluate(d.category, d.answers, d.suburb, null).unanswered.length) p.push('Answer all the compliance questions')
    if (!d.declared) p.push('Tick the seller declaration')
  } else {
    if (!(num(d.min) > 0)) p.push('Minimum quantity must be more than 0')
    else if (num(d.min) > num(d.qty)) p.push('Minimum quantity can’t be more than the quantity needed')
    if (!(num(d.maxKm) > 0)) p.push('Max distance must be more than 0 km')
    if (!(num(d.maxPrice) >= 0)) p.push('Max price must be 0 or more')
    if (!(num(d.alt) >= 0)) p.push('Alternative cost must be 0 or more')
  }
  return p
}

// Prefills the form from an existing listing (for editing).
export function listingToDraft(l: Listing): Draft {
  const common = { mat: l.mat, loc: l.loc, from: l.from, to: l.to, raw: '', editId: l.id, declared: false }
  return l.type == 'Supply'
    ? { ...common, type: 'Supply', cond: l.cond, qty: l.qty, price: l.price, disp: l.disp, chem: l.chem, uses: l.use,
        category: l.category ?? '', suburb: l.suburb ?? '', answers: l.answers ?? {}, accepts: [],
        use1: 'composting', min: '', maxKm: 120, maxPrice: 30, alt: 45 }
    : { ...common, type: 'Demand', cond: 'Unknown', qty: l.max, price: 0, disp: 0, chem: 'unknown', uses: [],
        category: '', suburb: '', answers: {}, accepts: l.accepts ?? [],
        use1: l.use1, min: l.min, maxKm: l.maxKm, maxPrice: l.maxPrice, alt: l.alt }
}

// Exchanges still in progress on a listing (editing details is locked while any exist).
export const hasOpenExchange = (S: State, id: string) => S.T.some(t => (t.s == id || t.d == id) && isOpen(t))

// ---- after matching: coach, offers, tidy names ----

// "it's the banana peels" → "Banana peels": drops filler words people say when describing things.
export function cleanMaterial(text: string) {
  let t = text.trim().replace(/[.!?]+$/, '')
  const filler = /^(it'?s|it is|they'?re|they are|we'?ve got|i'?ve got|we have|i have|got|some|the|a|an|about|around|roughly|approx\.?)\s+/i
  while (filler.test(t)) t = t.replace(filler, '')
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 80)
}

// Pairs that only miss on things an offer can stretch, and only by a realistic amount: any price
// (the other side can counter), up to 1.5× the buyer's distance, at least half their minimum load.
const STRETCHABLE: BlockKind[] = ['price', 'distance', 'min']
export const offerable = (S: State) => (m: Match): m is Extract<Match, { block: string }> =>
  m.block !== null && !!m.kinds?.length && m.kinds.every(k => STRETCHABLE.includes(k))
  && km(S, m.s.loc, m.d.loc) <= m.d.maxKm * 1.5 && avail(m.s) >= m.d.min * 0.5

export interface CoachTip { id: string; label: string; detail: string; gain: number; patch: Partial<Supply> & Partial<Demand> }
export interface Coach { matched: number; blockers: [BlockKind, number][]; tips: CoachTip[]; nearMisses: number }

// For one of my listings: current matches, the main blockers, and one-change fixes ranked by how
// many extra matches each unlocks (each counted by re-running the real matching).
export function coach(S: State, l: Listing): Coach {
  const others = S.L.filter(x => x.type != l.type && !x.arch && x.ownerId != l.ownerId)
  const results = (patch: Partial<Supply> & Partial<Demand>) => others.map(o => {
    const me = { ...l, ...patch } as Listing
    return me.type == 'Supply' ? match(S, me, o as Demand) : match(S, o as Supply, me as Demand)
  })
  const count = (patch: Partial<Supply> & Partial<Demand>) => results(patch).filter(m => m && m.block === null).length
  const now = results({})
  const matched = now.filter(m => m && m.block === null).length
  const tally = new Map<BlockKind, number>()
  for (const m of now) if (m && m.block !== null) for (const k of m.kinds ?? []) tally.set(k, (tally.get(k) ?? 0) + 1)

  const tips: CoachTip[] = []
  const tryTip = (id: string, label: string, detail: string, patch: CoachTip['patch']) => {
    const gain = count(patch) - matched
    if (gain > 0) tips.push({ id, label, detail, gain, patch })
  }
  const extendTo = addDays(l.to < today() ? today() : l.to, 14)
  if (l.type == 'Supply') {
    // Highest price that unlocks something, and free.
    const prices = [...new Set(others.map(o => (o as Demand).maxPrice).filter(p => p < l.price))].sort((a, b) => b - a)
    const firstPrice = prices.find(p => count({ price: p }) > matched)
    if (firstPrice !== undefined && firstPrice > 0) tryTip('price', `Lower price to $${firstPrice}/t`, 'the most these buyers will pay', { price: firstPrice })
    if (l.price > 0) tryTip('free', 'Make it free', 'you still save the disposal cost', { price: 0 })
    const hidden = complianceOf(S, l).hidden
    for (const u of USES) if (!l.use.includes(u) && !hidden.has(u)) {
      tryTip('use-' + u, `Also offer it for ${USE_LABELS[u] ?? u}`, 'adds a use buyers are asking for', { use: [...l.use, u] })
    }
    tryTip('extend', 'Extend availability 2 weeks', `until ${extendTo}`, { to: extendTo })
  } else {
    const prices = [...new Set(others.map(o => (o as Supply).price).filter(p => p > l.maxPrice))].sort((a, b) => a - b)
    const p = prices.find(x => count({ maxPrice: x }) > matched)
    if (p !== undefined) tryTip('price', `Raise your max price to $${p}/t`, 'what these sellers are asking', { maxPrice: p })
    const kms = [100, 150, 200, 300, 500].filter(k => k > l.maxKm)
    const k = kms.find(x => count({ maxKm: x }) > matched)
    if (k !== undefined) tryTip('km', `Travel up to ${k} km`, `currently ${l.maxKm} km`, { maxKm: k })
    if (l.accepts?.length) tryTip('any', 'Accept any kind of material', 'currently ' + l.accepts.map(catLabel).join(', '), { accepts: [] })
    if (l.min > 0.5) tryTip('min', `Accept loads from ${+(l.min / 2).toFixed(2)} t`, `currently ${l.min} t minimum`, { min: +(l.min / 2).toFixed(2) })
    tryTip('extend', 'Extend your dates 2 weeks', `until ${extendTo}`, { to: extendTo })
  }
  tips.sort((a, b) => b.gain - a.gain)
  return {
    matched,
    blockers: [...tally.entries()].sort((a, b) => b[1] - a[1]),
    tips: tips.slice(0, 4),
    nearMisses: now.filter(m => m && offerable(S)(m)).length,
  }
}
