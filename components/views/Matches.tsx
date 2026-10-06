'use client'

import { useState } from 'react'
import { USE_LABELS } from '@/lib/compliance'
import {
  allMatches, avail, coach, complianceOf, f1, fmtKm, hasOpenExchange, isOpen, matchReasons, money,
} from '@/lib/logic'
import type { BlockKind, Listing, Match, State } from '@/lib/types'
import type { Actions } from '../App'
import { ComplianceBadge } from '../Compliance'
import RequestDialog from '../RequestDialog'
import { Pager, usePage } from '../Pager'

export type Scored = Extract<Match, { block: null }>
type Missed = Extract<Match, { block: string }>

// One match, from my side: it shows the OTHER business (my own listing is the section header).
export function MatchCard({ m, S, A }: { m: Scored; S: State; A: Actions }) {
  const [asking, setAsking] = useState(false)
  const e = m.e
  const iSell = m.s.ownerId == S.me.id
  const other = iSell ? m.d : m.s
  const pending = S.O.some(o => o.status == 'pending' && o.s == m.s.id && o.d == m.d.id)
  const inDeal = S.T.some(t => t.s == m.s.id && t.d == m.d.id && isOpen(t))
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
      {inDeal ? (
        <p><button className="btn alt" onClick={() => A.go('Transactions')}>Deal in progress → Transactions</button></p>
      ) : m.g[0] == 'eligible' ? (
        <p>
          <button className="btn" disabled={A.busy || pending} onClick={() => setAsking(true)}>
            {pending ? 'Request sent ✓ waiting for reply' : 'Send deal request'}
          </button>
        </p>
      ) : (
        <div className="warn">
          ⚠️ Needs a check first: {m.g[1]}{' '}
          <button className="btn alt" disabled={A.busy} onClick={() => A.verify(m.s, m.d)}>Complete verification (simulated)</button>
        </div>
      )}
      {asking && <RequestDialog s={m.s} d={m.d} S={S} A={A} onClose={() => setAsking(false)} />}
    </div>
  )
}

const BLOCKER_TEXT: Record<BlockKind, string> = {
  price: 'over their budget', distance: 'too far', min: 'too small a load', use: 'use not offered', category: 'kind of material',
  dates: 'dates', compliance: 'compliance', location: 'location',
}

// Matches for one of my listings. The header only names the listing (its details live in the
// Marketplace); cards are about the other businesses.
function ListingMatches({ l, S, A }: { l: Listing; S: State; A: Actions }) {
  const mine = allMatches(S).filter(m => (l.type == 'Supply' ? m.s.id : m.d.id) == l.id)
  const scored = mine.filter((m): m is Scored => m.block === null).sort((x, y) => y.score - x.score)
  const good = scored.filter(m => m.notes.length == 0).length

  const rest = mine.filter((m): m is Missed => m.block !== null)
  const pg = usePage(scored, l.id)
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
        </div>
      )}
      {pg.items.map(m => <MatchCard key={m.key} m={m} S={S} A={A} />)}
      <Pager {...pg} noun="matches" />


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
  const type = S.view == 'Supplier' ? 'Supply' : 'Demand'
  const mine = S.L.filter(l => l.ownerId == S.me.id && l.type == type && !l.arch && !l.deletedAt && !l.private)

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

      {mine.map(l => <ListingMatches key={l.id} l={l} S={S} A={A} />)}

    </>
  )
}
