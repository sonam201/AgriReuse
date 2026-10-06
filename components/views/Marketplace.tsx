'use client'

import { useState } from 'react'
import { CATEGORIES, USE_LABELS } from '@/lib/compliance'
import { avail, categoryOf, complianceOf, f1, fmtKm, hasOpenExchange, km, match, matchReasons } from '@/lib/logic'
import type { Demand, Listing, Match, State, Supply } from '@/lib/types'
import type { Actions } from '../App'
import { ComplianceBadge } from '../Compliance'
import { type Scored } from './Matches'
import RequestDialog from '../RequestDialog'
import { Pager, usePage } from '../Pager'

const catName = (id: string | null | undefined) => CATEGORIES.find(c => c.id == id)?.label ?? ''

// The other side's listing as a pair with mine (always supply × demand).
const pair = (S: State, mine: Listing, theirs: Listing) =>
  mine.type == 'Supply' ? match(S, mine, theirs as Demand) : match(S, theirs as Supply, mine as Demand)

// "Trade": send a deal request using one of my listings, or (buyers) straight away without one.
type Ask = { s: Supply; d?: Demand }
function TradeDialog({ x, S, A, onClose, onAsk }: { x: Listing; S: State; A: Actions; onClose: () => void; onAsk: (a: Ask) => void }) {
  const mineType = x.type == 'Supply' ? 'Demand' : 'Supply'
  const mine = S.L.filter(l => l.ownerId == S.me.id && l.type == mineType && !l.arch && !l.deletedAt && !l.private)
  const rows = mine.map(l => ({ l, m: pair(S, l, x) })).sort((a, b) => ((b.m as Scored)?.score ?? -1) - ((a.m as Scored)?.score ?? -1))
  const what = mineType == 'Supply' ? 'supply listing' : 'request'
  // Requests are allowed for any pair that's safe to trade; use, dates and kind are for the two sides to agree.
  const canAsk = (m: Match | null) => !!m && (m.block === null || !m.kinds?.some(k => k == 'compliance' || k == 'location' || k == 'min'))
  const pending = (s: string, d: string) => S.O.some(o => o.status == 'pending' && o.s == s && o.d == d)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={`Trade with ${x.biz}`} onClick={e => e.stopPropagation()}>
        <h3>🤝 Trade with {x.biz}</h3>
        <p className="s">{x.type == 'Supply' ? `${x.mat} · ${f1(avail(x))} t · ${x.price == 0 ? 'free' : `$${x.price}/t`}` : `Wants ${x.min}–${x.max} t for ${USE_LABELS[x.use1] ?? x.use1} · up to $${x.maxPrice}/t`} · {x.loc}</p>
        <p className="s">Send a deal request: the deal starts only when {x.biz} approves.</p>

        {rows.map(({ l, m }) => {
          const s = (l.type == 'Supply' ? l : x) as Supply, d = (l.type == 'Demand' ? l : x) as Demand
          const sent = pending(s.id, d.id)
          return (
            <div className="action-item" key={l.id}>
              <div>
                <b>Using your {l.mat}</b> {m && m.block === null && <span className="tag eligible">score {m.score}</span>}
                <div className="s">
                  {!m ? 'Can’t be offered for their use (compliance check)'
                    : m.block !== null ? (canAsk(m) ? `Not a standard match (${m.block}), but you can still ask` : `Can’t trade: ${m.block}`)
                    : m.notes.length ? '⚠ ' + m.notes.join(' · ') : 'Good fit: ' + matchReasons(m).join(' · ')}
                </div>
              </div>
              {canAsk(m) && (
                <button className="btn" disabled={A.busy || sent} onClick={() => { onClose(); onAsk({ s, d }) }}>
                  {sent ? 'Request sent ✓' : 'Send request'}
                </button>
              )}
            </div>
          )
        })}

        {x.type == 'Supply' ? (
          <div className="action-item">
            <div>
              <b>{rows.length ? 'Or request it directly' : 'Request it directly'}</b>
              <div className="s">No need to post a request first: choose an amount and price, and {x.biz} approves or counters.</div>
            </div>
            <button className="btn" disabled={A.busy || !S.me.canReceive || complianceOf(S, x).level == 'blocked'} onClick={() => { onClose(); onAsk({ s: x }) }}>Request this</button>
          </div>
        ) : (
          <div className="action-item">
            <div>
              <b>{rows.length ? 'Or post a new supply listing for this' : 'Post a supply listing for this'}</b>
              <div className="s">Sellers need a listing first (with the compliance check). It’s prefilled from their request.</div>
            </div>
            <button className="btn alt" onClick={() => { onClose(); A.respondWith(x.id) }}>➕ Post a {what}</button>
          </div>
        )}
        <p><button className="btn alt" onClick={onClose}>Close</button></p>
      </div>
    </div>
  )
}

