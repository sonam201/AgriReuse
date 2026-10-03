'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CITY } from '@/lib/data'
import { CONDITIONS, USES, businessCount, draftProblems, listingTypeFor } from '@/lib/logic'
import type { Draft, State } from '@/lib/types'
import type { Actions } from '../App'
import { ComplianceFields } from '../Compliance'
import { CATEGORIES, USE_LABELS, evaluate } from '@/lib/compliance'
import ListingChat from '../ListingChat'

const Field = ({ label, children }: { label: string; children: ReactNode }) => <div><label>{label}</label>{children}</div>

export default function CreateListing({ S, A, draft }: { S: State; A: Actions; draft: Draft | null }) {
  const [txt, setTxt] = useState(draft?.raw ?? '')
  const [voiceStatus, setVoiceStatus] = useState('')
  const rec = useRef<any>(null)
  const supplier = S.view == 'Supplier'
  const mode = S.inputMode ?? 'chat'

  // Guided demo replaces the draft; mirror its source text into the textarea.
  useEffect(() => { if (draft?.raw) setTxt(draft.raw) }, [draft?.raw])
  useEffect(() => () => rec.current?.abort?.(), [])

  function voice() {
    const w = window as any
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SR) return setVoiceStatus('Voice isn’t supported in this browser (try Chrome or Edge). Type instead.')
    const r = new SR()
    rec.current = r
    r.lang = 'en-NZ'
    setVoiceStatus('🔴 Listening…')
    r.onresult = (e: any) => setTxt(e.results[0][0].transcript)
    r.onend = () => setVoiceStatus('Stopped. Check the text, then Fill the form.')
    r.onerror = (e: any) => setVoiceStatus('Voice error: ' + e.error + '. Type instead.')
    r.start()
  }

  const d = draft
  const problems = d ? draftProblems(d) : []
  const comp = evaluate(d?.category, d?.answers ?? {}, d?.suburb, S.zone)
  const set = A.editDraft
  const numInput = (k: 'qty' | 'price' | 'disp' | 'min' | 'maxKm' | 'maxPrice' | 'alt', step = 0.1) => (
    <input type="number" min={0} step={step} inputMode="decimal" value={d ? String(d[k]) : ''} onChange={e => set(k, e.target.value)} />
  )

  return (
    <>
      {!d?.editId && (
        <>
          <div className="hero">
            <h1>List it. Match it. Reuse it. 🌾</h1>
            <p>
              {S.L.filter(l => l.type == 'Supply' && !l.arch).length} supplies · {S.L.filter(l => l.type == 'Demand' && !l.arch).length} demands · {businessCount(S)} farmers &amp; businesses
            </p>
            <button className="btn alt" onClick={A.guided}>▶ Try guided demo</button>{' '}
            <button className="btn alt" onClick={() => A.go('Matches')}>🤝 See matches</button>
          </div>
        </>
      )}

      <div className="mode-switch" role="tablist" aria-label="How to create the listing">
        {([['chat', '💬 Chat with the assistant'], ['form', '📝 Fill in a form']] as const).map(([m, label]) => (
          <button key={m} role="tab" aria-selected={mode == m} className={mode == m ? 'on' : ''} onClick={() => A.setInputMode(m)}>{label}</button>
        ))}
      </div>

      {mode == 'chat' && <ListingChat S={S} A={A} draft={d} />}

      {mode == 'form' && !d?.editId && (
        <>
          <div className="card">
            <h3>✨ Describe it, we’ll fill the form</h3>
            <p className="s">
              You’re posting {listingTypeFor(S.view) == 'Supply' ? 'a supply listing: describe material you have.' : 'a request: describe material you need.'}
              {S.me.canSupply && S.me.canReceive ? ' Switch side at the top to post the other kind.' : ''}
            </p>
            <textarea rows={3} value={txt} onChange={e => setTxt(e.target.value)} maxLength={1000}
              placeholder={supplier
                ? 'e.g. About 3 tonnes of apple pomace in Cambridge from next Monday, untreated, free to a good home. Disposal costs us $90 a tonne.'
                : 'e.g. We need 2 tonnes of plant material for composting near Hamilton next week, up to $30 a tonne, within 100 km.'} />
            <p>
              <button className="btn" disabled={A.extracting || !txt.trim()} onClick={() => A.extract(txt)}>
                {A.extracting ? 'Filling…' : 'Fill the form'}
              </button>{' '}
              <button className="btn alt" onClick={voice}>🎤 Speak</button>{' '}
              <span className="s">{voiceStatus}</span>
            </p>
            <p className="s">Uses a free AI model when available, otherwise simple keyword rules. Always check the fields before publishing.</p>
          </div>
        </>
      )}

      {mode == 'form' && d && (
        <div className="card">
          <h3>{d.editId ? `Edit listing: ${d.mat || 'untitled'}` : `Check and publish: ${d.type == 'Supply' ? 'supply listing' : 'request'}`}</h3>
          {d.source == 'ai' && <p className="s"><span className="tag eligible">✨ Filled by AI</span> Check every field. AI can make mistakes.</p>}
          {d.source == 'rules' && <p className="s"><span className="tag restricted">Keyword rules</span> Basic auto-fill; complete the rest by hand.</p>}
          {d.notes && <p className="warn">{d.notes}</p>}

          <div className="row">
            <Field label="Material"><input value={d.mat} maxLength={80} onChange={e => set('mat', e.target.value)} placeholder="e.g. Overripe bananas" /></Field>
            <Field label={d.type == 'Supply' ? 'Quantity (tonnes)' : 'Quantity needed (tonnes, max)'}>{numInput('qty')}</Field>
            <Field label="Location">
              <select value={d.loc} onChange={e => set('loc', e.target.value)}>
                {!d.loc && <option value="">Choose a town…</option>}
                {Object.keys(CITY).map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label={d.type == 'Supply' ? 'Available from' : 'Needed from'}><input type="date" value={d.from} onChange={e => set('from', e.target.value)} /></Field>
            <Field label="Until"><input type="date" value={d.to} min={d.from || undefined} onChange={e => set('to', e.target.value)} /></Field>

            {d.type == 'Supply' ? (
              <>
                <Field label="Condition">
                  <select value={d.cond} onChange={e => set('cond', e.target.value)}>
                    {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Asking price ($/t, 0 = free)">{numInput('price', 1)}</Field>
                <Field label="Your disposal cost ($/t)">{numInput('disp', 1)}</Field>
                <Field label="Chemical history">
                  <select value={d.chem} onChange={e => set('chem', e.target.value)}>
                    <option value="unknown">Unknown (needs testing)</option>
                    <option value="declared-none">No treatment (declared)</option>
                  </select>
                </Field>
              </>
            ) : (
              <>
                <Field label="Intended use">
                  <select value={d.use1} onChange={e => set('use1', e.target.value)}>
                    {USES.map(u => <option key={u}>{u}</option>)}
                  </select>
                </Field>
                <Field label="Minimum useful amount (tonnes)">{numInput('min')}</Field>
                <Field label="Max distance (km)">{numInput('maxKm', 10)}</Field>
                <Field label="Max price ($/t)">{numInput('maxPrice', 1)}</Field>
                <Field label="Your current alternative costs ($/t)">{numInput('alt', 1)}</Field>
              </>
            )}
          </div>

          {d.type == 'Supply' && (
            <fieldset className="checks">
              <legend>Suitable for (tick all that apply)</legend>
              {USES.map(u => {
                const ruledOut = comp.level == 'blocked' || comp.hidden.has(u)
                return (
                  <label key={u} title={ruledOut ? 'Not allowed by the compliance check' : undefined} style={ruledOut ? { opacity: 0.45, textDecoration: 'line-through' } : undefined}>
                    <input type="checkbox" checked={d.uses.includes(u) && !ruledOut} disabled={ruledOut}
                      onChange={e => set('uses', e.target.checked ? [...d.uses, u] : d.uses.filter(x => x != u))} />
                    {USE_LABELS[u] ?? u}
                  </label>
                )
              })}
              {(d.uses.includes('feed') || d.uses.includes('pig feed')) && <p className="s">Animal-feed matches need simulated lab evidence before an exchange can start.</p>}
            </fieldset>
          )}

          {d.type == 'Demand' && (
            <fieldset className="checks">
              <legend>Kinds of material you accept (leave all unticked for any kind)</legend>
              {CATEGORIES.map(c => (
                <label key={c.id}>
                  <input type="checkbox" checked={d.accepts.includes(c.id)}
                    onChange={e => set('accepts', e.target.checked ? [...d.accepts, c.id] : d.accepts.filter(x => x != c.id))} />
                  {c.label}
                </label>
              ))}
              <p className="s">Matches in your chosen kinds rank higher; other kinds are left out.</p>
            </fieldset>
          )}
          {d.type == 'Supply' && <ComplianceFields S={S} A={A} d={d} />}

          {problems.length > 0 && (
            <ul className="s problems">{problems.map(p => <li key={p}>{p}</li>)}</ul>
          )}
          <p className="s">Nothing is {d.editId ? 'changed' : 'published'} until you confirm.</p>
          <button className="btn" disabled={A.busy || problems.length > 0} onClick={A.publish}>
            {A.busy ? 'Saving…' : d.editId ? 'Save changes' : 'Confirm and publish'}
          </button>{' '}
          <button className="btn alt" disabled={A.busy} onClick={() => { A.cancelDraft(); if (d.editId) A.go('Marketplace') }}>Cancel</button>
        </div>
      )}
    </>
  )
}
