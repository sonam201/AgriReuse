import { EF } from '@/lib/data'
import { businessCount, co2, completed, f1, isParty, kmNotDriven, listing, tonnes, txCo2, weekly, wheelieBins } from '@/lib/logic'
import type { State } from '@/lib/types'
import WeeklyChart from '../WeeklyChart'

export default function Impact({ S }: { S: State }) {
  const done = completed(S)
  const mine = done.filter(t => isParty(S, t))

  const platform: [string, string | number][] = [
    ['Farmers & businesses', businessCount(S)],
    ['Active supply listings', S.L.filter(l => l.type == 'Supply' && !l.arch).length],
    ['Active demand listings', S.L.filter(l => l.type == 'Demand' && !l.arch).length],
    ['Completed exchanges', done.length],
    ['Tonnes reused', f1(tonnes(S))],
    ['Net CO₂e saved (kg, est.)', f1(co2(S))],
  ]

  return (
    <>
      <h2>Impact</h2>
      <div className="card">
        <div className="big">{f1(co2(S))} kg CO₂e</div>
        <div className="s">Platform-wide completed-exchange estimate · {f1(tonnes(S))} t · each completed exchange counted once</div>
      </div>
      <div className="card">
        <div className="equiv">
          <span>🚗 ≈ <b>{kmNotDriven(co2(S)).toLocaleString('en-NZ')} km</b> of driving avoided</span>
          <span>🗑️ ≈ <b>{wheelieBins(tonnes(S)).toLocaleString('en-NZ')} wheelie bins</b> kept out of landfill</span>
        </div>
        <p className="s" style={{ margin: '6px 0 0' }}>Rough everyday equivalents (average car ≈ 0.2 kg CO₂e/km; one 240 L bin ≈ 0.1 t). Illustrative only.</p>
      </div>
      <div className="card"><WeeklyChart buckets={weekly(done, S)} title="CO₂e saved per week, all of AgriReuse" /></div>
      <h3 className="t">Across AgriReuse</h3>
      <div className="grid">
        {platform.map(([label, value]) => (
          <div className="card" key={label}><div className="big">{value}</div><div className="s">{label}</div></div>
        ))}
      </div>
      <div className="card">
        <h3>Completed exchanges</h3>
        {done.length
          ? done.map(t => (
              <div className="s" key={t.id} style={isParty(S, t) ? { color: 'var(--ink)' } : undefined}>
                {listing(S, t.s).mat}: {f1(t.q)} t → {f1(txCo2(S, t))} kg{isParty(S, t) ? ' · yours' : ''}
              </div>
            ))
          : 'None yet'}
        {mine.length > 0 && <p className="s">Your share: {mine.length} exchange(s), {f1(mine.reduce((a, t) => a + t.q, 0))} t, {f1(mine.reduce((a, t) => a + txCo2(S, t), 0))} kg CO₂e.</p>}
      </div>
      <div className="card s">
        <b>Method (illustrative demo factors, not sourced):</b> landfill disposal {EF.disp} kg/t, displaced material {EF.alt} kg/t,
        truck {EF.truck} kg/km, processing {EF.proc} kg/t. Net = avoided disposal + displaced production × substitution − transport − processing.
        Scenario estimates, not verified reductions or carbon credits.
      </div>
    </>
  )
}
