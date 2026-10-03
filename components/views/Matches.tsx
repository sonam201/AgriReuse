'use client'

import { useState } from 'react'
import type { OfferResult } from '@/lib/db'
import {
  allMatches, avail, coach, complianceOf, f1, fmtKm, gate, hasOpenExchange, matchReasons, money, offerable,
} from '@/lib/logic'
import type { BlockKind, Listing, Match, Settings, State } from '@/lib/types'
import type { Actions } from '../App'
import { ComplianceBadge } from '../Compliance'
import Tag from '../Tag'

export type Scored = Extract<Match, { block: null }>
type Missed = Extract<Match, { block: string }>

// onStarted lets a caller (e.g. the dashboard's review dialog) close itself after starting.
export function MatchCard({ m, S, A, onStarted }: { m: Scored; S: State; A: Actions; onStarted?: () => void }) {
  const e = m.e
  return (
    <div className="card">
      <h3>{m.s.mat} → {m.d.biz} <ComplianceBadge level={complianceOf(S, m.s).level} /></h3>
      <div className="s">{m.s.biz} ({m.s.loc}) · {f1(m.q)} t · score {m.score}/100 · {fmtKm(e.dist)}{e.dist >= 1 ? ` indicative · ~${e.mins} min` : ''}</div>
      <div className="s" style={{ color: 'var(--ink)' }}>Why: {matchReasons(m).join(' · ')}</div>
      <Tag g={m.g} />
      <p className="s">{m.g[1]}</p>
      <table><tbody>
        <tr><td>Transport ({e.t} trip(s), receiver pays)</td><td>{money(e.tc)}</td></tr>
        <tr><td>Supplier net benefit</td><td className={e.sup < 0 ? 'neg' : ''}>{money(e.sup)}</td></tr>
        <tr><td>Receiver savings</td><td className={e.rec < 0 ? 'neg' : ''}>{money(e.rec)}{e.rec < 0 ? ' ⚠ unattractive' : ''}</td></tr>
        <tr><td>Est. net CO₂e (range {f1(e.lo)}…{f1(e.hi)})</td><td className={e.net < 0 ? 'neg' : ''}>{f1(e.net)} kg{e.net < 0 ? ' ⚠ negative' : ''}</td></tr>
      </tbody></table>
      <details>
        <summary>Score factors &amp; formulas</summary>
        <div className="s">
          {m.fac.map(([n, w, v]) => <div key={n}>{n}: weight {w}, {Math.round(Math.max(0, v) * 100)}%</div>)}
          Supplier = q×price + q×disposal − supplier transport. Receiver = q×alt − q×price − receiver transport.
          Net CO₂e = disposal {f1(e.disp)} + displaced {f1(e.alt)} − transport {f1(e.tr)} − processing {f1(e.pr)} kg
          (illustrative factors, substitution {S.set.subst * 100}%). Missing: lab evidence, processing costs assumed $0 (unknown).
        </div>
      </details>
      {m.g[0] == 'eligible'
        ? <button className="btn" disabled={A.busy} onClick={() => { A.startTx(m.key); onStarted?.() }}>{onStarted ? 'Confirm and start exchange' : 'Start simulated exchange'}</button>
        : <>
            <button className="btn alt" disabled={A.busy} onClick={() => A.verify(m.s, m.d)}>Complete demo verification (simulated evidence)</button>{' '}
            <button className="btn" disabled>Transaction blocked</button>
          </>}
    </div>
  )
}

