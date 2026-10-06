'use client'

import { useState } from 'react'
import { CATEGORIES, USE_LABELS } from '@/lib/compliance'
import { avail, canOffer, categoryOf, complianceOf, f1, fmtKm, hasOpenExchange, km, match, matchReasons } from '@/lib/logic'
import type { Demand, Listing, Match, State, Supply } from '@/lib/types'
import type { Actions } from '../App'
import { ComplianceBadge } from '../Compliance'
import { OfferDialog, type Scored } from './Matches'

const catName = (id: string | null | undefined) => CATEGORIES.find(c => c.id == id)?.label ?? ''

// The other side's listing as a pair with mine (always supply × demand).
const pair = (S: State, mine: Listing, theirs: Listing) =>
  mine.type == 'Supply' ? match(S, mine, theirs as Demand) : match(S, theirs as Supply, mine as Demand)

// "Trade": which of my listings fit this one, and what I can do with each.
function TradeDialog({ x, S, A, onClose, onOffer }: { x: Listing; S: State; A: Actions; onClose: () => void; onOffer: (m: Match) => void }) {
  const mineType = x.type == 'Supply' ? 'Demand' : 'Supply'
  const mine = S.L.filter(l => l.ownerId == S.me.id && l.type == mineType && !l.arch && !l.deletedAt)
  const rows = mine.map(l => ({ l, m: pair(S, l, x) })).sort((a, b) => ((b.m as Scored)?.score ?? -1) - ((a.m as Scored)?.score ?? -1))
  const what = mineType == 'Supply' ? 'supply listing' : 'request'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={`Trade with ${x.biz}`} onClick={e => e.stopPropagation()}>
        <h3>🤝 Trade with {x.biz}</h3>
        <p className="s">{x.type == 'Supply' ? `${x.mat} · ${f1(avail(x))} t · ${x.price == 0 ? 'free' : `$${x.price}/t`}` : `Wants ${x.min}–${x.max} t for ${USE_LABELS[x.use1] ?? x.use1}`} · {x.loc}</p>

        {rows.length == 0 && <p>You don’t have an active {what} yet. Post one for this and it will match straight away.</p>}
        {rows.map(({ l, m }) => {
          const ok = m && m.block === null
          return (
            <div className="action-item" key={l.id}>
              <div>
                <b>Your {l.mat}</b> {ok && <span className="tag eligible">score {(m as Scored).score}</span>}
                <div className="s">
                  {!m ? 'Can’t be offered for their use (compliance check)'
                    : m.block !== null ? `Doesn’t fit: ${m.block}`
                    : (m as Scored).notes.length ? '⚠ ' + (m as Scored).notes.join(' · ') : 'Good fit: ' + matchReasons(m as Scored).join(' · ')}
                </div>
              </div>
              {ok && (m.g[0] == 'eligible' ? (
                <span>
                  <button className="btn" disabled={A.busy} onClick={() => { A.startTx(m.key); onClose() }}>Start exchange</button>{' '}
                  {canOffer(m as Scored) && <button className="btn alt" disabled={A.busy} onClick={() => { onClose(); onOffer(m) }}>Make an offer</button>}
                </span>
              ) : (
                <button className="btn alt" disabled={A.busy} onClick={() => A.verify(m.s, m.d)}>Verify first (simulated)</button>
              ))}
            </div>
          )
        })}

        <p>
          <button className="btn alt" onClick={() => { onClose(); A.respondWith(x.id) }}>➕ Post a {what} for this</button>{' '}
          <button className="btn alt" onClick={onClose}>Close</button>
        </p>
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
  const [offerFor, setOfferFor] = useState<Match | null>(null)
  const q = (S.q || '').toLowerCase(), lim = S.lim || 24
  // Supplier → browse buyers' requests; buyer → browse supplies.
  const showType = S.view == 'Supplier' ? 'Demand' : 'Supply'
  const myType = showType == 'Supply' ? 'Demand' : 'Supply'
  const myActive = S.L.filter(l => l.ownerId == S.me.id && l.type == myType && !l.arch && !l.deletedAt)
  const myAll = S.L.filter(l => l.ownerId == S.me.id && l.type == myType && !l.deletedAt)

  // Each listing from the other side, with its best fit against my active listings; best first.
  const browse = S.L
    .filter(x => x.type == showType && !x.arch && !x.deletedAt && x.ownerId != S.me.id)
    .filter(x => (x.mat + x.biz + x.loc + (x.type == 'Demand' ? (x.keywords ?? []).join(' ') : '')).toLowerCase().includes(q))
    .map(x => {
      const fits = myActive.map(l => pair(S, l, x)).filter((m): m is Scored => !!m && m.block === null)
      return { x, best: fits.sort((a, b) => b.score - a.score)[0] ?? null }
    })
    .sort((a, b) => (b.best?.score ?? -1) - (a.best?.score ?? -1))

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
          {browse.slice(0, lim).map(({ x, best }) => <ListingCard key={x.id} x={x} S={S} best={best} onTrade={() => setTradeWith(x)} />)}
          {browse.length > lim && <button className="btn" onClick={() => A.showMore(lim + 24)}>Show more</button>}
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
          {myAll.map(l => (
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
        </>
      )}

      {tradeWith && <TradeDialog x={tradeWith} S={S} A={A} onClose={() => setTradeWith(null)} onOffer={setOfferFor} />}
      {offerFor && <OfferDialog m={offerFor} S={S} A={A} onClose={() => setOfferFor(null)} />}
    </>
  )
}
