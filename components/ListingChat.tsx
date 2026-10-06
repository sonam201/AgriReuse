'use client'

// Conversational listing creation. The app decides the next question from what's still missing
// (so nothing is skipped or asked twice); the AI is only used to read the free-text description.
// Every answer goes into the same draft the form uses, so users can switch to the form any time.
import { useEffect, useRef, useState } from 'react'
import { CITY } from '@/lib/data'
import { ALL_USES, CATEGORIES, USE_LABELS, evaluate, questionsFor } from '@/lib/compliance'
import { TYPICAL_ALTERNATIVE, TYPICAL_DISPOSAL, addDays, cleanMaterial, draftProblems, f1, today } from '@/lib/logic'
import type { Draft, State } from '@/lib/types'
import type { Actions } from './App'
import { ComplianceDetails } from './Compliance'

type Option = { value: string; label: string; disabled?: boolean; note?: string }
type Step = {
  id: string
  ask: string
  options?: Option[]
  multi?: boolean
  text?: string // placeholder: free-text answer allowed
  skip?: string // label for a "skip" option
  apply: (answer: string | string[]) => Partial<Draft> | string // patch, or an error message to show
}
type Msg = { from: 'bot' | 'me'; text: string }

const nextWeekday = (day: number) => {
  const d = new Date(today() + 'T00:00')
  d.setDate(d.getDate() + ((day - d.getDay() + 7) % 7 || 7))
  return addDays(today(), Math.round((d.getTime() - new Date(today() + 'T00:00').getTime()) / 864e5))
}
const WHEN: Option[] = [
  { value: today(), label: 'Now' },
  { value: nextWeekday(5), label: 'This Friday' },
  { value: nextWeekday(1), label: 'Next week' },
]

function parseQty(t: string) {
  const m = t.toLowerCase().replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kg|kilo|kilos|t|tonnes?|tons?)?/)
  if (!m) return NaN
  return m[2]?.startsWith('k') ? +m[1] / 1000 : +m[1]
}
function parseMoney(t: string) {
  if (/\b(free|nothing|zero|none)\b/i.test(t)) return 0
  const m = t.replace(',', '').match(/(\d+(?:\.\d+)?)/)
  return m ? +m[1] : NaN
}
function parseDate(t: string) {
  const s = t.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/) // NZ order: day/month(/year)
  if (!m) return ''
  const y = m[3] ? (m[3].length == 2 ? '20' + m[3] : m[3]) : today().slice(0, 4)
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}
const num = (v: number | string) => (v === '' ? NaN : Number(v))