// Keeps the typed text locally so partial input like "1." isn't clobbered; commits valid numbers.
function NumField({ label, value, step, onCommit }: { label: string; value: number; step: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  return (
    <div>
      <label>{label}</label>
      <input type="number" step={step} value={text} onChange={e => {
        setText(e.target.value)
        if (e.target.value !== '' && !isNaN(+e.target.value)) onCommit(+e.target.value)
      }} />
    </div>
  )
}

const SETTING_FIELDS: [Exclude<keyof Settings, 'ret'>, string, number][] = [
  ['mult', 'Road multiplier', 0.1], ['speed', 'Speed km/h', 5], ['cap', 'Vehicle t', 1],
  ['perkm', '$/km', 0.1], ['fixed', 'Fixed $/trip', 5], ['subst', 'Substitution (0–1)', 0.1],
]

const BLOCKER_TEXT: Record<BlockKind, string> = {
  price: 'price', distance: 'distance', min: 'minimum load size', use: 'intended use', category: 'kind of material',
  dates: 'dates', compliance: 'compliance', location: 'location',
}

// Make an offer on a near-miss pair (price, distance or minimum quantity slightly out of range).
function OfferDialog({ m, S, A, onClose }: { m: Missed; S: State; A: Actions; onClose: () => void }) {
  const iSupply = m.s.ownerId == S.me.id
  const maxQ = Math.min(avail(m.s), m.d.max)
  const [price, setPrice] = useState(String(iSupply ? Math.min(m.s.price, m.d.maxPrice) : m.s.price))
  const [q, setQ] = useState(String(+maxQ.toFixed(2)))
  const [msg, setMsg] = useState('')
  const [result, setResult] = useState<OfferResult | null>(null)
  const needsCheck = gate(S, m.s, m.d, m.key)[0] == 'restricted'
  const other = iSupply ? m.d : m.s

  async function send() {
    const r = await A.sendOffer(m.s.id, m.d.id, +price, +q, msg)
    if (r) setResult(r)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label="Make an offer" onClick={e => e.stopPropagation()}>
        <h3>💬 Make an offer to {other.biz}</h3>
        <p className="s">{m.s.mat} · {other.loc} · not a standard match because: {m.block}</p>
        {result ? (
          <>
            <p className="warn">
              {result.status == 'accepted' && '✅ Accepted! The exchange has started with terms agreed.'}
              {result.status == 'countered' && `↩️ ${result.note ?? 'They sent a counter-offer'}. Reply under Transactions → Offers.`}
              {result.status == 'declined' && `✖ Declined${result.note ? `: ${result.note}` : ''}.`}
              {result.status == 'pending' && '📨 Sent. You’ll get a 🔔 notification when they reply.'}
            </p>
            {result.status == 'accepted' || result.status == 'countered'
              ? <button className="btn" onClick={() => { onClose(); A.go('Transactions') }}>Go to Transactions</button>
              : <button className="btn" onClick={onClose}>Close</button>}
          </>
        ) : (
          <>
            <div className="row">
              <div><label>Price ($/t)</label><input type="number" min={0} step={1} value={price} onChange={e => setPrice(e.target.value)} /></div>
              <div><label>Quantity (t, up to {f1(maxQ)})</label><input type="number" min={0} step={0.1} max={maxQ} value={q} onChange={e => setQ(e.target.value)} /></div>
            </div>
            <div><label>Message (optional)</label><input maxLength={300} value={msg} onChange={e => setMsg(e.target.value)} placeholder="e.g. We can deliver half-way" /></div>
            <p className="s">
              {iSupply ? `Their limit is $${m.d.maxPrice}/t; you list at $${m.s.price}/t.` : `They ask $${m.s.price}/t; your limit is $${m.d.maxPrice}/t.`}
              {!other.ownerId && ' This is a fictional business: it replies instantly (accepts within about 25% of its limit, otherwise counters or declines).'}
            </p>
            {needsCheck && (
              <p className="warn">
                This pair needs the (simulated) verification before an exchange.{' '}
                <button className="btn alt" disabled={A.busy || !!S.verified[m.key]} onClick={() => A.verify(m.s, m.d)}>
                  {S.verified[m.key] ? 'Verified ✓' : 'Complete verification'}
                </button>
              </p>
            )}
            <button className="btn" disabled={A.busy || !(+q > 0) || !(+price >= 0)} onClick={send}>{A.busy ? 'Sending…' : 'Send offer'}</button>{' '}
            <button className="btn alt" onClick={onClose}>Cancel</button>
          </>
        )}
      </div>
    </div>
  )
}

// Matches for one of my listings: status, coach when short of matches, cards, near misses, other reasons.
function ListingMatches({ l, S, A, onOffer }: { l: Listing; S: State; A: Actions; onOffer: (m: Missed) => void }) {
  const [showAll, setShowAll] = useState(false)
  const mine = allMatches(S).filter(m => (l.type == 'Supply' ? m.s.id : m.d.id) == l.id)
  const scored = mine.filter((m): m is Scored => m.block === null).sort((x, y) => y.score - x.score)
  const ready = scored.filter(m => m.g[0] == 'eligible').length
  const near = mine.filter(offerable(S))
  const rest = mine.filter((m): m is Missed => m.block !== null && !offerable(S)(m))
  const shown = showAll ? scored : scored.slice(0, 3)
  const pendingWith = new Set(S.O.filter(o => o.status == 'pending').map(o => o.s + o.d))
  const otherSide = l.type == 'Supply' ? 'buyer' : 'seller'
  const c = scored.length < 3 ? coach(S, l) : null

  return (
    <section className="card listing-matches">
      <div className="lm-head">
        <h3>{l.type == 'Supply' ? '📦' : '🔎'} {l.mat} {l.type == 'Supply' && <ComplianceBadge level={complianceOf(S, l).level} />}</h3>
        <span className="s">
          {l.type == 'Supply' ? `${f1(avail(l))} t available · $${l.price}/t` : `${l.min}–${l.max} t · up to $${l.maxPrice}/t · ${l.maxKm} km`} · {l.loc}
        </span>
      </div>
      <div className="lm-status">
        <span className="tag eligible">✅ {ready} ready</span>{' '}
        <span className="tag restricted">⚠️ {scored.length - ready} need a check</span>{' '}
        <span className="tag blocked">💬 {near.length} near misses</span>
      </div>

      {c && (
        <div className="coach">
          <b>{scored.length == 0 ? 'No matches yet. Here’s how to get some:' : 'Want more matches?'}</b>
          {c.blockers.length > 0 && (
            <p className="s">Main blockers: {c.blockers.slice(0, 3).map(([k, n]) => `${BLOCKER_TEXT[k]} (${n})`).join(' · ')}</p>
          )}
          {c.tips.map(t => (
            <div className="action-item" key={t.id}>
              <div>
                <b>{t.label}</b> <span className="tag eligible">+{t.gain} match{t.gain == 1 ? '' : 'es'}</span>
                <div className="s">{t.detail}</div>
              </div>
              <button className="btn" disabled={A.busy || hasOpenExchange(S, l.id)} onClick={() => A.applyTip(l.id, t)}>Apply</button>
            </div>
          ))}
          {c.tips.length == 0 && <p className="s">No single change unlocks a match right now.</p>}
          {near.length > 0 && <p className="s">💬 {near.length} {otherSide}{near.length == 1 ? ' is' : 's are'} close. Make an offer below.</p>}
          <p className="s">🔔 You’ll be notified when someone posts a listing that matches this one.</p>
        </div>
      )}

      {shown.map(m => <MatchCard key={m.key} m={m} S={S} A={A} />)}
      {scored.length > 3 && (
        <button className="btn alt" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${scored.length} matches`}</button>
      )}

      {near.length > 0 && (
        <details open={scored.length == 0}>
          <summary>💬 Near misses: make an offer ({near.length})</summary>
          {near.slice(0, 8).map(m => {
            const other = l.type == 'Supply' ? m.d : m.s
            const pending = pendingWith.has(m.s.id + m.d.id)
            return (
              <div className="action-item" key={m.key}>
                <div><b>{other.biz}</b> · {other.loc}<div className="s">{m.block}</div></div>
                <button className="btn" disabled={A.busy || pending} onClick={() => onOffer(m)}>{pending ? 'Offer sent' : 'Make offer'}</button>
              </div>
            )
          })}
        </details>
      )}

      {rest.length > 0 && (
        <details>
          <summary>Other {otherSide}s that don’t fit ({rest.length})</summary>
          {rest.slice(0, 15).map(m => (
            <div className="s" key={m.key}>• <b>{(l.type == 'Supply' ? m.d : m.s).biz}</b>: {m.block}</div>
          ))}
        </details>
      )}
    </section>
  )
}

export default function Matches({ S, A }: { S: State; A: Actions }) {
  const [offerFor, setOfferFor] = useState<Missed | null>(null)
  const type = S.view == 'Supplier' ? 'Supply' : 'Demand'
  const mine = S.L.filter(l => l.ownerId == S.me.id && l.type == type && !l.arch)

  return (
    <>
      <h2>Matches</h2>
      <p className="s" style={{ marginTop: -6 }}>
        For your {type == 'Supply' ? 'supply listings' : 'requests'}. Matches update live as listings change.
      </p>

      {mine.length == 0 && (
        <div className="card">
          <p>{type == 'Supply' ? 'You haven’t listed anything yet.' : 'You haven’t posted a request yet.'}</p>
          <button className="btn" onClick={() => A.go('Create Listing')}>{type == 'Supply' ? 'List a material' : 'Request a material'}</button>
        </div>
      )}

      {mine.map(l => <ListingMatches key={l.id} l={l} S={S} A={A} onOffer={setOfferFor} />)}

      <details className="card assumptions">
        <summary>⚙️ Logistics assumptions (indicative, straight-line × multiplier)</summary>
        <div className="row">
          {SETTING_FIELDS.map(([k, n, step]) => (
            <NumField key={k} label={n} step={step} value={S.set[k]} onCommit={v => A.setSetting(k, v)} />
          ))}
          <div>
            <label>Journey</label>
            <select value={S.set.ret ? 'r' : 'o'} onChange={e => A.setSetting('ret', e.target.value == 'r')}>
              <option value="r">Return (2× km)</option>
              <option value="o">One-way</option>
            </select>
          </div>
        </div>
      </details>

      {offerFor && <OfferDialog m={offerFor} S={S} A={A} onClose={() => setOfferFor(null)} />}
    </>
  )
}
