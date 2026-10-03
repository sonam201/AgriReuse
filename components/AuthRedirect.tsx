'use client'

import { useEffect } from 'react'

// Email confirmation links land on the Site URL (/) when /app isn't in Supabase's allowed
// redirect URLs; pass the session (or error) in the hash on to the app.
export default function AuthRedirect() {
  useEffect(() => {
    const h = window.location.hash
    if (/[#&](access_token|error_code)=/.test(h)) window.location.replace('/app' + h)
  }, [])
  return null
}
