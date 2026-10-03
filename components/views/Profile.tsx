'use client'

import { useState, type FormEvent } from 'react'
import { CITY } from '@/lib/data'
import type { State } from '@/lib/types'
import type { Actions } from '../App'
import { DemoZoneSwitch } from '../Compliance'

export default function Profile({ S, A }: { S: State; A: Actions }) {
  const [name, setName] = useState(S.me.businessName)
  const [loc, setLoc] = useState(S.me.location ?? '')
  const [saved, setSaved] = useState(false)
  const listings = S.L.filter(l => l.ownerId == S.me.id)
  const changed = name.trim() != S.me.businessName || loc != (S.me.location ?? '')

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaved(false)
    if (await A.updateProfile(name.trim(), loc)) setSaved(true)
  }

  return (
    <>
      <h2>Profile</h2>
      <form className="card" onSubmit={save}>
        <h3>Business details</h3>
        <div className="row">
          <div><label>Business name</label><input required value={name} onChange={e => { setName(e.target.value); setSaved(false) }} /></div>
          <div>
            <label>Location</label>
            <select value={loc} onChange={e => { setLoc(e.target.value); setSaved(false) }}>
              {!loc && <option value="">Choose…</option>}
              {Object.keys(CITY).map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <p className="s">Your business name also updates on all {listings.length} of your listing(s).</p>
        <button className="btn" disabled={A.busy || !changed || !name.trim()}>{A.busy ? 'Saving…' : 'Save changes'}</button>
        {saved && <span className="s"> ✔ Saved</span>}
      </form>

      <div className="card">
        <h3>What you do on AgriReuse</h3>
        {([['Supplier', S.me.canSupply, 'Selling', 'List surplus and waste material for others to reuse.'],
           ['Receiver', S.me.canReceive, 'Buying', 'Request material such as compost inputs, feed or worm-farm feedstock.']] as const)
          .map(([role, on, verb, text]) => (
            <div className="action-item" key={role}>
              <div>
                <b>{on ? '✔' : '○'} {verb} ({role})</b>
                <div className="s">{text}</div>
              </div>
              {!on && (
                <button className="btn" disabled={A.busy} onClick={() => {
                  if (confirm(`Turn on ${verb.toLowerCase()}? Your account will be able to post ${role == 'Supplier' ? 'supply listings' : 'requests'} too. This can't be turned off later (you can always archive listings).`))
                    A.enableRole(role)
                }}>Also start {verb.toLowerCase()}</button>
              )}
            </div>
          ))}
        {S.me.canSupply && S.me.canReceive && <p className="s">Use the Supplier ⇄ Receiver switch at the top to change which side you’re working on.</p>}
      </div>

      <div className="card s">
        Synthetic demo platform: no real accreditation. Contact happens in-app. Notifications are under the 🔔 bell at the top.
      </div>
      <h3 className="t">Demo controls</h3>
      <DemoZoneSwitch S={S} A={A} />
      <button className="btn alt" onClick={A.signOut}>Sign out</button>
    </>
  )
}