// One listing from the other side, with how well it fits my best listing.
function ListingCard({ x, S, best, onTrade }: { x: Listing; S: State; best: Scored | null; onTrade: () => void }) {
  const dist = S.me.location ? km(S, S.me.location, x.loc) : null
  return (
    <div className="card market-card">
      <div className="mc-head">
        <h3>{x.mat} <span className="s">· {x.biz}</span></h3>
        {best && <span className="score" title={`Best fit with your listings: ${best.score}/100`}>{best.score}</span>}
      </div>
      <div className="s">
        {x.loc}{dist != null && isFinite(dist) ? (dist < 1 ? ' · same town as you' : ` · ${fmtKm(dist)} from you`) : ''} · {x.type == 'Supply'
          ? `${f1(avail(x))} t available · ${x.price == 0 ? 'free' : `$${x.price}/t`} · ${catName(categoryOf(x)) || x.cond} · for ${x.use.map(u => USE_LABELS[u] ?? u).join(', ')} · ${x.from} → ${x.to}`
          : `wants ${x.min}–${x.max} t for ${USE_LABELS[x.use1] ?? x.use1}${x.keywords?.length ? ` · ${x.keywords.join(', ')}` : ''} · ${x.accepts?.length ? x.accepts.map(catName).join(', ') : 'any kind'} · up to $${x.maxPrice}/t · ${x.from} → ${x.to}`}
      </div>
      {x.type == 'Supply' && (
        <div className="s"><ComplianceBadge level={complianceOf(S, x).level} />{x.declaredAt && ' · ✍️ seller declaration signed'}</div>
      )}
      <div className="s why">{best ? `Fits your ${best[x.type == 'Supply' ? 'd' : 's'].mat}: ${matchReasons(best).join(' · ') || 'a basic fit'}` : 'None of your listings fit this yet'}</div>
      <p><button className="btn" onClick={onTrade}>Trade</button></p>
    </div>
  )
}

