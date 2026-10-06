'use client'

import { useState } from 'react'
import { USE_LABELS } from '@/lib/compliance'
import type { OfferResult } from '@/lib/db'
import {
  allMatches, avail, canOffer, coach, complianceOf, f1, fmtKm, gate, hasOpenExchange, matchReasons, money,
} from '@/lib/logic'
import type { BlockKind, Listing, Match, State } from '@/lib/types'
import type { Actions } from '../App'
import { ComplianceBadge } from '../Compliance'

export type Scored = Extract<Match, { block: null }>
type Missed = Extract<Match, { block: string }>

// One match, from my side: it shows the OTHER business (my own listing is the section header).
export function MatchCard({ m, S, A, onStarted, onOffer }: {
  m: Scored; S: State; A: Actions; onStarted?: () => void; onOffer?: (m: Match) => void
}) {
  const e = m.e
  const iSell = m.s.ownerId == S.me.id
  const other = iSell ? m.d : m.s
  const pending = S.O.some(o => o.status == 'pending' && o.s == m.s.id && o.d == m.d.id)
  return (
    <div className="card match-card">
      <div className="mc-head">
        <h3>{other.biz} <span className="s">· {other.loc} · {fmtKm(e.dist)}</span></h3>
        <span className="score" title="Match score out of 100">{m.score}</span>
      </div>
      <div className="s">
        {iSell
          ? `Wants ${m.d.min}–${m.d.max} t for ${USE_LABELS[m.d.use1] ?? m.d.use1} · up to $${m.d.maxPrice}/t`
          : <>{m.s.mat} · {f1(avail(m.s))} t · {m.s.price == 0 ? 'free' : `$${m.s.price}/t`} <ComplianceBadge level={complianceOf(S, m.s).level} /></>}
      </div>
      <div className="s why">Why: {matchReasons(m).join(' · ') || 'a basic fit'}</div>
      {m.notes.length > 0 && <ul className="notes">{m.notes.map(n => <li key={n}>⚠ {n}</li>)}</ul>}
      <div className="s">
        {iSell ? `You gain ${money(e.sup)} · they save ${money(e.rec)}` : `You save ${money(e.rec)} after ${money(e.tc)} transport`}
        {' '}· ~{f1(e.net)} kg CO₂e saved
      </div>
      <details>
        <summary>Full breakdown</summary>
        <table><tbody>
          <tr><td>{f1(m.q)} t · {e.t} trip(s) · ~{e.mins} min each way</td><td></td></tr>
          <tr><td>Transport (buyer pays)</td><td>{money(e.tc)}</td></tr>
          <tr><td>Seller: sale + disposal avoided</td><td className={e.sup < 0 ? 'neg' : ''}>{money(e.sup)}</td></tr>
          <tr><td>Buyer: saving vs usual supply</td><td className={e.rec < 0 ? 'neg' : ''}>{money(e.rec)}</td></tr>
          <tr><td>CO₂e saved (range {f1(e.lo)}…{f1(e.hi)})</td><td className={e.net < 0 ? 'neg' : ''}>{f1(e.net)} kg</td></tr>
        </tbody></table>
        <div className="s">
          Score: {m.fac.map(([n, w, v]) => `${n} ${Math.round(w * Math.max(0, v))}/${w}`).join(' · ')}.
          Estimates use illustrative factors.
        </div>
      </details>
      {m.g[0] == 'eligible' ? (
        <p>
          <button className="btn" disabled={A.busy} onClick={() => { A.startTx(m.key); onStarted?.() }}>
            {onStarted ? 'Confirm and start exchange' : 'Start exchange'}
          </button>{' '}
          {/* An offer can bridge price, amount or transport cost (see canOffer). */}
          {onOffer && canOffer(m) && (
            <button className="btn alt" disabled={A.busy || pending} onClick={() => onOffer(m)}>{pending ? 'Offer sent' : 'Make an offer'}</button>
          )}
        </p>
      ) : (
        <div className="warn">
          ⚠️ Needs a check first: {m.g[1]}{' '}
          <button className="btn alt" disabled={A.busy} onClick={() => A.verify(m.s, m.d)}>Complete verification (simulated)</button>
        </div>
      )}
    </div>
  )
}

const BLOCKER_TEXT: Record<BlockKind, string> = {
  price: 'over their budget', distance: 'too far', min: 'too small a load', use: 'use not offered', category: 'kind of material',
  dates: 'dates', compliance: 'compliance', location: 'location',
}

