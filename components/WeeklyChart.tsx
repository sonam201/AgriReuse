'use client'

import { useEffect, useRef, useState } from 'react'
import { f1 } from '@/lib/logic'

type Bucket = { start: string; co2: number; tonnes: number; deals: number }

const H = 170, TOP = 22, BOTTOM = 24, BAR = 24, R = 4
const BAR_FILL = '#3ed168'

const label = (iso: string) => new Date(iso + 'T00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })

// Column with a 4px rounded data-end and a square base on the baseline.
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(R, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

// Weekly CO2e saved from completed exchanges (single series; tonnes and deals in the tooltip).
export default function WeeklyChart({ buckets, title }: { buckets: Bucket[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null)
  // Draw at the real pixel width so text stays 11px on any screen.
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(600)
  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  const max = Math.max(...buckets.map(b => b.co2), 1)
  const slot = W / buckets.length, base = H - BOTTOM, plotH = base - TOP
  const short = slot < 48 // narrow screens: label every other week
  const empty = buckets.every(b => b.deals == 0)

  return (
    <div className="chart">
      <h3>{title}</h3>
      {empty && <p className="s">No completed exchanges in the last {buckets.length} weeks yet.</p>}
      <div style={{ position: 'relative' }} ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, last ${buckets.length} weeks`}>
        <line x1={0} x2={W} y1={base + 0.5} y2={base + 0.5} stroke="var(--ln)" strokeWidth={1} />
        {buckets.map((b, i) => {
          const h = b.co2 > 0 ? Math.max(2, (b.co2 / max) * plotH) : 0
          const x = i * slot + (slot - BAR) / 2, y = base - h
          return (
            <g key={b.start}>
              {h > 0 && <path d={columnPath(x, y, BAR, h)} fill={BAR_FILL} opacity={hover == null || hover == i ? 1 : 0.55} />}
              {h > 0 && (
                <text x={x + BAR / 2} y={y - 6} textAnchor="middle" fontSize={11} fill="var(--ink)" fontFamily="system-ui">{Math.round(b.co2)}</text>
              )}
              {(!short || (buckets.length - 1 - i) % 2 == 0) && <text x={i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--mut)" fontFamily="system-ui">{label(b.start)}</text>}
              {/* Hit target spans the whole week slot, larger than the bar. */}
              <rect x={i * slot} y={0} width={slot} height={base} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          )
        })}
      </svg>
      {hover != null && buckets[hover].deals > 0 && (
        <div className="tip" style={{ left: `${((hover + 0.5) / buckets.length) * 100}%`, top: `${((base - (buckets[hover].co2 / max) * plotH - 22) / H) * 100}%` }}>
          <b>Week of {label(buckets[hover].start)}</b><br />
          {f1(buckets[hover].co2)} kg CO₂e · {f1(buckets[hover].tonnes)} t · {buckets[hover].deals} exchange(s)
        </div>
      )}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Week of</th><th>kg CO₂e</th><th>Tonnes</th><th>Exchanges</th></tr></thead>
        <tbody>
          {buckets.map(b => <tr key={b.start}><td>{label(b.start)}</td><td>{f1(b.co2)}</td><td>{f1(b.tonnes)}</td><td>{b.deals}</td></tr>)}
        </tbody>
      </table>
      <p className="s">kg CO₂e saved per week from completed exchanges (estimates). Hover a bar for tonnes and exchanges.</p>
    </div>
  )
}
