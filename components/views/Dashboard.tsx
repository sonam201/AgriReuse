'use client'

import { useEffect, useState } from 'react'
import { STEPS } from '@/lib/data'
import {
  avail, counterpartyName, daysUntil, endingSoon, f1, fmtKm, isOpen, kmNotDriven, listing, matchReasons, money,
  myBenefit, myMatches, myTransactions, sideTransactions, stepActor, turn, txCo2, weekly, wheelieBins,
} from '@/lib/logic'
import type { State, Tab } from '@/lib/types'
import type { Actions } from '../App'
import WeeklyChart from '../WeeklyChart'
import { MatchCard, type Scored } from './Matches'

export default function Dashboard({ S, A }: { S: State; A: Actions }) {
  const [reviewKey, setReviewKey] = useState<string | null>(null)
  const supplier = S.view == 'Supplier'
  // Numbers and checklist follow the side being viewed; "your turn" items cover both sides.
  const myListings = S.L.filter(l => l.ownerId == S.me.id && l.type == (supplier ? 'Supply' : 'Demand'))
  const active = myListings.filter(l => !l.arch)
  const txs = sideTransactions(S)
  const allOpen = myTransactions(S).filter(isOpen)
  const open = txs.filter(isOpen)
  const done = txs.filter(t => t.step == 6)

  const scored = myMatches(S).filter((m): m is Scored => m.block === null).sort((x, y) => y.score - x.score)
  const eligible = scored.filter(m => m.g[0] == 'eligible')
  const restricted = scored.filter(m => m.g[0] == 'restricted')
  const inProgress = new Set(open.map(t => t.s + t.d))
  const newMatches = eligible.filter(m => !inProgress.has(m.key))
  const reviewing = scored.find(m => m.key == reviewKey)

  const myTurn = allOpen.filter(t => turn(S, t) != 'waiting')
  const waiting = allOpen.filter(t => turn(S, t) == 'waiting')
  const ending = endingSoon(S)

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
        ['Active listings', active.length],
        ['Tonnes available to reuse', f1(active.reduce((a, l) => a + (l.type == 'Supply' ? avail(l) : 0), 0))],
        ['Tonnes diverted from waste', f1(tonnes)],
        ['Disposal avoided + sales (est.)', money(benefit)],
        ['CO₂e saved (kg, est.)', f1(co2)],
        ['Open exchanges', open.length],
      ]
    : [
        ['Open requests', active.length],
        ['Tonnes requested', f1(active.reduce((a, l) => a + (l.type == 'Demand' ? l.max : 0), 0))],
        ['Tonnes sourced', f1(tonnes)],
        ['Saved vs. alternatives (est.)', money(benefit)],
        ['CO₂e saved (kg, est.)', f1(co2)],
        ['Open exchanges', open.length],
      ]

  // Getting-started checklist, hidden once every step is done.
  const checklist: [string, boolean, Tab, string][] = [
    [supplier ? 'Post your first listing' : 'Post your first request', myListings.length > 0, 'Create Listing', supplier ? 'List a material' : 'Request a material'],
    ['Get matched', eligible.length + restricted.length > 0 || txs.length > 0, 'Matches', 'See matches'],
    ['Start an exchange', txs.length > 0, 'Matches', 'Choose a match'],
    ['Complete your first exchange', done.length > 0, 'Transactions', 'Open transactions'],
  ]
  const nextStep = checklist.findIndex(c => !c[1])
  const offersToAnswer = S.O.filter(o => o.to == S.me.id && o.status == 'pending')
  const todo = myTurn.length + restricted.length + ending.length + offersToAnswer.length

  return (
    <>
      <h2>Kia ora, {S.me.businessName}</h2>
      <p className="s" style={{ marginTop: -6 }}>
        {supplier ? 'Supplier dashboard: turn your surplus into value.' : 'Receiver dashboard: source local material for reuse.'}
        {S.me.location ? ` · ${S.me.location}` : ''}
      </p>

      {nextStep != -1 && (
        <div className="card">
          <h3>Getting started</h3>
          <ol className="checklist">
            {checklist.map(([label, ok, tab, cta], i) => (
              <li key={label} className={ok ? 'done' : i == nextStep ? 'next' : ''}>
                <span className="check">{ok ? '✔' : i + 1}</span>
                <span>{label}</span>
                {i == nextStep && <button className="btn" onClick={() => A.go(tab)}>{cta}</button>}
              </li>
            ))}
          </ol>
          {nextStep == 0 && <p className="s">Short on time? <button className="btn alt" onClick={A.guided}>▶ Try guided demo</button></p>}
        </div>
      )}

      <div className="card">
        <h3>Needs your action {todo > 0 && <span className="tag restricted">{todo}</span>}</h3>
        {todo + newMatches.length == 0 && <p className="s">Nothing needs you right now ✓</p>}

        {offersToAnswer.map(o => {
          const s = S.L.find(l => l.id == o.s), d = S.L.find(l => l.id == o.d)
          if (!s || !d) return null
          const other = s.ownerId == S.me.id ? d : s
          return (
            <div className="action-item" key={o.id}>
              <div>
                <b>Offer from {other.biz}: ${o.price}/t</b>
                <div className="s">{f1(o.q)} t of {s.mat}{o.message ? ` · “${o.message}”` : ''}</div>
              </div>
              <button className="btn" onClick={() => A.go('Transactions')}>Reply</button>
            </div>
          )
        })}

        {myTurn.map(t => {
          const next = STEPS[t.step + 1], sim = turn(S, t) == 'simulated'
          return (
            <div className="action-item" key={t.id}>
              <div>
                <b>Your turn: {next}</b>
                <div className="s">{listing(S, t.s).mat}, {f1(t.q)} t with {counterpartyName(S, t)}{sim ? ` (you act for them: ${stepActor(t, t.step + 1)} step)` : ''}</div>
              </div>
              <button className="btn" disabled={A.busy} onClick={() => A.advance(t.id)}>{next}</button>
            </div>
          )
        })}

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

        {restricted.slice(0, 3).map(m => (
          <div className="action-item" key={m.key}>
            <div>
              <b>Verification needed</b>
              <div className="s">{m.s.mat} · {m.s.biz} → {m.d.biz} · score {m.score}/100</div>
            </div>
            <button className="btn alt" onClick={() => setReviewKey(m.key)}>Review</button>
          </div>
        ))}

        {newMatches.length > 0 && <p className="s" style={{ margin: '12px 0 0' }}>Top new matches ({newMatches.length})</p>}
        {newMatches.slice(0, 3).map(m => (
          <div className="action-item" key={m.key}>
            <div>
              <b>New match · score {m.score}/100 · {supplier ? 'you gain' : 'you save'} {money(supplier ? m.e.sup : m.e.rec)}</b>
              <div className="s">
                {supplier ? `${m.d.biz} · ${m.d.loc} can reuse your ${m.s.mat}` : `${m.s.mat} from ${m.s.biz} · ${m.s.loc}`} · {f1(m.q)} t · {fmtKm(m.e.dist)}
              </div>
              <div className="s" style={{ color: 'var(--ink)' }}>Why: {matchReasons(m).join(' · ')}</div>
            </div>
            <button className="btn" onClick={() => setReviewKey(m.key)}>Review</button>
          </div>
        ))}

        {(restricted.length > 3 || newMatches.length > 3) && (
          <p className="s"><button className="btn alt" onClick={() => A.go('Matches')}>See all {eligible.length + restricted.length} matches</button></p>
        )}
      </div>

      {/* Numbers appear once there's something to count, so new users focus on the checklist. */}
      {myListings.length > 0 && (
        <>
          <div className="grid">
            {stats.map(([label, value]) => (
              <div className="card" key={label}><div className="big">{value}</div><div className="s">{label}</div></div>
            ))}
          </div>
          {done.length > 0 && (
            <div className="card">
              <div className="equiv">
                <span>🚗 ≈ <b>{kmNotDriven(co2).toLocaleString('en-NZ')} km</b> of driving avoided</span>
                <span>🗑️ ≈ <b>{wheelieBins(tonnes).toLocaleString('en-NZ')} wheelie bins</b> kept out of landfill</span>
              </div>
              <p className="s" style={{ margin: '6px 0 0' }}>Rough everyday equivalents (average car ≈ 0.2 kg CO₂e/km; one 240 L bin ≈ 0.1 t). Illustrative only.</p>
            </div>
          )}
          <div className="card">
            <WeeklyChart buckets={weekly(txs, S)} title="Your CO₂e saved per week" />
          </div>
        </>
      )}

      {waiting.length > 0 && (
        <div className="card">
          <h3>Waiting on others</h3>
          {waiting.map(t => (
            <div className="s" key={t.id}>
              {listing(S, t.s).mat}, {f1(t.q)} t: waiting for {counterpartyName(S, t)} to do “{STEPS[t.step + 1]}”
            </div>
          ))}
        </div>
      )}

      {!(S.me.canSupply && S.me.canReceive) && (
        <div className="card s">
          {supplier ? 'Also need compost, feed or other material?' : 'Also have surplus or waste to pass on?'}{' '}
          <button className="btn alt" onClick={() => A.go('Profile')}>{supplier ? 'Start buying too' : 'Start selling too'}</button>
        </div>
      )}

      {reviewing && (
        <div className="modal-backdrop" onClick={() => setReviewKey(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Review match" onClick={e => e.stopPropagation()}>
            <MatchCard m={reviewing} S={S} A={A} onStarted={() => setReviewKey(null)} />
            <button className="btn alt" onClick={() => setReviewKey(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
