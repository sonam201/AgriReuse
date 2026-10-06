import { STEPS } from '@/lib/data'
import { f1, gate, isParty, listing, stepActor, turn } from '@/lib/logic'
import type { Demand, State, Supply } from '@/lib/types'
import type { Actions } from '../App'
import Tag from '../Tag'
import OffersPanel from '../OffersPanel'

export default function Transactions({ S, A }: { S: State; A: Actions }) {
  const mine = S.T.filter(t => isParty(S, t))
  return (
    <>
      <h2>Transactions</h2>
      <div className="warn">Payments are simulated: no real money is collected, held or released.</div>
      <br />
      <OffersPanel S={S} A={A} />
      <br />
      {mine.length ? mine.map(t => {
        const s = listing(S, t.s) as Supply, d = listing(S, t.d) as Demand
        const g = gate(S, s, d, s.id + d.id), end = t.step == 6 || t.cx
        const next = STEPS[t.step + 1], who = stepActor(t, t.step + 1), whose = turn(S, t)
        const counterparty = who == 'supplier' ? s.biz : d.biz
        return (
          <div className="card" key={t.id}>
            <h3>{s.mat}: {s.biz} ({s.loc}) → {d.biz}</h3>
            <div className="s">
              {f1(t.q)} t at ${t.price}/t · you are the {t.supplierId == S.me.id ? 'supplier' : 'receiver'} ·{' '}
              {t.cx ? <b>{t.cx.toUpperCase()}</b> : t.step == 6 ? '✔ Completed' : `Next: ${next} (${who})`}
            </div>
            <Tag g={g} />
            <ol className="s">{t.log.map((l, i) => <li key={i}>{l[0]} — {l[1]}</li>)}</ol>
            {!end && (
              <>
                {whose == 'waiting'
                  ? <button className="btn" disabled>Waiting for {counterparty}</button>
                  : <button className="btn" disabled={A.busy} onClick={() => A.advance(t.id)}>
                      {next}{whose == 'simulated' ? ` (simulated for ${counterparty})` : ''}
                    </button>}{' '}
                <button className="btn alt" disabled={A.busy} onClick={() => A.cancel(t.id, 'cancelled')}>Cancel</button>{' '}
                <button className="btn alt" disabled={A.busy} onClick={() => A.cancel(t.id, 'dispute')}>Raise dispute</button>
              </>
            )}
          </div>
        )
      }) : <p>No transactions yet. Start one from Matches.</p>}
    </>
  )
}
