import { supabase } from './supabase'
import { evaluate, type DemoZone } from './compliance'
import { TYPICAL_ALTERNATIVE, TYPICAL_DISPOSAL, UNUSED_MAX_KM, chemFromAnswers, costOr, splitKeywords } from './logic'
import type { Draft, Listing, Notification, Offer, Profile, Tab, Transaction } from './types'

// Maps snake_case database rows to the app's types. Seeded rows have owner_id = null.
type Row = Record<string, any>

const toListing = (r: Row): Listing => r.type == 'Supply'
  ? {
      id: r.id, type: 'Supply', ownerId: r.owner_id, biz: r.biz, mat: r.mat, cond: r.cond, qty: r.qty, loc: r.loc,
      price: r.price, disp: r.disp, chem: r.chem, use: r.uses ?? [], from: r.from_date, to: r.to_date,
      done: r.done, res: r.res, arch: r.arch, moveR: r.move_r,
      category: r.category ?? null, suburb: r.suburb ?? null, answers: r.answers ?? {}, declaredAt: r.declared_at ?? null,
      deletedAt: r.deleted_at ?? null,
    }
  : {
      id: r.id, type: 'Demand', ownerId: r.owner_id, biz: r.biz, mat: r.mat, use1: r.use1, min: r.min_qty, max: r.max_qty,
      loc: r.loc, maxKm: r.max_km, maxPrice: r.max_price, alt: r.alt, from: r.from_date, to: r.to_date, arch: r.arch,
      accepts: r.accepts ?? null, keywords: r.keywords ?? null, deletedAt: r.deleted_at ?? null,
    }

const toTransaction = (r: Row): Transaction => ({
  id: r.id, s: r.supply_id, d: r.demand_id, q: r.q, price: r.price, step: r.step,
  supplierId: r.supplier_id, receiverId: r.receiver_id, proposerId: r.proposer_id,
  log: r.log, co2: r.co2, cx: r.cx, supplierBenefit: r.supplier_benefit, receiverBenefit: r.receiver_benefit,
})

const toOffer = (r: Row): Offer => ({
  id: r.id, s: r.supply_id, d: r.demand_id, from: r.from_user, to: r.to_user, price: r.price, q: r.q, message: r.message,
  status: r.status, note: r.note, parentId: r.parent_id, transactionId: r.transaction_id, createdAt: r.created_at,
})

const toNotification = (r: Row): Notification => ({ id: r.id, txt: r.txt, read: r.read, tab: r.tab })

const db = () => {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

// Throws the database error message (e.g. a rule enforced by an RLS policy or SQL function).
function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message)
  return data
}

export async function getProfile(id: string): Promise<Profile | null> {
  const r = check(await db().from('profiles').select('*').eq('id', id).maybeSingle())
  return r && {
    id: r.id, businessName: r.business_name, role: r.role, location: r.location,
    // Fall back to the starting role if the dual-role columns aren't there yet.
    canSupply: r.can_supply ?? r.role == 'Supplier', canReceive: r.can_receive ?? r.role == 'Receiver',
  }
}

export async function loadData(me: Profile) {
  const [L, T, N, V, Z, O] = await Promise.all([
    db().from('listings').select('*').order('created_at').order('id'),
    db().from('transactions').select('*').order('created_at'),
    db().from('notifications').select('*').eq('user_id', me.id).order('created_at', { ascending: false }).limit(50),
    db().from('verifications').select('supply_id, demand_id'),
    db().from('app_settings').select('value').eq('key', 'demo_fruit_fly_zone').maybeSingle(),
    db().from('offers').select('*').order('created_at', { ascending: false }).limit(100),
  ])
  return {
    L: (check(L) ?? []).map(toListing), // includes retired listings (deletedAt) for exchange history
    T: (check(T) ?? []).map(toTransaction),
    N: (check(N) ?? []).map(toNotification),
    verified: Object.fromEntries((check(V) ?? []).map(v => [v.supply_id + v.demand_id, true as const])),
    // Official fruit fly controlled areas (suburbs). Off and empty for now; future work: an automatic
    // feed from MPI notices updates this list and every listing re-checks live.
    zone: (Z.error ? null : Z.data?.value as DemoZone | null) ?? { active: false, suburbs: [] },
    // Empty until the offers migration runs.
    O: O.error ? [] : (O.data ?? []).map(toOffer),
  }
}

// Database columns for a draft's details (shared by create and edit).
function draftRow(d: Draft, zone: DemoZone): Row {
  const common = { mat: d.mat.trim(), loc: d.loc, from_date: d.from, to_date: d.to }
  return d.type == 'Supply'
    ? {
        ...common, cond: d.cond, qty: +d.qty, price: +d.price, disp: costOr(d.disp, TYPICAL_DISPOSAL), chem: chemFromAnswers(d), uses: d.uses,
        // Saved record of the Compliance Check: answers, result, rule tags and the declaration.
        category: d.category, suburb: d.suburb.trim() || null, answers: d.answers,
        compliance: (({ level, rules }) => ({ level, rules: rules.map(r => r.id), checked_at: new Date().toISOString() }))(evaluate(d.category, d.answers, d.suburb, zone)),
        declared_at: d.declared ? new Date().toISOString() : null,
      }
    : { ...common, use1: d.use1, min_qty: +d.min, max_qty: +d.qty, max_km: UNUSED_MAX_KM, max_price: +d.maxPrice, alt: costOr(d.alt, TYPICAL_ALTERNATIVE), accepts: d.accepts.length ? d.accepts : null,
        keywords: splitKeywords(d.keywords).length ? splitKeywords(d.keywords) : null }
}