export default function Marketplace({ S, A }: { S: State; A: Actions }) {
  const [tab, setTab] = useState<'browse' | 'mine'>('browse')
  const [tradeWith, setTradeWith] = useState<Listing | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const q = (S.q || '').toLowerCase()
  // Supplier → browse buyers' requests; buyer → browse supplies.
  const showType = S.view == 'Supplier' ? 'Demand' : 'Supply'
  const myType = showType == 'Supply' ? 'Demand' : 'Supply'
  const myActive = S.L.filter(l => l.ownerId == S.me.id && l.type == myType && !l.arch && !l.deletedAt && !l.private)
  const myAll = S.L.filter(l => l.ownerId == S.me.id && l.type == myType && !l.deletedAt && !l.private)

  // Each listing from the other side, with its best fit against my active listings; best first.
  const browse = S.L
    .filter(x => x.type == showType && !x.arch && !x.deletedAt && !x.private && x.ownerId != S.me.id)
    .filter(x => (x.mat + x.biz + x.loc + (x.type == 'Demand' ? (x.keywords ?? []).join(' ') : '')).toLowerCase().includes(q))
    .map(x => {
      const fits = myActive.map(l => pair(S, l, x)).filter((m): m is Scored => !!m && m.block === null)
      return { x, best: fits.sort((a, b) => b.score - a.score)[0] ?? null }
    })
    .sort((a, b) => (b.best?.score ?? -1) - (a.best?.score ?? -1))
  const browsePg = usePage(browse, q + S.view)
  const minePg = usePage(myAll, S.view)

  return (
    <>
      <h2>Marketplace</h2>
      <div className="mode-switch" role="tablist" aria-label="Marketplace view">
        <button role="tab" aria-selected={tab == 'browse'} className={tab == 'browse' ? 'on' : ''} onClick={() => setTab('browse')}>
          {showType == 'Demand' ? '🔎 Buyers’ requests' : '📦 Supplies available'} ({browse.length})
        </button>
        <button role="tab" aria-selected={tab == 'mine'} className={tab == 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
          My {myType == 'Supply' ? 'listings' : 'requests'} ({myAll.length})
        </button>
      </div>

      {tab == 'browse' && (
        <>
          <input placeholder={`🔍 Search ${showType == 'Demand' ? 'requests' : 'supplies'}: material, business, town`} value={S.q || ''}
            onChange={e => A.setFilter(e.target.value, 'All')} aria-label="Search the marketplace" />
          <p className="s">
            {showType == 'Demand' ? 'Businesses looking for material.' : 'Material on offer.'} Best fits with your {myType == 'Supply' ? 'listings' : 'requests'} first.
            {myActive.length == 0 && <> <button className="linkish" onClick={() => A.go('Create Listing')}>Post one</button> to see how each fits.</>}
          </p>
          {browse.length == 0 && (() => {
            const kind = showType == 'Demand' ? 'requests' : 'supply listings'
            const ownOfThatType = S.L.filter(l => l.ownerId == S.me.id && l.type == showType && !l.deletedAt).length
            return (
              <div className="card s">
                {q ? `No ${kind} match “${S.q}”.` : `No other business has posted ${kind} yet. New ones appear here live.`}
                {!q && ownOfThatType > 0 && (
                  <> Your own {ownOfThatType} {kind} aren’t shown here because you can’t trade with yourself; they’re under
                    {' '}<b>{showType == 'Supply' ? 'Supplier' : 'Receiver'} → Marketplace → My {showType == 'Supply' ? 'listings' : 'requests'}</b>.
                    To test trading, post from a second account.</>
                )}
              </div>
            )
          })()}
          {browsePg.items.map(({ x, best }) => <ListingCard key={x.id} x={x} S={S} best={best} onTrade={() => setTradeWith(x)} />)}
          <Pager {...browsePg} noun={showType == 'Demand' ? 'requests' : 'supplies'} />
        </>
      )}

      {tab == 'mine' && (
        <>
          {myAll.length == 0 && (
            <div className="card">
              <p>You haven’t posted any {myType == 'Supply' ? 'listings' : 'requests'} yet.</p>
              <button className="btn" onClick={() => A.go('Create Listing')}>{myType == 'Supply' ? 'List a material' : 'Request a material'}</button>
            </div>
          )}
          {minePg.items.map(l => (
            <div className="card" key={l.id}>
              <h3>{l.mat} {l.arch ? <span className="tag blocked">archived</span> : null}</h3>
              <div className="s">
                {l.loc} · {l.type == 'Supply'
                  ? `${f1(avail(l))} t available of ${l.qty} t · ${l.price == 0 ? 'free' : `$${l.price}/t`} · for ${l.use.map(u => USE_LABELS[u] ?? u).join(', ')}`
                  : `${l.min}–${l.max} t for ${USE_LABELS[l.use1] ?? l.use1}${l.keywords?.length ? ` · ${l.keywords.join(', ')}` : ''} · up to $${l.maxPrice}/t`} · {l.from} → {l.to}
              </div>
              {l.type == 'Supply' && <div className="s"><ComplianceBadge level={complianceOf(S, l).level} /></div>}
              <p>
                <button className="btn" onClick={() => A.go('Matches')}>See matches</button>{' '}
                <button className="btn alt" disabled={A.busy || hasOpenExchange(S, l.id)} onClick={() => A.startEdit(l.id)}
                  title={hasOpenExchange(S, l.id) ? 'An exchange is in progress; finish or cancel it to edit' : undefined}>Edit</button>{' '}
                <button className="btn alt" disabled={A.busy} onClick={() => A.toggleArchive(l.id)}>{l.arch ? 'Restore' : 'Archive'}</button>{' '}
                <button className="btn alt danger" disabled={A.busy} onClick={() => A.deleteListing(l.id)}>Delete</button>
              </p>
            </div>
          ))}
          <Pager {...minePg} noun={myType == 'Supply' ? 'listings' : 'requests'} />
        </>
      )}

      {tradeWith && <TradeDialog x={tradeWith} S={S} A={A} onClose={() => setTradeWith(null)} onAsk={setAsk} />}
      {ask && <RequestDialog s={ask.s} d={ask.d} S={S} A={A} onClose={() => setAsk(null)} />}
    </>
  )
}
