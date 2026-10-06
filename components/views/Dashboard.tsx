'use client'

import { useEffect, useState } from 'react'
import { CATEGORIES, USE_LABELS } from '@/lib/compliance'
import { STEP_ACTION } from '@/lib/data'
import {
  allMatches, avail, categoryOf, complianceOf, counterpartyName, daysUntil, endingSoon, f1, hasOpenExchange, isOpen,
  keywordTokens, kmNotDriven, listing, money, myBenefit, myMatches, myTransactions, nextStep, sideTransactions, turn,
  txCo2, weekly, wheelieBins,
} from '@/lib/logic'
import type { Demand, Listing, State, Supply } from '@/lib/types'
import type { Actions } from '../App'
import { ComplianceBadge } from '../Compliance'
import WeeklyChart from '../WeeklyChart'
import { Pager, usePage } from '../Pager'
import { MatchCard, type Scored } from './Matches'

const catName = (id: string | null | undefined) => CATEGORIES.find(c => c.id == id)?.label ?? 'other'
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0 }
const top = (xs: string[], n = 3) =>
  Object.entries(xs.reduce<Record<string, number>>((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => ({ k, c }))
const $range = (xs: number[]) => xs.length ? (Math.min(...xs) == Math.max(...xs) ? `$${Math.min(...xs)}/t` : `$${Math.min(...xs)}–$${Math.max(...xs)}/t`) : '—'

// Live price and demand picture for the kinds of material I list (or ask for).
function MarketInsight({ S, mine }: { S: State; mine: Listing[] }) {
  const supplier = S.view == 'Supplier'
  const others = S.L.filter(l => l.ownerId != S.me.id && !l.arch && !l.deletedAt)
  if (supplier) {
    const cats = new Set(mine.map(l => categoryOf(l as Supply)).filter(Boolean) as string[])
    const words = new Set(mine.flatMap(l => keywordTokens(l.mat)))
    const buyers = (others.filter(l => l.type == 'Demand') as Demand[]).filter(d =>
      !mine.length || !d.accepts?.length || d.accepts.some(c => cats.has(c)) ||
      keywordTokens([d.mat, ...(d.keywords ?? [])].join(' ')).some(w => words.has(w)))
    const prices = buyers.map(d => d.maxPrice)
    return (
      <div className="card">
        <h3>💲 What buyers are paying</h3>
        {buyers.length == 0 ? <p className="s">No buyer requests for your kinds of material yet.</p> : (
          <div className="insight">
            <div><span className="big">{buyers.length}</span><span className="s">buyer request{buyers.length == 1 ? '' : 's'} {mine.length ? 'for your kinds of material' : 'on AgriReuse'}</span></div>
            <div><span className="big">{$range(prices)}</span><span className="s">their budgets (typical ${median(prices)}/t)</span></div>
            <div><span className="big">{buyers.filter(d => d.maxPrice == 0).length}</span><span className="s">only want it free</span></div>
            <div className="s">Most want it for: {top(buyers.map(d => USE_LABELS[d.use1] ?? d.use1)).map(t => `${t.k} (${t.c})`).join(', ')}</div>
          </div>
        )}
      </div>
    )
  }
  const anyKind = !mine.length || mine.some(l => !(l as Demand).accepts?.length)
  const cats = new Set(mine.flatMap(l => (l as Demand).accepts ?? []))
  const words = new Set(mine.flatMap(l => keywordTokens([l.mat, ...((l as Demand).keywords ?? [])].join(' '))))
  const sellers = (others.filter(l => l.type == 'Supply') as Supply[]).filter(s =>
    avail(s) > 0 && complianceOf(S, s).level != 'blocked' &&
    (anyKind || cats.has(categoryOf(s) ?? '') || keywordTokens(s.mat).some(w => words.has(w))))
  const paid = sellers.filter(s => s.price > 0).map(s => s.price)
  return (
    <div className="card">
      <h3>💲 What sellers are offering</h3>
      {sellers.length == 0 ? <p className="s">No supplies of the kinds you want yet.</p> : (
        <div className="insight">
          <div><span className="big">{sellers.length}</span><span className="s">suppl{sellers.length == 1 ? 'y' : 'ies'} {mine.length ? 'of the kinds you want' : 'on AgriReuse'}</span></div>
          <div><span className="big">{f1(sellers.reduce((a, s) => a + avail(s), 0))} t</span><span className="s">available in total</span></div>
          <div><span className="big">{sellers.filter(s => s.price == 0).length}</span><span className="s">offered free · paid ones {$range(paid)}</span></div>
          <div className="s">Most common: {top(sellers.map(s => catName(categoryOf(s)))).map(t => `${t.k} (${t.c})`).join(', ')}</div>
        </div>
      )}
    </div>
  )
}

export default function Dashboard({ S, A }: { S: State; A: Actions }) {
  const [reviewKey, setReviewKey] = useState<string | null>(null)

  const supplier = S.view == 'Supplier'
  // Listings, numbers and market picture follow the side being viewed; to-dos cover both sides.
  const myListings = S.L.filter(l => l.ownerId == S.me.id && !l.deletedAt && !l.private && l.type == (supplier ? 'Supply' : 'Demand'))
  const active = myListings.filter(l => !l.arch)
  const glancePg = usePage(active, S.view)
  const txs = sideTransactions(S)
  const allOpen = myTransactions(S).filter(isOpen)
  const open = txs.filter(isOpen)
  const done = txs.filter(t => t.step == 6)

  const all = allMatches(S)
  const scored = myMatches(S).filter((m): m is Scored => m.block === null)
  const restricted = scored.filter(m => m.g[0] == 'restricted').sort((x, y) => y.score - x.score)
  const inProgress = new Set(open.map(t => t.s + t.d))
  const newMatches = scored.filter(m => !inProgress.has(m.key))
  const reviewing = scored.find(m => m.key == reviewKey)

  const offersToAnswer = S.O.filter(o => o.to == S.me.id && o.status == 'pending')
  const myTurn = allOpen.filter(t => turn(S, t) != 'waiting')
  const waiting = allOpen.filter(t => turn(S, t) == 'waiting')
  const ending = endingSoon(S)
  const todo = offersToAnswer.length + myTurn.length + restricted.length + ending.length

  const tonnes = done.reduce((a, t) => a + t.q, 0)
  const benefit = done.reduce((a, t) => a + myBenefit(S, t), 0)
  const co2 = done.reduce((a, t) => a + txCo2(S, t), 0)

  useEffect(() => {
    if (!reviewKey) return
    const key = (e: KeyboardEvent) => { if (e.key == 'Escape') setReviewKey(null) }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [reviewKey])

  const stats: [string, string | number][] = supplier
    ? [
        ['Tonnes diverted from waste', f1(tonnes)],
        ['Disposal avoided + sales (est.)', money(benefit)],
        ['CO₂e saved (kg, est.)', f1(co2)],
        ['Completed exchanges', done.length],
      ]
    : [
        ['Tonnes sourced', f1(tonnes)],
        ['Saved vs. alternatives (est.)', money(benefit)],
        ['CO₂e saved (kg, est.)', f1(co2)],
        ['Completed exchanges', done.length],
      ]

  return (
    <>
      <h2>Kia ora, {S.me.businessName}</h2>
      <p className="s" style={{ marginTop: -6 }}>
        {supplier ? 'Supplier dashboard: turn your surplus into value.' : 'Receiver dashboard: source local material for reuse.'}
        {S.me.location ? ` · ${S.me.location}` : ''}
      </p>

      {/* 1. Waiting on you: things that only move when you click */}
      <div className="card">
        <h3>Waiting on you {todo > 0 && <span className="tag restricted">{todo}</span>}</h3>
        {todo == 0 && <p className="s">Nothing is waiting on you right now ✓</p>}

        {offersToAnswer.map(o => {
          const s = S.L.find(l => l.id == o.s), d = S.L.find(l => l.id == o.d)
          if (!s || !d) return null
          const other = s.ownerId == S.me.id ? d : s
          return (
            <div className="action-item" key={o.id}>
              <div>
                <b>Deal request from {other.biz}: ${o.price}/t for {f1(o.q)} t</b>
                <div className="s">{s.mat}{o.message ? ` · “${o.message}”` : ''} · approve, counter or decline</div>
              </div>
              <button className="btn" onClick={() => A.go('Transactions')}>Reply</button>
            </div>
          )
        })}

        {myTurn.map(t => {
          const n = nextStep(t), action = STEP_ACTION[n], needsDetails = n == 2 || n == 4
          return (
            <div className="action-item" key={t.id}>
              <div>
                <b>Your turn: {action.toLowerCase()}</b>
                <div className="s">
                  {listing(S, t.s).mat}, {f1(t.q)} t with {counterpartyName(S, t)}
                  {t.pickupAt && n == 4 ? ` · pickup ${new Date(t.pickupAt).toLocaleString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}
                </div>
              </div>
              {needsDetails
                ? <button className="btn" onClick={() => A.go('Transactions')}>{action} →</button>
                : <button className="btn" disabled={A.busy} onClick={() => A.advance(t.id)}>{action}</button>}
            </div>
          )
        })}

        {restricted.slice(0, 3).map(m => (
          <div className="action-item" key={m.key}>
            <div>
              <b>Verification needed</b>
              <div className="s">{m.s.mat} · {m.s.biz} → {m.d.biz}</div>
            </div>
            <button className="btn alt" onClick={() => setReviewKey(m.key)}>Review</button>
          </div>
        ))}

        {ending.map(l => {
          const days = daysUntil(l.to), left = l.type == 'Supply' ? `${f1(avail(l))} t still unmatched` : 'request still open'
          return (
            <div className="action-item" key={l.id}>
              <div>
                <b>{days < 0 ? `Ended ${-days} day(s) ago` : days == 0 ? 'Ends today' : `Ends in ${days} day(s)`}: {l.mat}</b>
                <div className="s">{left} · available until {l.to}</div>
              </div>
              <span>
                <button className="btn" disabled={A.busy} onClick={() => A.extendListing(l.id, 14)}>Extend 2 weeks</button>{' '}
                <button className="btn alt" disabled={A.busy} onClick={() => A.toggleArchive(l.id)}>Archive</button>
              </span>
            </div>
          )
        })}

        {newMatches.length > 0 && (
          <p className="new-matches">
            🤝 <b>{newMatches.length} match{newMatches.length == 1 ? '' : 'es'}</b> for your {supplier ? 'listings' : 'requests'}{' '}
            <button className="linkish" onClick={() => A.go('Matches')}>See matches →</button>
          </p>
        )}
      </div>

      {/* 2. Your listings at a glance */}
      <div className="card">
        <h3>Your {supplier ? 'listings' : 'requests'} at a glance</h3>
        {active.length == 0 ? (
          <div className="action-item">
            <div>
              <b>{supplier ? 'You have nothing listed right now.' : 'You have no open requests.'}</b>
              <div className="s">{supplier ? 'List surplus or waste and we’ll find businesses that can reuse it.' : 'Say what material you need and we’ll show you who has it.'}</div>
            </div>
            <span>
              <button className="btn" onClick={() => A.go('Create Listing')}>{supplier ? 'List a material' : 'Request a material'}</button>{' '}
              <button className="btn alt" onClick={() => A.go('Marketplace')}>Browse the marketplace</button>
            </span>
          </div>
        ) : (
          <>
          <div className="glance">
            {glancePg.items.map(l => {
              const ms = all.filter((m): m is Scored => m.block === null && (supplier ? m.s.id : m.d.id) == l.id)
              const good = ms.filter(m => m.notes.length == 0).length
              const deals = S.T.filter(t => (t.s == l.id || t.d == l.id) && isOpen(t)).length
              const days = daysUntil(l.to)
              return (
                <div className="glance-row" key={l.id}>
                  <div className="glance-main">
                    <b>{l.mat}</b> {l.type == 'Supply' && <ComplianceBadge level={complianceOf(S, l).level} />}
                    <div className="s">
                      {l.type == 'Supply' ? `${f1(avail(l))} of ${l.qty} t left · ${l.price == 0 ? 'free' : `$${l.price}/t`}` : `wants ${l.min}–${l.max} t · up to $${l.maxPrice}/t`}
                      {' · '}{days < 0 ? 'ended' : days == 0 ? 'ends today' : `ends in ${days} day${days == 1 ? '' : 's'}`}
                    </div>
                  </div>
                  <div className="glance-figs">
                    <span><b>{ms.length}</b> match{ms.length == 1 ? '' : 'es'}{ms.length > good ? ` (${good} clean)` : ''}</span>
                    <span><b>{deals}</b> deal{deals == 1 ? '' : 's'} in progress</span>
                  </div>
                  <span className="glance-actions">
                    <button className="btn" onClick={() => A.go('Matches')}>See matches</button>{' '}
                    <button className="btn alt" disabled={A.busy || hasOpenExchange(S, l.id)} onClick={() => A.startEdit(l.id)}>Edit</button>
                  </span>
                </div>
              )
            })}
          </div>
          <Pager {...glancePg} noun={supplier ? 'listings' : 'requests'} />
          </>
        )}
      </div>

      {/* 3. Market picture for my kinds of material */}
      <MarketInsight S={S} mine={active} />

      {/* 4. Your results and CO2e graph: always shown once you have a listing (motivation) */}
      {myListings.length > 0 && (
        <section aria-label="Your results">
          <h3 className="t">Your results so far</h3>
          <div className="grid">
            {stats.map(([label, value]) => (
              <div className="card" key={label}><div className="big">{value}</div><div className="s">{label}</div></div>
            ))}
          </div>
          {done.length > 0 && (
            <p className="s equiv-caption">
              That’s about 🚗 <b>{kmNotDriven(co2).toLocaleString('en-NZ')} km</b> of driving avoided and
              🗑️ <b>{wheelieBins(tonnes).toLocaleString('en-NZ')} wheelie bins</b> kept out of landfill (rough equivalents).
            </p>
          )}
          <div className="card">
            <WeeklyChart buckets={weekly(txs, S)} title="🌱 Your CO₂e saved per week" />
          </div>
        </section>
      )}

      {/* 5. Waiting on others: folded away */}
      {waiting.length > 0 && (
        <details className="card fold">
          <summary>⏳ Waiting on others ({waiting.length})</summary>
          {waiting.map(t => (
            <div className="s" key={t.id}>
              {listing(S, t.s).mat}, {f1(t.q)} t: waiting for {counterpartyName(S, t)} to {STEP_ACTION[nextStep(t)].toLowerCase()}
            </div>
          ))}
        </details>
      )}

      {reviewing && (
        <div className="modal-backdrop" onClick={() => setReviewKey(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Review match" onClick={e => e.stopPropagation()}>
            <MatchCard m={reviewing} S={S} A={A} />
            <button className="btn alt" onClick={() => setReviewKey(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