// Offer on a match whose only issue is price, amount or transport cost.
export function OfferDialog({ m, S, A, onClose }: { m: Match; S: State; A: Actions; onClose: () => void }) {
  const iSupply = m.s.ownerId == S.me.id
  const maxQ = Math.min(avail(m.s), m.d.max)
  const [price, setPrice] = useState(String(iSupply ? Math.min(m.s.price, m.d.maxPrice) : m.s.price))
  const [q, setQ] = useState(String(+maxQ.toFixed(2)))
  const [msg, setMsg] = useState('')
  const [result, setResult] = useState<OfferResult | null>(null)
  const needsCheck = gate(S, m.s, m.d, m.key)[0] == 'restricted'
  const other = iSupply ? m.d : m.s
  const reason = m.block ?? m.notes.join(' · ')

  async function send() {
    const r = await A.sendOffer(m.s.id, m.d.id, +price, +q, msg)
    if (r) setResult(r)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label="Make an offer" onClick={e => e.stopPropagation()}>
        <h3>💬 Make an offer to {other.biz}</h3>
        <p className="s">{m.s.mat} · {other.loc}{reason ? ` · ${reason}` : ''}</p>
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
              {iSupply ? `Their budget is $${m.d.maxPrice}/t; you list at $${m.s.price}/t.` : `They ask $${m.s.price}/t; your budget is $${m.d.maxPrice}/t.`}
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

// Matches for one of my listings. The header only names the listing (its details live in the
// Marketplace); cards are about the other businesses.
function ListingMatches({ l, S, A, onOffer }: { l: Listing; S: State; A: Actions; onOffer: (m: Match) => void }) {
  const [showAll, setShowAll] = useState(false)
  const mine = allMatches(S).filter(m => (l.type == 'Supply' ? m.s.id : m.d.id) == l.id)
  const scored = mine.filter((m): m is Scored => m.block === null).sort((x, y) => y.score - x.score)
  const good = scored.filter(m => m.notes.length == 0).length

  const rest = mine.filter((m): m is Missed => m.block !== null)
  const shown = showAll ? scored : scored.slice(0, 3)
  const otherSide = l.type == 'Supply' ? 'buyer' : 'seller'
  const c = good < 3 ? coach(S, l) : null

  return (
    <section className="card listing-matches">
      <div className="lm-head">
        <h3>{l.type == 'Supply' ? '📦' : '🔎'} {l.mat}</h3>
        <span className="s">
          {scored.length} match{scored.length == 1 ? '' : 'es'}{scored.length > good ? ` (${scored.length - good} with ⚠ notes)` : ''}
          {' '}
          · <button className="linkish" disabled={hasOpenExchange(S, l.id)} onClick={() => A.startEdit(l.id)}>Edit listing</button>
        </span>
      </div>

      {c && (c.tips.length > 0 || scored.length == 0) && (
        <div className="coach">
          <b>{scored.length == 0 ? 'No matches yet. Here’s how to get some:' : 'Get more good matches:'}</b>
          {c.blockers.length > 0 && scored.length == 0 && (
            <p className="s">Main reasons: {c.blockers.slice(0, 3).map(([k, n]) => `${BLOCKER_TEXT[k]} (${n})`).join(' · ')}</p>
          )}
          {c.tips.map(t => (
            <div className="action-item" key={t.id}>
              <div>
                <b>{t.label}</b> <span className="tag eligible">+{t.gain} good match{t.gain == 1 ? '' : 'es'}</span>
                <div className="s">{t.detail}</div>
              </div>
              <button className="btn" disabled={A.busy || hasOpenExchange(S, l.id)} onClick={() => A.applyTip(l.id, t)}>Apply</button>
            </div>
          ))}
          {scored.length == 0 && <p className="s">🔔 You’ll be notified when someone posts a listing that matches this one.</p>}
        </div>
      )}

      {shown.map(m => <MatchCard key={m.key} m={m} S={S} A={A} onOffer={onOffer} />)}
      {scored.length > 3 && (
        <button className="btn alt" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${scored.length} matches`}</button>
      )}


      {rest.length > 0 && (
        <details>
          <summary>{rest.length} {otherSide}{rest.length == 1 ? '' : 's'} that don’t fit</summary>
          {rest.slice(0, 15).map(m => (
            <div className="s" key={m.key}>• <b>{(l.type == 'Supply' ? m.d : m.s).biz}</b>: {m.block}</div>
          ))}
        </details>
      )}
    </section>
  )
}

export default function Matches({ S, A }: { S: State; A: Actions }) {
  const [offerFor, setOfferFor] = useState<Match | null>(null)
  const type = S.view == 'Supplier' ? 'Supply' : 'Demand'
  const mine = S.L.filter(l => l.ownerId == S.me.id && l.type == type && !l.arch)

  return (
    <>
      <h2>Matches</h2>
      <p className="s" style={{ marginTop: -6 }}>
        A match is a live listing that’s safe to trade with the same kind of material or a keyword in common. Best first; ⚠ notes flag anything to sort out.
      </p>

      {mine.length == 0 && (
        <div className="card">
          <p>{type == 'Supply' ? 'You haven’t listed anything yet.' : 'You haven’t posted a request yet.'}</p>
          <button className="btn" onClick={() => A.go('Create Listing')}>{type == 'Supply' ? 'List a material' : 'Request a material'}</button>
        </div>
      )}

      {mine.map(l => <ListingMatches key={l.id} l={l} S={S} A={A} onOffer={setOfferFor} />)}

      {offerFor && <OfferDialog m={offerFor} S={S} A={A} onClose={() => setOfferFor(null)} />}
    </>
  )
}
