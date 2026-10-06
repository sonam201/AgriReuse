'use client'

import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'

// Shown after the user opens a password-reset link (they are signed in by the link).
export default function ResetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (password != confirm) return setMsg('The passwords don’t match.')
    setBusy(true)
    setMsg('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setMsg(error.code == 'same_password' ? 'Choose a password different from your old one.' : error.message)
    onDone()
  }

  return (
    <>
      <header>
        <b>🌱 AgriReuse</b>
        <span className="demo hide-sm">Payments simulated</span>
      </header>
      <main style={{ maxWidth: 480 }}>
        <form className="card" onSubmit={submit}>
          <h3>🔑 Set a new password</h3>
          <div className="row" style={{ gridTemplateColumns: '1fr' }}>
            <div><label>New password</label><input type="password" required minLength={6} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} autoFocus /></div>
            <div><label>Confirm new password</label><input type="password" required minLength={6} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
          </div>
          {msg && <p className="warn">{msg}</p>}
          <button className="btn" disabled={busy}>{busy ? 'Please wait…' : 'Save new password'}</button>{' '}
          <button type="button" className="btn alt" disabled={busy} onClick={() => supabase?.auth.signOut().then(onDone)}>Cancel</button>
        </form>
      </main>
    </>
  )
}
