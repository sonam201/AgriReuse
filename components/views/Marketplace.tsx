import { CATEGORIES, USE_LABELS } from '@/lib/compliance'
import { avail, complianceOf, f1, hasOpenExchange, isMine } from '@/lib/logic'
import type { State } from '@/lib/types'
import type { Actions } from '../App'
import { ComplianceBadge, DemoZoneSwitch } from '../Compliance'

export default function Marketplace({ S, A }: { S: State; A: Actions }) {
  const q = S.q || '', ft = S.ft || 'All', lim = S.lim || 24
  const list = S.L.filter(l => (ft == 'All' || l.type == ft) && (l.mat + l.biz + l.loc).toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <h2>Marketplace</h2>
      <DemoZoneSwitch S={S} A={A} />
      <div className="card row">
        <input placeholder="🔍 Search material, business, place" value={q} onChange={e => A.setFilter(e.target.value, ft)} />
        <select value={ft} onChange={e => A.setFilter(q, e.target.value as State['ft'])}>
          {['All', 'Supply', 'Demand'].map(o => <option key={o}>{o}</option>)}
        </select>
      </div>
      <div className="s">{list.length} listings</div>
      {list.slice(0, lim).map(l => (
        <div className="card" key={l.id}>
          <h3>{l.type}: {l.mat} {l.arch ? '(archived)' : ''} {isMine(S, l) && <span className="tag eligible">Your listing</span>}</h3>
          <div className="s">
            {l.biz} · {l.loc} · {l.type == 'Supply'
              ? `${f1(avail(l))} t available of ${l.qty} t · ${l.cond} · $${l.price}/t · disposal $${l.disp}/t · chemical history: ${l.chem}`
              : `${l.min}–${l.max} t for ${USE_LABELS[l.use1] ?? l.use1} · ${l.accepts?.length ? 'accepts ' + l.accepts.map(a => CATEGORIES.find(x => x.id == a)?.label ?? a).join(', ') : 'any kind'} · ≤${l.maxKm} km · ≤$${l.maxPrice}/t`}
          </div>
          {l.type == 'Supply' && l.moveR ? <span className="tag blocked">⛔ Movement-restricted scenario</span> : null}
          {l.type == 'Supply' && (() => {
            const c = complianceOf(S, l)
            return (
              <div className="s">
                <ComplianceBadge level={c.level} />{' '}
                {l.category ? `${CATEGORIES.find(x => x.id == l.category)?.label}${l.suburb ? ` · ${l.suburb}` : ''} · for ${l.use.map(u => USE_LABELS[u] ?? u).join(', ')}` : 'Listed before compliance checks'}
                {c.rules.length > 0 && <> · {c.rules.map(r => r.message).join(' ')}</>}
                {l.declaredAt && <> · ✍️ seller declaration signed</>}
              </div>
            )
          })()}
          {isMine(S, l) && (
            <p>
              <button className="btn" disabled={A.busy || hasOpenExchange(S, l.id)} onClick={() => A.startEdit(l.id)}
                title={hasOpenExchange(S, l.id) ? 'An exchange is in progress; finish or cancel it to edit' : undefined}>Edit</button>{' '}
              <button className="btn alt" disabled={A.busy} onClick={() => A.toggleArchive(l.id)}>{l.arch ? 'Restore' : 'Archive'}</button>{' '}
              <button className="btn alt" disabled={A.busy} onClick={() => A.deleteListing(l.id)}>Delete</button>
            </p>
          )}
        </div>
      ))}
      {list.length > lim && <button className="btn" onClick={() => A.showMore(lim + 24)}>Show more</button>}
    </>
  )
}
