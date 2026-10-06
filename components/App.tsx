'use client'

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { Session } from '@supabase/supabase-js'
import { CITY, DEFAULT_SETTINGS, STORAGE_KEY, TABS } from '@/lib/data'
import * as db from '@/lib/db'
import { addDays, allMatches, cleanMaterial, draftProblems, econ, hasRole, listing, listingToDraft, listingTypeFor, nextStep, parse, today, type CoachTip } from '@/lib/logic'
import { CATEGORIES } from '@/lib/compliance'
import { configured, openedFromRecoveryLink, supabase } from '@/lib/supabase'
import type { Demand, Draft, Profile as ProfileT, Role, State, Supply, Tab } from '@/lib/types'
import AuthScreen from './AuthScreen'
import Dialog, { type DialogRequest } from './Dialog'
import NotificationBell from './NotificationBell'
import ResetPassword from './ResetPassword'
import CreateListing from './views/CreateListing'
import Dashboard from './views/Dashboard'
import Impact from './views/Impact'
import Marketplace from './views/Marketplace'
import Matches from './views/Matches'
import Profile from './views/Profile'
import Transactions from './views/Transactions'

type Data = Awaited<ReturnType<typeof db.loadData>>
type UI = Pick<State, 'tab' | 'q' | 'ft' | 'lim' | 'set'> & { view?: Role; inputMode?: 'chat' | 'form' }

export default function App() {
  if (!configured) return <SetupNotice />
  return <AuthGate />
}

function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [recovering, setRecovering] = useState(openedFromRecoveryLink)
  useEffect(() => {
    supabase!.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase!.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event == 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  if (session === undefined) return null
  if (session && recovering) return <ResetPassword onDone={() => setRecovering(false)} />
  if (!session) return <AuthScreen />
  return <SignedIn key={session.user.id} userId={session.user.id} />
}

function loadUI(): UI {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    // Every sign-in opens on the Dashboard; filters are remembered. Logistics assumptions are
    // fixed platform defaults (any values saved by the old settings panel are ignored).
    if (saved) return { ...saved, tab: 'Dashboard', set: DEFAULT_SETTINGS }
  } catch {}
  return { tab: 'Dashboard', set: DEFAULT_SETTINGS }
}

function SignedIn({ userId }: { userId: string }) {
  const [me, setMe] = useState<ProfileT | null | undefined>(undefined)
  const [data, setData] = useState<Data | null>(null)
  const [ui, setUI] = useState<UI | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  // Reloads the profile too, so profile edits show everywhere.
  const refresh = useCallback(async () => {
    try {
      const p = await db.getProfile(userId)
      setMe(p)
      if (p) setData(await db.loadData(p))
    } catch (e) { setError((e as Error).message) }
  }, [userId])

  useEffect(() => {
    setUI(loadUI())
    refresh()
    // Realtime: refetch when anyone changes shared data (coalesced into one load).
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = db.subscribe(() => { clearTimeout(timer); timer = setTimeout(refresh, 150) })
    return () => { clearTimeout(timer); unsubscribe() }
  }, [userId, refresh])

  useEffect(() => {
    if (ui) try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ui)) } catch {}
  }, [ui])
  useEffect(() => { window.scrollTo(0, 0) }, [ui?.tab])

  if (error) return <Message title="Something went wrong" text={error} />
  if (me === null) return <Message title="No profile found" text="This account has no AgriReuse profile. Sign out and create a new account." />
  if (!me || !data || !ui) return <Message title="Loading…" text="" />

  // Act as the remembered side if the account has it, otherwise as its starting role.
  const view: Role = ui.view && hasRole(me, ui.view) ? ui.view : hasRole(me, me.role) ? me.role : me.canSupply ? 'Supplier' : 'Receiver'
  const S: State = { me, ...data, ...ui, view }
  return <Shell S={S} setUI={u => setUI({ ...ui, ...u })} refresh={refresh} draft={draft} setDraft={setDraft} />
}

