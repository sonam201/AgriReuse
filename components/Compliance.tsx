'use client'

import {
  CATEGORIES, DECLARATION, DISCLAIMER, LEVEL_BADGE, USE_LABELS, evaluate, questionsFor, type Compliance, type Level,
} from '@/lib/compliance'
import type { Draft, State } from '@/lib/types'
import type { Actions } from './App'

// Always text + colour, never colour alone.
export function ComplianceBadge({ level }: { level: Level }) {
  const b = LEVEL_BADGE[level]
  return <span className={'tag ' + b.cls}>{b.icon} {b.text}</span>
}

export function ComplianceDetails({ c, compact }: { c: Compliance; compact?: boolean }) {
  return (
    <div className="compliance">
      <div><b>Compliance check:</b> <ComplianceBadge level={c.level} /></div>
      {c.rules.length > 0 ? (
        <ul>
          {c.rules.map(r => <li key={r.id}>{r.message} <span className="s">({r.source})</span></li>)}
        </ul>
      ) : <p className="s">No issues found from the answers given.</p>}
      {c.level != 'blocked' && c.hidden.size > 0 && (
        <p className="s">Hidden from buyers wanting: {[...c.hidden].map(u => USE_LABELS[u] ?? u).join(', ')}.</p>
      )}
      {c.level != 'blocked' && c.check.size > 0 && (
        <p className="s">Needs a (simulated) check before an exchange for: {[...c.check].map(u => USE_LABELS[u] ?? u).join(', ')}.</p>
      )}
      {!compact && <p className="s">{DISCLAIMER}</p>}
    </div>
  )
}

// Category, suburb, the category's questions, live result and the declaration (supply only).
export function ComplianceFields({ S, A, d }: { S: State; A: Actions; d: Draft }) {
  const c = evaluate(d.category, d.answers, d.suburb, S.zone)
  const setAnswer = (id: string, v: string) => A.editDraft('answers', { ...d.answers, [id]: v })
  return (
    <fieldset className="checks compliance-fields">
      <legend>Compliance check</legend>
      <div className="row">
        <div>
          <label>Category</label>
          <select value={d.category} onChange={e => {
            const cat = CATEGORIES.find(x => x.id == e.target.value)
            A.editDraft('category', e.target.value)
            if (cat) A.editDraft('cond', cat.cond)
          }}>
            {!d.category && <option value="">Choose a category…</option>}
            {CATEGORIES.map(x => <option key={x.id} value={x.id}>{x.label}{x.beta ? ' (beta)' : ''}</option>)}
          </select>
        </div>
        <div>
          <label>Suburb or area</label>
          <input value={d.suburb} maxLength={60} placeholder="e.g. Papatoetoe" onChange={e => A.editDraft('suburb', e.target.value)} />
        </div>
      </div>
      {questionsFor(d.category).map(q => (
        <div className="question" key={q.id}>
          <span>{q.text}</span>
          <span className="choices">
            {q.options.map(o => (
              <button type="button" key={o.value} className={'chip' + (d.answers[q.id] == o.value ? ' on' : '')}
                aria-pressed={d.answers[q.id] == o.value} onClick={() => setAnswer(q.id, o.value)}>{o.label}</button>
            ))}
          </span>
        </div>
      ))}
      {d.category && <ComplianceDetails c={c} />}
      <label className="declare">
        <input type="checkbox" checked={d.declared} onChange={e => A.editDraft('declared', e.target.checked)} />
        {DECLARATION}
      </label>
    </fieldset>
  )
}

// Demo control: anyone signed in can switch the demo fruit fly zone; every viewer updates live.
export function DemoZoneSwitch({ S, A }: { S: State; A: Actions }) {
  const on = S.zone.active
  return (
    <div className={'card demo-zone' + (on ? ' on' : '')}>
      <div>
        <b>{on ? '🔴 Demo fruit fly zone ACTIVE' : 'Demo fruit fly zone: off'}</b>
        <div className="s">
          Suburbs: {S.zone.suburbs.join(', ')}. When on, listings from these suburbs become 🔴 Not allowed and can’t be exchanged.
        </div>
      </div>
      <button className={on ? 'btn alt' : 'btn'} disabled={A.busy} onClick={() => A.setDemoZone(!on)}>
        {on ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  )
}
