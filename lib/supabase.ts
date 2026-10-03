import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const configured = Boolean(url && key)

// A password-reset link arrives with type=recovery in the URL hash. Read it before the client
// consumes and clears the hash, so the app can show the "set a new password" screen.
export const openedFromRecoveryLink =
  typeof window !== 'undefined' && /[#&]type=recovery(&|$)/.test(window.location.hash)

// Null when env vars are missing; the app shows setup instructions instead.
export const supabase: SupabaseClient | null = configured ? createClient(url!, key!) : null