export type Actions = ReturnType<typeof useActions>

type Ask = (o: Omit<DialogRequest, 'resolve'>) => Promise<boolean>

function useActions(S: State, setUI: (u: Partial<UI>) => void, refresh: () => Promise<void>, draft: Draft | null, setDraft: Dispatch<SetStateAction<Draft | null>>, ask: Ask) {
  // A message with a single OK button (in-app, not the browser's alert).
  const tell = (title: string, message?: string) => { void ask({ title, message, cancelLabel: null }) }
  const [busy, setBusy] = useState(false)
  const [extracting, setExtracting] = useState(false)

  // Runs a database action, reports any rule it broke, then reloads shared data.
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true)
    try {
      await fn()
      after?.()
    } catch (e) {
      tell('That didn’t work', (e as Error).message)
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  const parseForMe = (text: string) => {
    const d = parse(text), type = listingTypeFor(S.view)
    if (d.type != type) {
      d.type = type
      if (type == 'Demand' && !d.mat) d.mat = 'Plant material'
    }
    return d
  }

  // Reads a description with the AI assistant (keyword rules if it's unavailable). Returns the
  // fields it understood without touching the draft, so the form and the chat can both use it.
  const understand = async (text: string): Promise<{ fields: Partial<Draft>; notes?: string; source: 'ai' | 'rules' }> => {
    const base = parseForMe(text)
    const rules = (notes: string) => {
      const { type, raw, source, ...fields } = base
      return { fields, notes, source: 'rules' as const }
    }
    setExtracting(true)
    try {
      const token = (await supabase!.auth.getSession()).data.session?.access_token
      const res = await fetch('/api/parse-listing', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, type: base.type, today: today() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.source != 'ai') return rules(body.reason ?? body.error ?? 'AI assistant unavailable; filled with keyword rules.')
      const f = body.fields as Partial<Draft>
      if (f.from && !f.to) f.to = addDays(f.from, 30)
      if (f.min == null && f.qty != null && base.type == 'Demand') f.min = +(Number(f.qty) / 2).toFixed(2)
      return { fields: f, notes: body.notes ?? undefined, source: 'ai' }
    } catch {
      return rules('AI assistant unavailable; filled with keyword rules.')
    } finally {
      setExtracting(false)
    }
  }

  return {
    ask, // in-app confirmation dialog (used by views, e.g. Profile)
    busy,
    go: (tab: Tab) => setUI({ tab }),
    setFilter: (q: string, ft: State['ft']) => setUI({ q, ft, lim: 24 }),
    showMore: (lim: number) => setUI({ lim }),
    signOut: () => supabase!.auth.signOut(),
    // Switching side resets the draft, since a draft is for one listing type.
    setView: (view: Role) => { setDraft(null); setUI({ view }) },
    enableRole: (role: Role) => run(() => db.enableRole(S.me.id, role), () => { setDraft(null); setUI({ view: role, tab: 'Dashboard' }) }),
    markAllRead: () => run(() => db.markAllRead(S.me.id)),
    extendListing: (id: string, days: number) => {
      const l = listing(S, id), base = l.to < today() ? today() : l.to
      run(() => db.extendListing(id, addDays(base, days)))
    },
    // Resolves true on success so the form can show a confirmation.
    updateProfile: async (businessName: string, location: string) => {
      let ok = false
      await run(() => db.updateProfile(S.me.id, businessName, location), () => { ok = true })
      return ok
    },

    toggleArchive: (id: string) => run(() => db.setArchived(id, !listing(S, id).arch)),
    deleteListing: async (id: string) => {
      if (!(await ask({
        title: 'Delete this listing?',
        message: 'Any open exchanges or requests on it are cancelled, and the other business is told. This can’t be undone.',
        confirmLabel: 'Delete', danger: true,
      }))) return
      run(async () => { if (await db.deleteListing(id) == 'retired') tell('Listing deleted', 'It stays only in the other business’s exchange history.') })
    },
    // Profile → Your data. Shared exchanges and offers disappear for you only.
    deleteMyData: async (part: db.DataPart, what: string) => {
      if (!(await ask({
        title: `Delete ${what}?`,
        message: 'Anything still open is cancelled first and the other business is told. Shared deals and requests are removed from your account only; the other business keeps its copy. This can’t be undone.',
        confirmLabel: 'Delete', danger: true,
      }))) return
      run(async () => { const n = await db.deleteMyData(part); tell(`Deleted ${n} ${what}`) })
    },
    openNotification: (id: number) => {
      const n = S.N.find(x => x.id == id)
      if (n) run(() => db.markRead(id), () => setUI({ tab: n.tab }))
    },
    verify: (s: Supply, d: Demand) => run(async () => {
      await db.recordVerification(s.id, d.id)
    }),
    // Pickup needs { pickupAt, note }; "received" needs { receivedQ }.
    advance: (id: string, extra: { pickupAt?: string; note?: string; receivedQ?: number } = {}) => {
      const t = S.T.find(x => x.id == id)
      if (!t) return
      // On completion, CO2e and each side's money result are estimated from the tonnes actually
      // received (platform logistics defaults) and stored, so the figures never change afterwards.
      const q = t.receivedQ ?? t.q
      const e = nextStep(t) == 6 ? econ(S, listing(S, t.s) as Supply, listing(S, t.d) as Demand, q, 'receiver', t.price) : null
      run(() => db.advanceTransaction(id, e && { co2: e.net, supplier: e.sup, receiver: e.rec }, extra))
    },
    cancel: async (id: string, kind: 'cancelled' | 'dispute') => {
      const ok = await ask(kind == 'cancelled'
        ? { title: 'Cancel this deal?', message: 'The deal stops here and the other business is told. Any reserved tonnes go back on the listing. This can’t be undone.', confirmLabel: 'Cancel deal', cancelLabel: 'Keep deal', danger: true }
        : { title: 'Raise a dispute?', message: 'The deal is paused as disputed and the other business is told. This can’t be undone.', confirmLabel: 'Raise dispute', cancelLabel: 'Go back', danger: true })
      if (ok) run(() => db.cancelTransaction(id, kind))
    },

    extracting,
    understand,
    // Form mode: fill a fresh draft from the description.
    extract: async (text: string) => {
      const base = parseForMe(text)
      const r = await understand(text)
      setDraft({ ...base, ...r.fields, type: base.type, source: r.source, notes: r.notes })
    },
    // Chat mode: start an empty draft, then merge in fields as the conversation goes.
    newDraft: () => setDraft({ ...parseForMe(''), mat: '', qty: '', loc: '', source: undefined, raw: '' }),
    startDraft: (d: Draft) => setDraft(d),
    patchDraft: (p: Partial<Draft>) => setDraft(prev => prev && { ...prev, ...p }),
    setInputMode: (inputMode: 'chat' | 'form') => setUI({ inputMode }),
    editDraft: <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(prev => prev && { ...prev, [k]: v }),
    cancelDraft: () => setDraft(null),
    // Marketplace "Post a listing for this": a new draft on my side, prefilled from their listing.
    respondWith: (id: string) => {
      const x = listing(S, id), base = parseForMe('')
      const loc = S.me.location && CITY[S.me.location] ? S.me.location : x.loc
      if (x.type == 'Demand') {
        const cat = CATEGORIES.find(c => x.accepts?.includes(c.id))
        setDraft({
          ...base, type: 'Supply', mat: cleanMaterial(x.keywords?.[0] ?? x.mat), qty: x.max, loc,
          category: cat?.id ?? '', cond: cat?.cond ?? 'Unknown', uses: [x.use1], price: 0, raw: '', source: undefined,
          notes: `Prefilled from ${x.biz}’s request. Check every field, answer the compliance questions and tick the declaration.`,
        })
      } else {
        const avail = x.qty - x.done - x.res
        setDraft({
          ...base, type: 'Demand', mat: x.mat, keywords: x.mat, qty: +avail.toFixed(2), min: +(avail / 2).toFixed(2), loc,
          accepts: x.category ? [x.category] : [], use1: x.use[0] ?? 'composting', maxPrice: x.price, maxKm: 300, raw: '', source: undefined,
          notes: `Prefilled from ${x.biz}’s listing. Check the fields, then publish to match with it.`,
        })
      }
      setUI({ tab: 'Create Listing', inputMode: 'form' })
    },
    startEdit: (id: string) => {
      const l = listing(S, id)
      if (l.ownerId != S.me.id) return
      setDraft(listingToDraft(l))
      setUI({ tab: 'Create Listing', view: l.type == 'Supply' ? 'Supplier' : 'Receiver' })
    },
    publish: () => {
      if (!draft) return
      const d = draft, problems = draftProblems(d)
      if (problems.length) return tell('Please fix these first', problems.join(' · '))
      run(async () => {
        // Notifications are only for deal attempts, so publishing sends none.
        if (d.editId) await db.updateListing(d.editId, d, S.zone)
        else await db.createListing(d, S.zone)
      }, () => { setDraft(null); setUI({ tab: d.editId ? 'Marketplace' : 'Matches' }) })
    },

    // Applies a coach suggestion as a normal edit (re-confirming the seller declaration).
    applyTip: async (id: string, tip: CoachTip) => {
      const l = listing(S, id)
      if (!(await ask({
        title: `${tip.label}?`,
        message: `This updates your listing.${l.type == 'Supply' ? ' You confirm the listing details are still true.' : ''}`,
        confirmLabel: 'Update listing',
      }))) return
      const p = tip.patch, base = listingToDraft(l)
      const d: Draft = {
        ...base, declared: true,
        ...(p.price !== undefined && { price: p.price }), ...(p.use && { uses: p.use }), ...(p.to && { to: p.to }),
        ...(p.maxPrice !== undefined && { maxPrice: p.maxPrice }), ...(p.maxKm !== undefined && { maxKm: p.maxKm }),
        ...(p.accepts && { accepts: p.accepts }), ...(p.min !== undefined && { min: p.min }),
      }
      run(() => db.updateListing(id, d, S.zone))
    },

    // Offers on near-miss pairs; returns the outcome so the dialog can show it.
    sendOffer: async (supplyId: string, demandId: string, price: number, q: number, message: string) => {
      let result: db.OfferResult | null = null
      await run(async () => { result = await db.sendOffer(supplyId, demandId, price, q, message) })
      return result as db.OfferResult | null
    },
    respondOffer: (id: string, action: 'accept' | 'decline' | 'counter' | 'withdraw', price?: number, q?: number) =>
      run(async () => {
        const r = await db.respondOffer(id, action, price, q)
        if (r.note) tell(r.note)
      }, () => { if (action == 'accept') setUI({ tab: 'Transactions' }) }),
    // Buyer requesting a supply from the Marketplace without a posted request of their own.
    requestWithoutListing: async (s: Supply, q: number, price: number, message: string) => {
      let result: db.OfferResult | null = null
      const loc = S.me.location && CITY[S.me.location] ? S.me.location : s.loc
      await run(async () => {
        const demandId = await db.createPrivateRequest(s, q, price, loc)
        result = await db.sendOffer(s.id, demandId, price, q, message)
      })
      return result as db.OfferResult | null
    },
  }
}