// Ordered steps; the first whose `needed` is true is asked next.
function stepsFor(S: State, d: Draft, asked: Set<string>, understand: (t: string) => void): (Step & { needed: boolean })[] {
  const supply = d.type == 'Supply'
  const c = evaluate(d.category, d.answers, d.suburb, S.zone)
  const steps: (Step & { needed: boolean })[] = []
  const add = (needed: boolean, s: Step) => steps.push({ ...s, needed })

  if (supply) add(!d.category, {
    id: 'category', ask: 'Let’s list it! What kind of material is it?',
    options: CATEGORIES.map(x => ({ value: x.id, label: x.label + (x.beta ? ' (beta)' : ''), note: x.hint })),
    apply: v => ({ category: String(v), cond: CATEGORIES.find(x => x.id == v)?.cond ?? 'Unknown' }),
  })
  add(!asked.has('describe'), {
    id: 'describe',
    ask: supply
      ? 'Tell me about it in your own words: what is it, how much, and anything else (where, when, price).'
      : 'What material do you need, and how much? Add anything else you know (where, when, budget).',
    text: supply ? 'e.g. About 2 tonnes of bruised kiwifruit in Tauranga, ready Friday, free' : 'e.g. 1 to 3 tonnes of veg scraps for our worm farm in Hamilton',
    apply: v => { understand(String(v)); return {} },
  })
  add(!d.mat.trim(), { id: 'mat', ask: 'What’s the material called?', text: 'e.g. Apple pomace', apply: v => cleanMaterial(String(v)) ? { mat: cleanMaterial(String(v)) } : 'Please type the material name.' })
  add(!(num(d.qty) > 0), {
    id: 'qty', ask: supply ? 'How much is there?' : 'How much do you need at most?', text: 'e.g. 800 kg or 2 tonnes',
    apply: v => { const q = parseQty(String(v)); return q > 0 ? { qty: +q.toFixed(3) } : 'I didn’t catch a quantity. Try “800 kg” or “2 tonnes”.' },
  })
  add(!CITY[d.loc], {
    id: 'loc', ask: supply ? 'Which town is it in or near?' : 'Which town are you in or near?',
    options: Object.keys(CITY).map(t => ({ value: t, label: t })), apply: v => ({ loc: String(v) }),
  })
  if (supply) add(!asked.has('suburb') && !d.suburb, {
    id: 'suburb', ask: 'Which suburb or area? (Used for biosecurity zone checks.)', text: 'e.g. Papatoetoe', skip: 'Skip',
    apply: v => ({ suburb: String(v).trim().slice(0, 60) }),
  })
  add(!asked.has('from'), {
    id: 'from', ask: supply ? 'When is it available?' : 'When do you need it from?', options: WHEN, text: 'or a date, e.g. 20/10',
    apply: v => { const f = WHEN.some(w => w.value == v) ? String(v) : parseDate(String(v)); return f ? { from: f, to: d.to && d.to >= f ? d.to : addDays(f, 30) } : 'Pick an option or type a date like 20/10.' },
  })
  if (supply) for (const q of questionsFor(d.category)) add(!d.answers[q.id], {
    id: 'q_' + q.id, ask: q.text, options: q.options, apply: v => ({ answers: { ...d.answers, [q.id]: String(v) } }),
  })
  if (supply) {
    add(!asked.has('price'), {
      id: 'price', ask: 'What’s your asking price per tonne?', options: [{ value: '0', label: 'Free' }], text: 'e.g. $20',
      apply: v => { const p = parseMoney(String(v)); return p >= 0 ? { price: p } : 'Type a price like “$20”, or tap Free.' },
    })
    add(!asked.has('disp'), {
      id: 'disp', ask: 'Roughly what would it cost you to dispose of it, per tonne? A guess is fine.', options: [{ value: String(TYPICAL_DISPOSAL), label: `Not sure (use typical $${TYPICAL_DISPOSAL}/t)` }, { value: '0', label: 'Nothing' }], text: 'e.g. $100',
      apply: v => { const p = parseMoney(String(v)); return p >= 0 ? { disp: p } : 'Type an amount like “$100”.' },
    })
    add(!asked.has('uses'), {
      id: 'uses', ask: 'What could it be used for? Tick all that apply.', multi: true,
      options: ALL_USES.map(u => ({
        value: u, label: USE_LABELS[u],
        disabled: c.level == 'blocked' || c.hidden.has(u),
        note: c.hidden.has(u) ? 'not allowed by the compliance check' : c.check.has(u) ? 'needs a check' : undefined,
      })),
      apply: v => (Array.isArray(v) && v.length ? { uses: v } : 'Tick at least one use.'),
    })
  } else {
    add(!asked.has('use1'), { id: 'use1', ask: 'What will you use it for?', options: ALL_USES.map(u => ({ value: u, label: USE_LABELS[u] })), apply: v => ({ use1: String(v) }) })
    add(!asked.has('keywords'), {
      id: 'keywords', ask: 'Any specific materials you want? Separate them with commas.', text: 'e.g. banana, kiwifruit, apple pomace', skip: 'No, any',
      apply: v => ({ keywords: String(v).slice(0, 300) }),
    })
    add(!asked.has('accepts'), {
      id: 'accepts', ask: 'Which kinds of material do you accept? Tick any, or tap Done for any kind.', multi: true,
      options: CATEGORIES.map(x => ({ value: x.id, label: x.label })),
      apply: v => ({ accepts: Array.isArray(v) ? v : [] }),
    })
    add(!asked.has('min'), {
      id: 'min', ask: 'What’s the smallest amount worth collecting?', text: 'e.g. 500 kg',
      apply: v => { const q = parseQty(String(v)); return q > 0 && q <= num(d.qty) ? { min: +q.toFixed(3) } : `Type an amount up to ${d.qty} t.` },
    })
    add(!asked.has('maxPrice'), {
      id: 'maxPrice', ask: 'What’s the most you’d pay per tonne?', options: [{ value: '0', label: 'Free only' }], text: 'e.g. $30',
      apply: v => { const p = parseMoney(String(v)); return p >= 0 ? { maxPrice: p } : 'Type an amount like “$30”.' },
    })
    add(!asked.has('alt'), {
      id: 'alt', ask: 'What do you pay now for this kind of material, per tonne? (Used to show your savings.)', options: [{ value: String(TYPICAL_ALTERNATIVE), label: `Not sure (use typical $${TYPICAL_ALTERNATIVE}/t)` }], text: 'e.g. $45',
      apply: v => { const p = parseMoney(String(v)); return p >= 0 ? { alt: p } : 'Type an amount like “$45”.' },
    })
  }
  return steps
}

