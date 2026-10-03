import type { Gate } from '@/lib/types'

const LABEL = {
  eligible: '✔ Eligible for demo matching',
  restricted: '⚠ Restricted / verification required',
  blocked: '⛔ Do not match / movement restricted',
}

export default function Tag({ g }: { g: Gate }) {
  return <span className={'tag ' + g[0]}>{LABEL[g[0]]}</span>
}
