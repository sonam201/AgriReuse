'use client'

import { useState } from 'react'
import { f1 } from '@/lib/logic'
import type { Listing, Offer, State } from '@/lib/types'
import type { Actions } from './App'

const STATUS: Record<Offer['status'], string> = {
  pending: '⏳ Waiting', accepted: '✅ Accepted', declined: '✖ Declined', countered: '↩️ Countered', withdrawn: '— Withdrawn',
}

function OfferRow({ o, S, A }: { o: Offer; S: State; A: Actions }) {
  const [counter, setCounter] = useState('')
  const [countering, setCountering] = useState(false)
  const s = S.L.find(l => l.id == o.s), d = S.L.find(l => l.id == o.d)
  if (!s || !d) return null
  const iSupply = s.ownerId == S.me.id
  const other: Listing = iSupply ? d : s
  const incoming = o.to == S.me.id && o.status == 'pending'
  const outgoing = o.from == S.me.id && o.status == 'pending'

  return (
    <div className="action-item">
      <div>
        <b>{incoming ? `${other.biz} offers` : outgoing ? `You offered ${other.biz}` : `${other.biz}`}: ${o.price}/t for {f1(o.q)} t of {s.mat}</b>
        <div className="s">
          {iSupply ? 'You’re selling' : 'You’re buying'} · {STATUS[o.status]}{o.note ? ` · ${o.note}` : ''}
          {o.message ? ` · “${o.message}”` : ''}
        </div>
      </div>
      {incoming && !countering && (
        <span>
          <button className="btn" disabled={A.busy} onClick={() => A.respondOffer(o.id, 'accept')}>Accept</button>{' '}
          <button className="btn alt" disabled={A.busy} onClick={() => { setCounter(String(o.price)); setCountering(true) }}>Counter</button>{' '}
          <button className="btn alt" disabled={A.busy} onClick={() => A.respondOffer(o.id, 'decline')}>Decline</button>
        </span>
      )}
      {incoming && countering && (
        <span className="counter">
          <input type="number" min={0} step={1} value={counter} onChange={e => setCounter(e.target.value)} aria-label="Counter price per tonne" />
          <button className="btn" disabled={A.busy || !(+counter >= 0) || counter === ''} onClick={() => A.respondOffer(o.id, 'counter', +counter)}>Send $/t</button>
          <button className="btn alt" onClick={() => setCountering(false)}>Cancel</button>
        </span>
      )}
      {outgoing && <button className="btn alt" disabled={A.busy} onClick={() => A.respondOffer(o.id, 'withdraw')}>Withdraw</button>}
    </div>
  )
}

export default function OffersPanel({ S, A }: { S: State; A: Actions }) {
  const incoming = S.O.filter(o => o.to == S.me.id && o.status == 'pending')
  const outgoing = S.O.filter(o => o.from == S.me.id && o.status == 'pending')
  const recent = S.O.filter(o => o.status != 'pending').slice(0, 5)
  if (!S.O.length) return null
  return (
    <div className="card">
      <h3>💬 Offers {incoming.length > 0 && <span className="tag restricted">{incoming.length} to answer</span>}</h3>
      {incoming.map(o => <OfferRow key={o.id} o={o} S={S} A={A} />)}
      {outgoing.map(o => <OfferRow key={o.id} o={o} S={S} A={A} />)}
      {incoming.length + outgoing.length == 0 && <p className="s">No open offers.</p>}
      {recent.length > 0 && (
        <details>
          <summary>Recent offers ({recent.length})</summary>
          {recent.map(o => <OfferRow key={o.id} o={o} S={S} A={A} />)}
        </details>
      )}
    </div>
  )
}