// One-tap demo examples from the compliance plan.
function demoExamples(d: Draft): [string, Partial<Draft>, string][] {
  const from = today(), to = addDays(today(), 30)
  return [
    ['🧅 Onions, spraying unknown', {
      category: 'fruit_veg', cond: 'Unsellable/overripe', mat: 'Onions', qty: 2, loc: 'Pukekohe', suburb: 'Pukekohe', from, to, price: 0, disp: 80, chem: 'unknown',
      uses: ['composting', 'worm farming', 'feed'], answers: { fruit_fly_zone: 'no', touched_meat: 'no', last_sprayed: 'unknown', condition: 'fresh', is_kiwifruit: 'no' },
    }, 'Expected: 🟠 Needs check (spray withholding period).'],
    ['🍎 Apples from a fruit fly zone', {
      category: 'fruit_veg', cond: 'Unsellable/overripe', mat: 'Apples', qty: 1.5, loc: 'Auckland', suburb: 'Papatoetoe', from, to, price: 0, disp: 90, chem: 'declared-none',
      uses: ['composting', 'worm farming', 'feed', 'pig feed'], answers: { fruit_fly_zone: 'yes', touched_meat: 'no', last_sprayed: 'never', condition: 'fresh', is_kiwifruit: 'no' },
    }, 'Expected: 🔴 Not allowed (inside a fruit fly controlled area: use MPI bins).'],
    ['🥝 Kiwifruit prunings', {
      category: 'crop_residue', cond: 'Post-harvest residue', mat: 'Kiwifruit prunings', qty: 4, loc: 'Tauranga', suburb: 'Te Puke', from, to, price: 0, disp: 40, chem: 'declared-none',
      uses: ['composting', 'firewood'], answers: { fruit_fly_zone: 'no', kiwi_prunings: 'yes' },
    }, 'Expected: 🟠 Needs check (KVH: no firewood to other regions).'],
  ].map(([label, patch, note]) => [label as string, { ...patch as Partial<Draft>, type: d.type }, note as string])
}

const ALL_STEP_IDS = ['category', 'describe', 'mat', 'qty', 'loc', 'suburb', 'from', 'price', 'disp', 'uses', 'use1', 'keywords', 'accepts', 'min', 'maxKm', 'maxPrice', 'alt']