function Shell({ S, setUI, refresh, draft, setDraft }: {
  S: State; setUI: (u: Partial<UI>) => void; refresh: () => Promise<void>; draft: Draft | null; setDraft: Dispatch<SetStateAction<Draft | null>>
}) {
  // In-app dialog (replaces the browser's confirm/alert).
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const ask = (o: Omit<DialogRequest, 'resolve'>) => new Promise<boolean>(resolve => setDialog({ ...o, resolve }))
  const A = useActions(S, setUI, refresh, draft, setDraft, ask)
  // Phones: the bottom tabs and header extras move into a hamburger menu.
  const [menu, setMenu] = useState(false)
  const goFromMenu = (t: Tab) => { setMenu(false); A.go(t) }
  useEffect(() => {
    if (!menu) return
    const key = (e: KeyboardEvent) => { if (e.key == 'Escape') setMenu(false) }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [menu])

  const view = {
    'Create Listing': <CreateListing S={S} A={A} draft={draft} />,
    Dashboard: <Dashboard S={S} A={A} />,
    Marketplace: <Marketplace S={S} A={A} />,
    Matches: <Matches S={S} A={A} />,
    Transactions: <Transactions S={S} A={A} />,
    Impact: <Impact S={S} />,
    Profile: <Profile S={S} A={A} />,
  }[S.tab]

  const roleSwitch = S.me.canSupply && S.me.canReceive
    ? <span className="switcher" role="group" aria-label="Acting as">
        {(['Supplier', 'Receiver'] as const).map(r => (
          <button key={r} className={S.view == r ? 'on' : ''} aria-pressed={S.view == r} onClick={() => A.setView(r)}>{r}</button>
        ))}
      </span>
    : <span className="demo">{S.view}</span>

  return (
    <>
      <header className="app-header">
        <b>🌱 AgriReuse</b>
        <span className="demo hide-sm">Payments simulated</span>
        <span className="biz-name hide-sm">{S.me.businessName}</span>
        <span className="hide-sm">{roleSwitch}</span>
        <NotificationBell S={S} A={A} />
        <button className="btn alt hide-sm" onClick={A.signOut}>Sign out</button>
        <button className="hamburger show-sm" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} aria-controls="mobile-menu"
          onClick={() => setMenu(!menu)}>{menu ? '✕' : '☰'}</button>
      </header>

      {menu && (
        <div className="menu-backdrop show-sm" onClick={() => setMenu(false)}>
          <div id="mobile-menu" className="mobile-menu" role="navigation" aria-label="Main menu" onClick={e => e.stopPropagation()}>
            <div className="menu-who">
              <b>{S.me.businessName}</b>
              {roleSwitch}
            </div>
            {TABS.map(t => (
              <button key={t} className={'menu-item' + (S.tab == t ? ' on' : '')} aria-current={S.tab == t ? 'page' : undefined} onClick={() => goFromMenu(t)}>
                {t}
              </button>
            ))}
            <div className="menu-foot">
              <span className="demo">Payments simulated</span>
              <button className="btn alt" onClick={() => { setMenu(false); A.signOut() }}>Sign out</button>
            </div>
          </div>
        </div>
      )}

      <main>{view}</main>
      <nav className="tabbar hide-sm" aria-label="Main">
        {TABS.map(t => (
          <button key={t} className={S.tab == t ? 'on' : ''} aria-current={S.tab == t ? 'page' : undefined} onClick={() => A.go(t)}>
            {t}
          </button>
        ))}
      </nav>
      {dialog && <Dialog req={dialog} onDone={() => setDialog(null)} />}
    </>
  )
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <main style={{ maxWidth: 560 }}>
      <div className="card">
        <h3>{title}</h3>
        {text && <p className="s">{text}</p>}
        {supabase && title != 'Loading…' && <button className="btn alt" onClick={() => supabase!.auth.signOut()}>Sign out</button>}
      </div>
    </main>
  )
}

function SetupNotice() {
  return (
    <main style={{ maxWidth: 640 }}>
      <div className="card">
        <h3>Supabase is not configured</h3>
        <p className="s">
          Copy <code>.env.example</code> to <code>.env.local</code>, set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then restart the dev server. See the README for database setup.
        </p>
      </div>
    </main>
  )
}
