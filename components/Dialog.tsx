'use client'

import { useEffect, useRef } from 'react'

// In-app replacement for the browser's confirm()/alert(): a modal with Cancel / Confirm (or just OK).
export interface DialogRequest {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string | null // null = a message with only an OK button
  danger?: boolean
  resolve: (ok: boolean) => void
}

export default function Dialog({ req, onDone }: { req: DialogRequest; onDone: () => void }) {
  const confirmBtn = useRef<HTMLButtonElement>(null)
  const close = (ok: boolean) => { req.resolve(ok); onDone() }
  const hasCancel = req.cancelLabel !== null

  useEffect(() => {
    confirmBtn.current?.focus()
    const key = (e: KeyboardEvent) => { if (e.key == 'Escape') close(false) }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="modal-backdrop dialog-backdrop" onClick={() => close(false)}>
      <div className="modal card dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg"
        onClick={e => e.stopPropagation()}>
        <h3 id="dlg-title">{req.title}</h3>
        {req.message && <p id="dlg-msg" className="dialog-msg">{req.message}</p>}
        <div className="dialog-actions">
          {hasCancel && <button className="btn alt" onClick={() => close(false)}>{req.cancelLabel ?? 'Cancel'}</button>}
          <button ref={confirmBtn} className={'btn' + (req.danger ? ' btn-danger' : '')} onClick={() => close(true)}>
            {req.confirmLabel ?? (hasCancel ? 'Confirm' : 'OK')}
          </button>
        </div>
      </div>
    </div>
  )
}