export default function ListingChat({ S, A, draft }: { S: State; A: Actions; draft: Draft | null }) {
  const [history, setHistory] = useState<Msg[]>([])
  const [asked, setAsked] = useState<Set<string>>(new Set())
  const [input, setInput] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState('')
  const [speak, setSpeak] = useState(false)
  const [listening, setListening] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const rec = useRef<any>(null)

  // Start a draft when the chat opens; editing an existing listing goes straight to the summary.
  useEffect(() => { if (!draft) A.newDraft() }, [draft == null]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (draft?.editId) setAsked(new Set(ALL_STEP_IDS)) }, [draft?.editId])
  // The guided demo arrives fully filled in (text but no AI source): jump to the summary.
  useEffect(() => {
    if (draft?.raw && draft.source === undefined && !draft.editId) {
      setAsked(new Set(ALL_STEP_IDS))
      setHistory([{ from: 'me', text: draft.raw }, { from: 'bot', text: 'Guided demo loaded. Check the summary below.' }])
    }
  }, [draft?.raw]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { rec.current?.abort?.(); window.speechSynthesis?.cancel() }, [])
  // After publishing (draft cleared), start a fresh conversation.
  useEffect(() => { if (!draft) { setHistory([]); setAsked(new Set()); setError('') } }, [draft == null]) // eslint-disable-line react-hooks/exhaustive-deps

  const understand = async (text: string) => {
    const r = await A.understand(text)
    const f = r.fields
    // Only keep what the AI actually found; mark those questions as answered.
    const keep: Partial<Draft> = {}
    const got = new Set<string>()
    if (f.mat) { keep.mat = cleanMaterial(f.mat); got.add('mat') }
    if (num(f.qty ?? '') > 0) { keep.qty = f.qty; got.add('qty') }
    if (f.loc && CITY[f.loc]) { keep.loc = f.loc; got.add('loc') }
    if (f.from && r.source == 'ai') { keep.from = f.from; keep.to = f.to ?? addDays(f.from, 30); got.add('from') }
    if (draft?.type == 'Supply') {
      if (f.price !== undefined && r.source == 'ai') { keep.price = f.price; got.add('price') }
      if (f.disp !== undefined && f.disp !== '' && r.source == 'ai') { keep.disp = f.disp; got.add('disp') }
      if (f.chem) keep.chem = f.chem
    } else {
      for (const k of ['use1', 'min', 'maxKm', 'maxPrice', 'alt'] as const) if (f[k] !== undefined && f[k] !== '' && r.source == 'ai') { (keep as any)[k] = f[k]; got.add(k) }
    }
    A.patchDraft({ ...keep, raw: text, source: r.source })
    setAsked(prev => new Set([...prev, ...got]))
    const bits = [keep.qty && `${f1(keep.qty)} t`, keep.mat, keep.loc && `in ${keep.loc}`, keep.from && `from ${keep.from}`].filter(Boolean)
    setHistory(h => [...h, { from: 'bot', text: (bits.length ? `Got it: ${bits.join(', ')}.` : 'Thanks!') + (r.notes ? ` (${r.notes})` : '') + ' A few quick questions…' }])
  }

  const d = draft
  const steps = d ? stepsFor(S, d, asked, understand) : []
  const step = steps.find(s => s.needed)

  // Read each new question aloud when enabled (free, built into the browser).
  useEffect(() => {
    if (!speak || !step || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(step.ask), { lang: 'en-NZ' }))
  }, [speak, step?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [history.length, step?.id])
  useEffect(() => {
    const current = step?.id == 'accepts' ? d?.accepts ?? [] : d?.uses ?? []
    setPicked(step?.multi ? current.filter(u => !step.options?.find(o => o.value == u)?.disabled) : [])
  }, [step?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return null

  function answer(value: string | string[], label: string) {
    if (!step) return
    const r = step.apply(value)
    if (typeof r == 'string') { setError(r); return }
    setError('')
    setInput('')
    setHistory(h => [...h, { from: 'bot', text: step.ask }, { from: 'me', text: label }])
    setAsked(prev => new Set([...prev, step.id]))
    if (Object.keys(r).length) A.patchDraft(r)
  }

  function listen() {
    const w = window as any
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SR) return setError('Voice isn’t supported in this browser (try Chrome or Edge).')
    const r = new SR()
    rec.current = r
    r.lang = 'en-NZ'
    setListening(true)
    r.onresult = (e: any) => setInput(e.results[0][0].transcript)
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    r.start()
  }

  function restart() {
    setHistory([]); setAsked(new Set()); setError(''); setInput('')
    A.newDraft()
  }

  function loadExample(label: string, patch: Partial<Draft>, note: string) {
    A.startDraft({ ...d!, ...patch, raw: '', source: undefined, notes: undefined, declared: false, editId: undefined })
    setAsked(new Set(ALL_STEP_IDS))
    setHistory([{ from: 'me', text: label }, { from: 'bot', text: `Loaded the demo example. ${note}` }])
  }

  const problems = draftProblems(d)
  const c = evaluate(d.category, d.answers, d.suburb, S.zone)

  return (
    <div className="card chat">
      <div className="chat-head">
        <h3>💬 {d.editId ? `Editing: ${d.mat}` : d.type == 'Supply' ? 'New listing' : 'New request'}</h3>
        <span>
          <label className="s"><input type="checkbox" checked={speak} onChange={e => setSpeak(e.target.checked)} /> 🔊 Read questions aloud</label>{' '}
          {!d.editId && <button className="btn alt" onClick={restart}>Start over</button>}
        </span>
      </div>

      {d.type == 'Supply' && history.length == 0 && !d.editId && (
        <div className="s demo-examples">
          Demo examples:{' '}
          {demoExamples(d).map(([label, patch, note]) => (
            <button key={label} className="chip" onClick={() => loadExample(label, patch, note)}>{label}</button>
          ))}
        </div>
      )}

      <div className="chat-log" aria-live="polite">
        {history.map((m, i) => <div key={i} className={'bubble ' + m.from}>{m.text}</div>)}
        {A.extracting && <div className="bubble bot typing">Reading your description…</div>}

        {!A.extracting && step && (
          <>
            <div className="bubble bot">{step.ask}</div>
            {step.options && (
              <div className="chat-options">
                {step.options.map(o => step.multi ? (
                  <button key={o.value} className={'chip' + (picked.includes(o.value) ? ' on' : '')} disabled={o.disabled} title={o.note}
                    aria-pressed={picked.includes(o.value)}
                    onClick={() => setPicked(p => p.includes(o.value) ? p.filter(x => x != o.value) : [...p, o.value])}>
                    {o.label}{o.note ? ` · ${o.note}` : ''}
                  </button>
                ) : (
                  <button key={o.value} className="chip" disabled={o.disabled} title={o.note} onClick={() => answer(o.value, o.label)}>
                    {o.label}{o.note ? <span className="s"> · {o.note}</span> : null}
                  </button>
                ))}
                {step.multi && <button className="btn" onClick={() => answer(picked, picked.map(u => USE_LABELS[u] ?? CATEGORIES.find(x => x.id == u)?.label ?? u).join(', ') || (step.id == 'accepts' ? 'Any kind' : '—'))}>Done</button>}
                {step.skip && <button className="chip" onClick={() => answer('', step.skip!)}>{step.skip}</button>}
              </div>
            )}
          </>
        )}

        {!A.extracting && !step && (
          <div className="chat-summary">
            <div className="bubble bot">Here’s your {d.type == 'Supply' ? 'listing' : 'request'}. Check it, then publish.</div>
            <div className="summary">
              <b>{d.mat || '—'}</b> · {f1(d.qty || 0)} t · {d.loc}{d.suburb ? ` (${d.suburb})` : ''} · {d.from} → {d.to}
              <div className="s">
                {d.type == 'Supply'
                  ? `${CATEGORIES.find(x => x.id == d.category)?.label ?? ''} · ${num(d.price) == 0 ? 'Free' : `$${d.price}/t`} · disposal $${d.disp === "" ? TYPICAL_DISPOSAL + " (typical)" : d.disp}/t · for ${d.uses.map(u => USE_LABELS[u] ?? u).join(', ')}`
                  : `For ${USE_LABELS[d.use1] ?? d.use1}${d.keywords.trim() ? ` · wants ${d.keywords}` : ''}${d.accepts.length ? ` · accepts ${d.accepts.map(a => CATEGORIES.find(x => x.id == a)?.label ?? a).join(', ')}` : ' · any kind'} · min ${d.min} t · up to $${d.maxPrice}/t · usually pay $${d.alt === '' ? TYPICAL_ALTERNATIVE : d.alt}/t`}
              </div>
              {d.type == 'Supply' && <ComplianceDetails c={c} />}
              {d.type == 'Supply' && (
                <label className="declare">
                  <input type="checkbox" checked={d.declared} onChange={e => A.editDraft('declared', e.target.checked)} />
                  I confirm this information is true to the best of my knowledge, and I accept responsibility for any false information.
                </label>
              )}
              {problems.filter(p => p != 'Tick the seller declaration').length > 0 && (
                <ul className="s problems">{problems.filter(p => p != 'Tick the seller declaration').map(p => <li key={p}>{p}</li>)}</ul>
              )}
              <p>
                <button className="btn" disabled={A.busy || problems.length > 0} onClick={A.publish}>
                  {A.busy ? 'Saving…' : d.editId ? 'Save changes' : 'Publish'}
                </button>{' '}
                <button className="btn alt" onClick={() => A.setInputMode('form')}>✏️ Edit details in the form</button>
              </p>
            </div>
          </div>
        )}
        <div ref={end} />
      </div>

      {error && <p className="warn">{error}</p>}

      {!A.extracting && step?.text !== undefined && (
        <form className="chat-input" onSubmit={e => { e.preventDefault(); if (input.trim()) answer(input.trim(), input.trim()) }}>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder={step.text} maxLength={step.id == 'describe' ? 1000 : 120} autoFocus />
          <button type="button" className="btn alt" onClick={listen} aria-label="Speak your answer">{listening ? '🔴' : '🎤'}</button>
          <button className="btn" disabled={!input.trim()}>Send</button>
        </form>
      )}
    </div>
  )
}
