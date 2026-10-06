'use client'

import { useState } from 'react'
import { STEP_ACTION, STEP_DONE } from '@/lib/data'
import { f1, gate, isParty, listing, nextStep, stepActor, turn } from '@/lib/logic'
import type { Demand, State, Supply, Transaction } from '@/lib/types'
import type { Actions } from '../App'
import Tag from '../Tag'
import OffersPanel from '../OffersPanel'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

// The action for my turn: a small form for pickup (date/time + note) or receipt (tonnes), else a button.
function MyStep({ t, A }: { t: Transaction; A: Actions }) {
  const next = nextStep(t)
  const [at, setAt] = useState('')
  const [note, setNote] = useState('')
  const [q, setQ] = useState(String(t.q))
  if (next == 2) return (
    <div className="step-form">
      <label htmlFor={'at' + t.id}>Pickup date and time</label>
      <input id={'at' + t.id} type="datetime-local" value={at} onChange={e => setAt(e.target.value)} />
      <label htmlFor={'nt' + t.id}>Note for the buyer (optional)</label>
      <input id={'nt' + t.id} maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Gate 2, call 021 123 4567 on arrival" />
      <button className="btn" disabled={A.busy || !at} onClick={() => A.advance(t.id, { pickupAt: new Date(at).toISOString(), note })}>Arrange pickup</button>
    </div>
  )
  if (next == 4) return (
    <div className="step-form">
      <label htmlFor={'q' + t.id}>Tonnes actually received (agreed {f1(t.q)} t)</label>
      <input id={'q' + t.id} type="number" min={0} step={0.1} max={t.q} value={q} onChange={e => setQ(e.target.value)} />
      <button className="btn" disabled={A.busy || !(+q > 0) || +q > t.q + 1e-9} onClick={() => A.advance(t.id, { receivedQ: +q })}>Confirm received</button>
    </div>
  )
  return <button className="btn" disabled={A.busy} onClick={() => A.advance(t.id)}>{STEP_ACTION[next]}{next == 6 ? ' (payment simulated)' : ''}</button>
}

export default function Transactions({ S, A }: { S: State; A: Actions }) {
  const mine = S.T.filter(t => isParty(S, t))
  return (
    <>
      <h2>Transactions</h2>
      <div className="warn">Payments are simulated: no real money is collected, held or released.</div>
      <br />
      <OffersPanel S={S} A={A} />
      <br />
      {mine.length ? mine.map(t => {
        const s = listing(S, t.s) as Supply, d = listing(S, t.d) as Demand
        const g = gate(S, s, d, s.id + d.id), end = t.step == 6 || t.cx
        const next = nextStep(t), who = stepActor(t, next), whose = turn(S, t)
        const counterparty = who == 'supplier' ? s.biz : d.biz
        const stages = [2, 4, 6]
        return (
          <div className="card" key={t.id}>
            <h3>{s.mat}: {s.biz} ({s.loc}) → {d.biz}</h3>
            <div className="s">
              {f1(t.q)} t at ${t.price}/t · you’re the {t.supplierId == S.me.id ? 'seller' : 'buyer'} ·{' '}
              {t.cx ? <b>{t.cx.toUpperCase()}</b> : t.step == 6 ? '✔ Completed' : `Next: ${STEP_ACTION[next].toLowerCase()} (${who == 'supplier' ? 'seller' : 'buyer'})`}
            </div>
            {!t.cx && (
              <ol className="deal-steps" aria-label="Deal progress">
                {stages.map(n => (
                  <li key={n} className={t.step >= n ? 'done' : n == next ? 'next' : ''}>{STEP_DONE[n]}</li>
                ))}
              </ol>
            )}
            {t.pickupAt && <div className="s">🚚 Pickup: <b style={{ color: 'var(--ink)' }}>{when(t.pickupAt)}</b>{t.pickupNote ? ` · ${t.pickupNote}` : ''}</div>}
            {t.receivedQ != null && t.step >= 4 && <div className="s">📦 Received: {f1(t.receivedQ)} t{t.step < 6 && t.receivedQ < t.q ? ` of ${f1(t.q)} t agreed` : ''}</div>}
            <Tag g={g} />
            <details>
              <summary className="s">History</summary>
              <ol className="s">{t.log.map((l, i) => <li key={i}>{l[0]} — {l[1]}</li>)}</ol>
            </details>
            {!end && (
              <div className="deal-actions">
                {whose == 'waiting'
                  ? <button className="btn" disabled>Waiting for {counterparty} to {STEP_ACTION[next].toLowerCase()}</button>
                  : <MyStep t={t} A={A} />}
                <span>
                  <button className="btn alt" disabled={A.busy} onClick={() => A.cancel(t.id, 'cancelled')}>Cancel</button>{' '}
                  <button className="btn alt" disabled={A.busy} onClick={() => A.cancel(t.id, 'dispute')}>Raise dispute</button>
                </span>
              </div>
            )}
          </div>
        )
      }) : <p>No deals yet. Send a deal request from Matches or the Marketplace.</p>}
    </>
  )
}
