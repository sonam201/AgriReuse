'use client'

import { useState } from 'react'
import type { OfferResult } from '@/lib/db'
import { avail, f1, gate } from '@/lib/logic'
import type { Demand, State, Supply } from '@/lib/types'
import type { Actions } from './App'

// Send a deal request: amount + price + message. The deal starts only when the other side approves.
// Either for a pair of listings (`s` + `d`), or a buyer requesting a supply without a posted request
// of their own (`s` only: the app creates a private request listing behind the scenes).
export default function RequestDialog({ s, d, S, A, onClose }: { s: Supply; d?: Demand; S: State; A: Actions; onClose: () => void }) {
  const iSell = s.ownerId == S.me.id
  const other = iSell ? d! : s
  const maxQ = Math.min(avail(s), d && !d.private ? d.max : Infinity)
  const [price, setPrice] = useState(String(d && iSell ? Math.min(s.price, d.maxPrice) : s.price))
  const [q, setQ] = useState(String(+(d && !d.private ? Math.min(avail(s), d.max) : avail(s)).toFixed(2)))
  const [msg, setMsg] = useState('')
  const [result, setResult] = useState<OfferResult | null>(null)
  const key = d ? s.id + d.id : ''
  const needsCheck = !!d && gate(S, s, d, key)[0] == 'restricted' && !S.verified[key]
  const ok = +q > 0 && +q <= maxQ + 1e-9 && price !== '' && +price >= 0

  async function send() {
    const r = d ? await A.sendOffer(s.id, d.id, +price, +q, msg) : await A.requestWithoutListing(s, +q, +price, msg)
    if (r) setResult(r)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={`Send a deal request to ${other.biz}`} onClick={e => e.stopPropagation()}>
        <h3>🤝 Deal request to {other.biz}</h3>
        <p className="s">
          {s.mat} · {f1(avail(s))} t available · {s.price == 0 ? 'free' : `listed at $${s.price}/t`}
          {d && !d.private && (iSell ? ` · their budget up to $${d.maxPrice}/t` : ` · your budget up to $${d.maxPrice}/t`)}
        </p>
        {result ? (
          <>
            <p className="warn">📨 Request sent. The deal starts when {other.biz} approves. You’ll see their reply under Transactions → Deal requests.</p>
            <button className="btn" onClick={() => { onClose(); A.go('Transactions') }}>Go to Transactions</button>{' '}
            <button className="btn alt" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <div className="row">
              <div>
                <label htmlFor="rq-q">Amount (t{isFinite(maxQ) ? `, up to ${f1(maxQ)}` : ''})</label>
                <input id="rq-q" type="number" min={0} step={0.1} value={q} onChange={e => setQ(e.target.value)} />
              </div>
              <div>
                <label htmlFor="rq-p">Price ($/t, 0 = free)</label>
                <input id="rq-p" type="number" min={0} step={1} value={price} onChange={e => setPrice(e.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="rq-m">Message (optional)</label>
              <input id="rq-m" maxLength={300} value={msg} onChange={e => setMsg(e.target.value)} placeholder="e.g. We can collect on Friday" />
            </div>
            {!d && <p className="s">You don’t need to post a request first: this one is just between you and {s.biz}.</p>}
            {needsCheck ? (
              <p className="warn">
                This pair needs a (simulated) verification before a deal: {gate(S, s, d!, key)[1]}{' '}
                <button className="btn alt" disabled={A.busy} onClick={() => A.verify(s, d!)}>Complete verification</button>
              </p>
            ) : (
              <p className="s">Nothing is agreed until {other.biz} approves. They can also counter with a different price or amount.</p>
            )}
            <button className="btn" disabled={A.busy || !ok || needsCheck} onClick={send}>{A.busy ? 'Sending…' : 'Send request'}</button>{' '}
            <button className="btn alt" onClick={onClose}>Cancel</button>
          </>
        )}
      </div>
    </div>
  )
}
