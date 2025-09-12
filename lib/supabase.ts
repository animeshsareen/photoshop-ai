import { createClient } from '@supabase/supabase-js'

// Server-side client with service role for privileged writes from NextAuth callbacks
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in environment.
// Never expose service role to the browser.
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  })
}
