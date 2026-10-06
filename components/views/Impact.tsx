import { CATEGORIES } from '@/lib/compliance'
import { EF } from '@/lib/data'
import { businessCount, categoryOf, co2, completed, completedOn, f1, isParty, kmNotDriven, listing, tonnes, txCo2, wheelieBins } from '@/lib/logic'
import type { State, Supply } from '@/lib/types'

const catName = (id: string | null) => CATEGORIES.find(c => c.id == id)?.label ?? 'Other'
const kg = (x: number) => Math.round(x).toLocaleString('en-NZ')

// The community story: what everyone on AgriReuse has achieved together (your own results are on the Dashboard).
export default function Impact({ S }: { S: State }) {
  const done = completed(S)
  const totalCo2 = co2(S), totalT = tonnes(S)
  const mine = done.filter(t => isParty(S, t))
  const myCo2 = mine.reduce((a, t) => a + txCo2(S, t), 0)
  const myT = mine.reduce((a, t) => a + t.q, 0)
  const share = totalCo2 > 0 ? Math.round((myCo2 / totalCo2) * 100) : 0

  // Breakdown by kind of material (from each deal's supply listing).
  const byKind = Object.values(done.reduce<Record<string, { name: string; t: number; co2: number }>>((acc, t) => {
    const name = catName(categoryOf(listing(S, t.s) as Supply))
    acc[name] ??= { name, t: 0, co2: 0 }
    acc[name].t += t.q
    acc[name].co2 += txCo2(S, t)
    return acc
  }, {})).sort((a, b) => b.t - a.t)

  const latest = [...done].sort((a, b) => completedOn(b).localeCompare(completedOn(a))).slice(0, 5)

  return (
    <>
      <h2>Impact</h2>
      <p className="s" style={{ marginTop: -6 }}>What everyone on AgriReuse has achieved together. Your own results are on your Dashboard.</p>

      <div className="hero impact-hero">
        <div className="impact-head">
          <div><div className="impact-big">{kg(totalCo2)} kg</div><div>CO₂e saved together</div></div>
          <div><div className="impact-big">{f1(totalT)} t</div><div>material reused</div></div>
          <div><div className="impact-big">{done.length}</div><div>completed exchange{done.length == 1 ? '' : 's'}</div></div>
        </div>
        {done.length > 0
          ? <p>That’s about 🚗 <b>{kmNotDriven(totalCo2).toLocaleString('en-NZ')} km</b> of driving avoided and 🗑️ <b>{wheelieBins(totalT).toLocaleString('en-NZ')} wheelie bins</b> kept out of landfill.</p>
          : <p>No exchanges completed yet. The first one starts the count.</p>}
      </div>

      <div className="card">
        <h3>Your contribution</h3>
        {mine.length > 0 ? (
          <>
            <div className="share-bar" role="img" aria-label={`You contributed ${share}% of the CO₂e saved`}>
              <span style={{ width: `${Math.max(2, share)}%` }} />
            </div>
            <p className="s">
              <b style={{ color: 'var(--ink)' }}>{share}%</b> of everything saved came from your {mine.length} exchange{mine.length == 1 ? '' : 's'}:
              {' '}{kg(myCo2)} kg CO₂e and {f1(myT)} t of material.
            </p>
          </>
        ) : <p className="s">Complete your first exchange to add to this total.</p>}
      </div>

      <div className="card">
        <h3>By kind of material</h3>
        {byKind.length == 0 ? <p className="s">Shows up once exchanges complete.</p> : (
          <div className="kind-bars">
            {byKind.map(k => {
              const pct = totalT > 0 ? Math.round((k.t / totalT) * 100) : 0
              return (
                <div className="kind-row" key={k.name}>
                  <span className="kind-name">{k.name}</span>
                  <span className="kind-track" aria-hidden="true"><span style={{ width: `${Math.max(2, pct)}%` }} /></span>
                  <span className="kind-val">{pct}% · {f1(k.t)} t · {kg(k.co2)} kg</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Latest exchanges</h3>
        {latest.length == 0 ? <p className="s">None yet.</p> : latest.map(t => {
          const s = listing(S, t.s)
          return (
            <div className="s latest-row" key={t.id} style={isParty(S, t) ? { color: 'var(--ink)' } : undefined}>
              <span>{completedOn(t)}</span>
              <span>{s.mat} · {s.loc}{isParty(S, t) ? ' · yours' : ''}</span>
              <span>{f1(t.q)} t → {kg(txCo2(S, t))} kg CO₂e</span>
            </div>
          )
        })}
      </div>

      <div className="card">
        <h3>The AgriReuse community</h3>
        <div className="grid">
          {([
            ['Businesses with listings', businessCount(S)],
            ['Supply listings open', S.L.filter(l => l.type == 'Supply' && !l.arch && !l.deletedAt).length],
            ['Requests open', S.L.filter(l => l.type == 'Demand' && !l.arch && !l.deletedAt).length],
          ] as const).map(([label, value]) => (
            <div key={label}><div className="big">{value}</div><div className="s">{label}</div></div>
          ))}
        </div>
      </div>

      <div className="card s">
        <b>How CO₂e is estimated (illustrative factors, not sourced):</b> landfill disposal avoided {EF.disp} kg/t, displaced
        material {EF.alt} kg/t × substitution, minus truck {EF.truck} kg/km and processing {EF.proc} kg/t. Each completed exchange
        is counted once. Scenario estimates, not verified reductions or carbon credits.
      </div>
    </>
  )
}
