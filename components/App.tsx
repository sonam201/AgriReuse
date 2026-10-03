'use client'

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { Session } from '@supabase/supabase-js'
import { DEFAULT_SETTINGS, STORAGE_KEY, TABS } from '@/lib/data'
import * as db from '@/lib/db'
import { addDays, allMatches, draftProblems, econ, hasRole, listing, listingToDraft, listingTypeFor, parse, today, type CoachTip } from '@/lib/logic'
import { configured, openedFromRecoveryLink, supabase } from '@/lib/supabase'
import type { Demand, Draft, Profile as ProfileT, Role, Settings, State, Supply, Tab } from '@/lib/types'
import AuthScreen from './AuthScreen'
import NotificationBell from './NotificationBell'
import ResetPassword from './ResetPassword'
import CreateListing from './views/CreateListing'
import Dashboard from './views/Dashboard'
import Impact from './views/Impact'
import Marketplace from './views/Marketplace'
import Matches from './views/Matches'
import Profile from './views/Profile'
import Transactions from './views/Transactions'

const GUIDED_TEXT = {
  Supply: 'I have 800 kg of overripe bananas in Pukekohe, available this Friday. They are unsellable, and I want to find a potential reuse option.',
  Demand: 'I need 2 tonnes of plant material for composting near Hamilton next week.',
}

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
    // Every sign-in opens on the Dashboard; filters and logistics assumptions are remembered.
    if (saved) return { ...saved, tab: 'Dashboard', set: { ...DEFAULT_SETTINGS, ...saved.set } }
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

function useActions(S: State, setUI: (u: Partial<UI>) => void, refresh: () => Promise<void>, draft: Draft | null, setDraft: Dispatch<SetStateAction<Draft | null>>) {
  const [busy, setBusy] = useState(false)
  const [extracting, setExtracting] = useState(false)

  // Runs a database action, reports any rule it broke, then reloads shared data.
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true)
    try {
      await fn()
      after?.()
    } catch (e) {
      alert((e as Error).message)
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
    busy,
    go: (tab: Tab) => setUI({ tab }),
    setSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => setUI({ set: { ...S.set, [k]: v } }),
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
    deleteListing: (id: string) => { if (confirm('Delete listing?')) run(() => db.deleteListing(id)) },
    openNotification: (id: number) => {
      const n = S.N.find(x => x.id == id)
      if (n) run(() => db.markRead(id), () => setUI({ tab: n.tab }))
    },
    verify: (s: Supply, d: Demand) => run(async () => {
      await db.recordVerification(s.id, d.id)
      await db.addNotification('Demo verification evidence recorded (simulated lab report)', 'Matches')
    }),
    startTx: (key: string) => {
      const m = allMatches(S).find(x => x.key == key)
      if (!m || m.block !== null || m.g[0] != 'eligible') return alert('Blocked: verification or safety requirement not met.')
      run(() => db.startTransaction(m.s.id, m.d.id, m.q), () => setUI({ tab: 'Transactions' }))
    },
    advance: (id: string) => {
      const t = S.T.find(x => x.id == id)
      if (!t) return
      // CO2e and each side's money result are estimated with this viewer's logistics assumptions
      // when the exchange completes, then stored so later setting changes don't rewrite history.
      const e = t.step + 1 == 6 ? econ(S, listing(S, t.s) as Supply, listing(S, t.d) as Demand, t.q, 'receiver', t.price) : null
      run(() => db.advanceTransaction(id, e && { co2: e.net, supplier: e.sup, receiver: e.rec }))
    },
    cancel: (id: string, kind: 'cancelled' | 'dispute') => run(() => db.cancelTransaction(id, kind)),

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
    setDemoZone: (active: boolean) => run(() => db.setDemoZone({ ...S.zone, active })),
    editDraft: <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(prev => prev && { ...prev, [k]: v }),
    cancelDraft: () => setDraft(null),
    startEdit: (id: string) => {
      const l = listing(S, id)
      if (l.ownerId != S.me.id) return
      setDraft(listingToDraft(l))
      setUI({ tab: 'Create Listing', view: l.type == 'Supply' ? 'Supplier' : 'Receiver' })
    },
    guided: () => {
      const type = listingTypeFor(S.view), d = parseForMe(GUIDED_TEXT[type])
      if (type == 'Supply') {
        Object.assign(d, {
          disp: 120, chem: 'declared-none', category: 'fruit_veg', suburb: 'Pukekohe',
          answers: { fruit_fly_zone: 'no', touched_meat: 'no', last_sprayed: 'never', condition: 'damaged', is_kiwifruit: 'no' },
        })
      }
      d.source = undefined
      setDraft(d)
      setUI({ tab: 'Create Listing' })
    },
    publish: () => {
      if (!draft) return
      const d = draft, problems = draftProblems(d)
      if (problems.length) return alert('Please fix:\n• ' + problems.join('\n• '))
      run(async () => {
        if (d.editId) await db.updateListing(d.editId, d, S.zone)
        else {
          const created = await db.createListing(d, S.zone)
          // Tell the owners of listings this one matches (fictional businesses have no owner to tell).
          const withNew: State = { ...S, L: [...S.L, created] }
          const targets = allMatches(withNew)
            .filter(m => m.block === null && (m.s.id == created.id || m.d.id == created.id))
            .map(m => (m.s.id == created.id ? m.d : m.s))
            .filter(o => o.ownerId)
            .map(o => o.id)
          const told = await db.notifyMatches(created.id, targets)
          await db.addNotification(`Listing published; matching run${told ? ` (${told} business${told == 1 ? '' : 'es'} notified)` : ''}`, 'Matches')
        }
      }, () => { setDraft(null); setUI({ tab: d.editId ? 'Marketplace' : 'Matches' }) })
    },

    // Applies a coach suggestion as a normal edit (re-confirming the seller declaration).
    applyTip: (id: string, tip: CoachTip) => {
      const l = listing(S, id)
      if (!confirm(`${tip.label}?\n\nThis updates your listing.${l.type == 'Supply' ? ' You confirm the listing details are still true.' : ''}`)) return
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
    respondOffer: (id: string, action: 'accept' | 'decline' | 'counter' | 'withdraw', price?: number) =>
      run(async () => {
        const r = await db.respondOffer(id, action, price)
        if (r.note) alert(r.note)
      }, () => { if (action == 'accept') setUI({ tab: 'Transactions' }) }),
  }
}

