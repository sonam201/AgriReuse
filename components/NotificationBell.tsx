'use client'

import { useEffect, useRef, useState } from 'react'
import type { State } from '@/lib/types'
import type { Actions } from './App'

export default function NotificationBell({ S, A }: { S: State; A: Actions }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const unread = S.N.filter(n => !n.read).length

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key == 'Escape') setOpen(false) }
    document.addEventListener('mousedown', click)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key) }
  }, [open])

  return (
    <div className="bell" ref={ref}>
      <button className="btn alt bell-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        🔔{unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <b>Notifications</b>
            {unread > 0 && <button className="btn alt" disabled={A.busy} onClick={A.markAllRead}>Mark all read</button>}
          </div>
          {S.N.length == 0 && <p className="s">No notifications yet.</p>}
          {S.N.slice(0, 15).map(n => (
            <button key={n.id} className={'bell-item' + (n.read ? '' : ' unread')} disabled={A.busy}
              onClick={() => { A.openNotification(n.id); setOpen(false) }}>
              {n.read ? '' : '● '}{n.txt}
              <span className="s"> · {n.tab}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
