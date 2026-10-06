'use client'

import { useState } from 'react'
import { avail, f1 } from '@/lib/logic'
import type { Listing, Offer, State, Supply } from '@/lib/types'
import type { Actions } from './App'

const STATUS: Record<Offer['status'], string> = {
  pending: '⏳ Waiting for a reply', accepted: '✅ Approved, deal started', declined: '✖ Declined', countered: '↩️ Countered', withdrawn: '— Withdrawn',
}

function RequestRow({ o, S, A }: { o: Offer; S: State; A: Actions }) {
  const [countering, setCountering] = useState(false)
  const [price, setPrice] = useState(String(o.price))
  const [q, setQ] = useState(String(o.q))
  const s = S.L.find(l => l.id == o.s) as Supply | undefined, d = S.L.find(l => l.id == o.d)
  if (!s || !d) return null
  const iSupply = s.ownerId == S.me.id
  const other: Listing = iSupply ? d : s
  const toMe = o.to == S.me.id && o.status == 'pending'
  const fromMe = o.from == S.me.id && o.status == 'pending'
  const counterOk = price !== '' && +price >= 0 && +q > 0 && +q <= avail(s) + 1e-9

  return (
    <div className="action-item request-row">
      <div>
        <b>
          {toMe ? `${other.biz} asks:` : fromMe ? `You asked ${other.biz}:` : `${other.biz}:`} {f1(o.q)} t of {s.mat} at {o.price == 0 ? 'no charge' : `$${o.price}/t`}
        </b>
        <div className="s">
          {iSupply ? 'You’re selling' : 'You’re buying'} · {STATUS[o.status]}{o.note ? ` · ${o.note}` : ''}{o.message ? ` · “${o.message}”` : ''}
        </div>
      </div>
      {toMe && !countering && (
        <span>
          <button className="btn" disabled={A.busy} onClick={() => A.respondOffer(o.id, 'accept')}>Approve</button>{' '}
          <button className="btn alt" disabled={A.busy} onClick={() => setCountering(true)}>Counter</button>{' '}
          <button className="btn alt" disabled={A.busy} onClick={() => A.respondOffer(o.id, 'decline')}>Decline</button>
        </span>
      )}
      {toMe && countering && (
        <span className="counter">
          <input type="number" min={0} step={0.1} value={q} onChange={e => setQ(e.target.value)} aria-label="Counter amount in tonnes" title="Tonnes" />
          <span className="s">t at $</span>
          <input type="number" min={0} step={1} value={price} onChange={e => setPrice(e.target.value)} aria-label="Counter price per tonne" title="$ per tonne" />
          <span className="s">/t</span>
          <button className="btn" disabled={A.busy || !counterOk} onClick={() => A.respondOffer(o.id, 'counter', +price, +q)}>Send counter</button>
          <button className="btn alt" onClick={() => setCountering(false)}>Cancel</button>
        </span>
      )}
      {fromMe && <button className="btn alt" disabled={A.busy} onClick={() => A.respondOffer(o.id, 'withdraw')}>Withdraw</button>}
    </div>
  )
}

// Deal requests: nothing is agreed until the other side approves.
export default function OffersPanel({ S, A }: { S: State; A: Actions }) {
  const toMe = S.O.filter(o => o.to == S.me.id && o.status == 'pending')
  const fromMe = S.O.filter(o => o.from == S.me.id && o.status == 'pending')
  const recent = S.O.filter(o => o.status != 'pending').slice(0, 5)
  if (!S.O.length) return null
  return (
    <div className="card">
      <h3>🤝 Deal requests {toMe.length > 0 && <span className="tag restricted">{toMe.length} to answer</span>}</h3>
      {toMe.length > 0 && <p className="s">Approving starts the deal and reserves the tonnes.</p>}
      {toMe.map(o => <RequestRow key={o.id} o={o} S={S} A={A} />)}
      {fromMe.map(o => <RequestRow key={o.id} o={o} S={S} A={A} />)}
      {toMe.length + fromMe.length == 0 && <p className="s">No open requests.</p>}
      {recent.length > 0 && (
        <details>
          <summary>Recent requests ({recent.length})</summary>
          {recent.map(o => <RequestRow key={o.id} o={o} S={S} A={A} />)}
        </details>
      )}
    </div>
  )
}
