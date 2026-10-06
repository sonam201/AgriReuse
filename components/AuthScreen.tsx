'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { CITY } from '@/lib/data'
import { supabase } from '@/lib/supabase'
import type { Role } from '@/lib/types'

const RESEND_SECONDS = 60

// The confirmation link returns here; supabase-js reads the session from the URL.
const redirectTo = () => window.location.origin + '/app'

export default function AuthScreen() {
  // 'verify' = signed up, waiting for the user to confirm their email (link, or code if the template has one).
  const [mode, setMode] = useState<'in' | 'up' | 'verify' | 'forgot'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [role, setRole] = useState<Role>('Supplier')
  const [location, setLocation] = useState('Hamilton')
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    // Landing page links open the form in sign-in (?mode=in) or sign-up (?mode=up) mode.
    if (new URLSearchParams(window.location.search).get('mode') == 'up') setMode('up')
    // An expired or already-used confirmation link comes back with the error in the URL hash.
    const hash = new URLSearchParams(window.location.hash.slice(1))
    if (hash.get('error_code') == 'otp_expired') setMsg('That confirmation link has expired or was already used. Sign in to get a new one.')
    else if (hash.get('error_description')) setMsg(hash.get('error_description')!)
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const switchMode = (m: 'in' | 'up' | 'forgot') => { setMode(m); setMsg(''); setCode('') }

  // The link signs the user in and AuthGate shows the "set a new password" screen.
  async function sendReset(e: FormEvent) {
    e.preventDefault()
    if (!supabase || cooldown > 0) return
    setBusy(true)
    setMsg('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() })
    setBusy(false)
    if (error) return setMsg(error.message)
    setCooldown(RESEND_SECONDS)
    // Same message whether or not the account exists, so the form can't be used to probe for emails.
    setMsg(`If an account exists for ${email}, we’ve sent a link to reset your password. Check your inbox and spam folder.`)
  }

  function awaitConfirmation(note: string) {
    setMode('verify')
    setCode('')
    setCooldown(RESEND_SECONDS)
    setMsg(note)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setMsg('')
    try {
      if (mode == 'up') {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { business_name: businessName, role, location }, emailRedirectTo: redirectTo() },
        })
        if (error) return setMsg(error.message)
        // Supabase returns a user with no identities when the email is already registered.
        if (data.user && data.user.identities?.length === 0) return setMsg('An account with this email already exists. Sign in instead.')
        if (!data.session) awaitConfirmation(`We sent an email to ${email}. Click the link in it to activate your account.`)
      } else if (mode == 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error?.code == 'email_not_confirmed') {
          const r = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo() } })
          awaitConfirmation(r.error ? r.error.message : `Your email isn't confirmed yet. We sent a new link to ${email}.`)
        } else if (error) setMsg(error.message)
      } else {
        // Success signs the user in; AuthGate picks up the new session.
        const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'signup' })
        if (error) setMsg(error.code == 'otp_expired' ? 'That code is wrong or has expired. Check it, or send a new email.' : error.message)
      }
    } finally {
      setBusy(false)
    }
  }

  // For when the link was opened in another tab or device: the account is confirmed, so just sign in.
  async function continueAfterConfirm() {
    if (!supabase) return
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error?.code == 'email_not_confirmed') setMsg('Not confirmed yet. Click the link in the email first, then try again.')
    else if (error) setMsg(error.message)
  }

  async function resend() {
    if (!supabase || cooldown > 0) return
    setBusy(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo() } })
    setBusy(false)
    if (error) return setMsg(error.message)
    setCooldown(RESEND_SECONDS)
    setMsg(`New email sent to ${email}.`)
  }

  return (
    <>
      <header>
        <b>🌱 AgriReuse</b>
        <span className="demo">Payments simulated</span>
        <span className="header-actions"><Link className="btn alt" href="/">← Home</Link></span>
      </header>
      <main style={{ maxWidth: 480 }}>
        <div className="hero">
          <h1>List it. Match it. Reuse it. 🌾</h1>
          <p>Pass on surplus material, source material to reuse, or both.</p>
        </div>
        {mode == 'verify' ? (
          <div className="card">
            <h3>📧 Check your email</h3>
            {msg && <p className="warn">{msg}</p>}
            <p className="s">The link signs you straight in. Opened it on another tab or device? Click continue.</p>
            <button className="btn" disabled={busy} onClick={continueAfterConfirm}>{busy ? 'Please wait…' : 'I’ve confirmed, continue'}</button>{' '}
            <button type="button" className="btn alt" disabled={busy || cooldown > 0} onClick={resend}>
              {cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend email'}
            </button>
            <details style={{ marginTop: 12 }}>
              <summary className="s">Got a code instead?</summary>
              <form onSubmit={submit} className="row" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end' }}>
                <div>
                  <label>Verification code</label>
                  <input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10}
                    placeholder="123456" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
                </div>
                <button className="btn" disabled={busy || code.length < 6}>Verify</button>
              </form>
            </details>
            <p className="s">
              Wrong email? <a href="#" style={{ color: 'var(--g)' }} onClick={e => { e.preventDefault(); switchMode('up') }}>Go back</a>. Can’t find it? Check your spam folder.
            </p>
          </div>
        ) : mode == 'forgot' ? (
          <form className="card" onSubmit={sendReset}>
            <h3>🔑 Forgot your password?</h3>
            <p className="s">Enter your account email and we’ll send you a link to set a new password.</p>
            <div className="row" style={{ gridTemplateColumns: '1fr' }}>
              <div><label>Email</label><input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus /></div>
            </div>
            {msg && <p className="warn">{msg}</p>}
            <button className="btn" disabled={busy || cooldown > 0}>
              {busy ? 'Please wait…' : cooldown > 0 ? `Send again (${cooldown}s)` : 'Send reset link'}
            </button>{' '}
            <button type="button" className="btn alt" onClick={() => switchMode('in')}>Back to sign in</button>
          </form>
        ) : (
          <form className="card" onSubmit={submit}>
            <h3>{mode == 'in' ? 'Sign in' : 'Create an account'}</h3>
            <div className="row" style={{ gridTemplateColumns: '1fr' }}>
              <div><label>Email</label><input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
              <div><label>Password</label><input type="password" required minLength={6} autoComplete={mode == 'in' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} /></div>
              {mode == 'up' && (
                <>
                  <div><label>Business name</label><input required value={businessName} onChange={e => setBusinessName(e.target.value)} /></div>
                  <div>
                    <label>What do you want to do first? (you can add the other later in Profile)</label>
                    <select value={role} onChange={e => setRole(e.target.value as Role)}>
                      <option value="Supplier">Sell: I have surplus or waste material</option>
                      <option value="Receiver">Buy: I need material (compost, feed, worm farming)</option>
                    </select>
                  </div>
                  <div>
                    <label>Location</label>
                    <select value={location} onChange={e => setLocation(e.target.value)}>
                      {Object.keys(CITY).map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>
            {msg && <p className="warn">{msg}</p>}
            <button className="btn" disabled={busy}>{busy ? 'Please wait…' : mode == 'in' ? 'Sign in' : 'Create account'}</button>{' '}
            <button type="button" className="btn alt" onClick={() => switchMode(mode == 'in' ? 'up' : 'in')}>
              {mode == 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
            </button>
            {mode == 'in' && (
              <p className="s">
                <a href="#" style={{ color: 'var(--g)' }} onClick={e => { e.preventDefault(); switchMode('forgot') }}>Forgot password?</a>
              </p>
            )}
          </form>
        )}
      </main>
    </>
  )
}