// owner_id and biz are filled in by the database from the signed-in user's profile.
export async function createListing(d: Draft, zone: DemoZone): Promise<Listing> {
  return toListing(check(await db().from('listings').insert({ ...draftRow(d, zone), type: d.type, biz: '' }).select().single())!)
}

// The database refuses detail edits while an exchange on the listing is open.
export async function updateListing(id: string, d: Draft, zone: DemoZone) {
  const rows = check(await db().from('listings').update(draftRow(d, zone)).eq('id', id).select('id'))
  if (!rows?.length) throw new Error('Listing not found, or it isn’t yours to edit.')
}

export const setArchived = async (id: string, arch: boolean) =>
  check(await db().from('listings').update({ arch }).eq('id', id))

// Deletes one of my listings (open deals on it are cancelled first). A listing in someone else's
// exchange history is retired instead: hidden everywhere, kept so their record still makes sense.
export const deleteListing = async (id: string) =>
  check(await db().rpc('delete_my_listing', { p_id: id })) as 'deleted' | 'retired'

// "Your data": deletes one part of my history. Shared records are hidden for me only.
export type DataPart = 'listings' | 'exchanges' | 'offers' | 'notifications'
export const deleteMyData = async (part: DataPart) =>
  check(await db().rpc('delete_my_data', { p_part: part })) as number

export const addNotification = async (txt: string, tab: Tab) =>
  check(await db().from('notifications').insert({ txt, tab }))

export const markRead = async (id: number) =>
  check(await db().from('notifications').update({ read: true }).eq('id', id))

export const recordVerification = async (supplyId: string, demandId: string) =>
  check(await db().from('verifications').insert({ supply_id: supplyId, demand_id: demandId }))

export const startTransaction = async (supplyId: string, demandId: string, q: number) =>
  check(await db().rpc('start_transaction', { p_supply: supplyId, p_demand: demandId, p_q: q }))

// co2 and both sides' money results are recorded when the final step completes.
export const advanceTransaction = async (id: string, done: { co2: number; supplier: number; receiver: number } | null) =>
  check(await db().rpc('advance_transaction', {
    p_id: id, p_co2: done?.co2 ?? null, p_supplier_benefit: done?.supplier ?? null, p_receiver_benefit: done?.receiver ?? null,
  }))

export const extendListing = async (id: string, to: string) =>
  check(await db().from('listings').update({ to_date: to }).eq('id', id))

export async function updateProfile(id: string, businessName: string, location: string) {
  check(await db().from('profiles').update({ business_name: businessName, location }).eq('id', id))
}

export const markAllRead = async (userId: string) =>
  check(await db().from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false))

export const cancelTransaction = async (id: string, kind: 'cancelled' | 'dispute') =>
  check(await db().rpc('cancel_transaction', { p_id: id, p_kind: kind }))

// Calls onChange whenever shared data changes, so other users' actions appear live.
export function subscribe(onChange: () => void) {
  const channel = db().channel('agrireuse')
  for (const table of ['listings', 'transactions', 'notifications', 'verifications', 'app_settings', 'offers'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
  channel.subscribe()
  return () => { db().removeChannel(channel) }
}

// Adds the other role to the account (one-way; the database ignores attempts to remove one).
export const enableRole = async (id: string, role: 'Supplier' | 'Receiver') =>
  check(await db().from('profiles').update(role == 'Supplier' ? { can_supply: true } : { can_receive: true }).eq('id', id))


// Offers. The database decides what's allowed; fictional businesses reply immediately.
export type OfferResult = { status: Offer['status']; offer_id?: string; transaction_id?: string; note?: string }
export const sendOffer = async (supplyId: string, demandId: string, price: number, q: number, message: string) =>
  check(await db().rpc('send_offer', { p_supply: supplyId, p_demand: demandId, p_price: price, p_q: q, p_message: message })) as OfferResult
export const respondOffer = async (id: string, action: 'accept' | 'decline' | 'counter' | 'withdraw', price?: number) =>
  check(await db().rpc('respond_offer', { p_offer: id, p_action: action, p_price: price ?? null })) as OfferResult

// Tells the owners of matching listings about a newly published listing (returns how many).
export async function notifyMatches(listingId: string, targetIds: string[]) {
  if (!targetIds.length) return 0
  const { data, error } = await db().rpc('notify_matches', { p_listing: listingId, p_targets: targetIds.slice(0, 50) })
  if (error) { console.warn('Match alerts unavailable:', error.message); return 0 } // e.g. migration not run yet
  return data as number
}