function Shell({ S, setUI, refresh, draft, setDraft }: {
  S: State; setUI: (u: Partial<UI>) => void; refresh: () => Promise<void>; draft: Draft | null; setDraft: Dispatch<SetStateAction<Draft | null>>
}) {
  const A = useActions(S, setUI, refresh, draft, setDraft)

  const view = {
    'Create Listing': <CreateListing S={S} A={A} draft={draft} />,
    Dashboard: <Dashboard S={S} A={A} />,
    Marketplace: <Marketplace S={S} A={A} />,
    Matches: <Matches S={S} A={A} />,
    Transactions: <Transactions S={S} A={A} />,
    Impact: <Impact S={S} />,
    Profile: <Profile S={S} A={A} />,
  }[S.tab]

  return (
    <>
      <header>
        <b>🌱 AgriReuse</b>
        <span className="demo">Demo: synthetic data and simulated transactions</span>
        <span style={{ marginLeft: 'auto', fontSize: 14 }}>{S.me.businessName}</span>
        {S.me.canSupply && S.me.canReceive
          ? <span className="switcher" role="group" aria-label="Acting as">
              {(['Supplier', 'Receiver'] as const).map(r => (
                <button key={r} className={S.view == r ? 'on' : ''} aria-pressed={S.view == r} onClick={() => A.setView(r)}>{r}</button>
              ))}
            </span>
          : <span className="demo">{S.view}</span>}
        <NotificationBell S={S} A={A} />
        <button className="btn alt" onClick={A.signOut}>Sign out</button>
      </header>
      <main>{view}</main>
      <nav>
        {TABS.map(t => (
          <button key={t} className={S.tab == t ? 'on' : ''} onClick={() => A.go(t)}>
            {t}
          </button>
        ))}
      </nav>
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
