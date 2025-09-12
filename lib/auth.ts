import NextAuth from "next-auth"
import Auth0 from "next-auth/providers/auth0"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import crypto from 'crypto'
import { getSupabaseAdmin } from './supabase'

// NextAuth v5 configuration using the new helper
// Build providers list conditionally so missing env vars don't crash dev
const providerList = [] as any[]

// Auth0 (primary aggregator / passwordless, etc.)
try {
  const rawIssuer = process.env.AUTH0_ISSUER || (process.env.AUTH0_DOMAIN ? `https://${process.env.AUTH0_DOMAIN}` : undefined)
  if (process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_SECRET && rawIssuer) {
    providerList.push(
      Auth0({
        clientId: process.env.AUTH0_CLIENT_ID,
        clientSecret: process.env.AUTH0_CLIENT_SECRET,
        issuer: rawIssuer,
        authorization: {
          params: {
            scope: process.env.AUTH0_SCOPE || "openid profile email",
            ...(process.env.AUTH0_AUDIENCE ? { audience: process.env.AUTH0_AUDIENCE } : {}),
          },
        },
      })
    )
    // Optional password grant (username/password form) - enable with AUTH0_PASSWORD_GRANT=1 in env and in Auth0 dashboard (Password Grant > enabled)
    if (process.env.AUTH0_PASSWORD_GRANT === '1') {
      providerList.push(
        Credentials({
          id: 'credentials',
            name: 'Username',
            credentials: {
              email: { label: 'Email', type: 'text', placeholder: 'you@example.com' },
              password: { label: 'Password', type: 'password' },
            },
            async authorize(creds) {
              if (!creds?.email || !creds?.password) return null
              try {
                const tokenRes = await fetch(`${rawIssuer}/oauth/token`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    grant_type: 'password',
                    username: creds.email,
                    password: creds.password,
                    scope: process.env.AUTH0_SCOPE || 'openid profile email',
                    client_id: process.env.AUTH0_CLIENT_ID,
                    client_secret: process.env.AUTH0_CLIENT_SECRET,
                    ...(process.env.AUTH0_AUDIENCE ? { audience: process.env.AUTH0_AUDIENCE } : {}),
                  }),
                })
                if (!tokenRes.ok) {
                  let detail: any = null
                  try { detail = await tokenRes.json() } catch { detail = { error_description: await tokenRes.text() } }
                  const message = detail?.error_description || detail?.error || 'Invalid credentials'
                  throw new Error(message)
                }
                const tokenJson: any = await tokenRes.json()
                // Fetch userinfo for profile
                const userinfoRes = await fetch(`${rawIssuer}/userinfo`, {
                  headers: { Authorization: `Bearer ${tokenJson.access_token}` },
                })
                if (!userinfoRes.ok) {
                  let txt = await userinfoRes.text()
                  throw new Error('Failed to fetch user profile: ' + txt)
                }
                const profile: any = await userinfoRes.json()
                return {
                  id: profile.sub,
                  name: profile.name || profile.email,
                  email: profile.email,
                  image: profile.picture,
                  accessToken: tokenJson.access_token,
                  idToken: tokenJson.id_token,
                  refreshToken: tokenJson.refresh_token,
                  tokenType: tokenJson.token_type,
                  expiresIn: tokenJson.expires_in,
                  provider: 'credentials',
                } as any
              } catch (e) {
                if (e instanceof Error) throw e
                throw new Error('Authentication failed')
              }
            },
        })
      )
    }
  }
} catch (e) {
  // Swallow to avoid build break; will surface when attempting auth
  console.warn("Auth0 provider skipped:", e)
}

// Google direct (optional)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providerList.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  )
}


export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: providerList,
  pages: {
    signIn: "/auth/signin",
  },
  // Use JWT sessions by default
  session: { strategy: "jwt" },
  callbacks: {
    // Protect routes matched by middleware: require a signed-in user
  authorized({ auth }: { auth?: any }) {
      return !!auth?.user
    },
    async jwt({ token, user, trigger }: any) {
      // On initial sign in, upsert user and create a session record
      if (user?.email) {
        try {
          const supabase = getSupabaseAdmin()
          // Upsert user
          await supabase.from('users').upsert({
            email: user.email,
            display_name: user.name ?? null,
            image_url: (user as any).image ?? null,
          })
          // Create a server-side session record if not present
          const existingSid = (token as any).sid as string | undefined
          if (!existingSid) {
            const sid = crypto.randomUUID()
            const maxAgeSec = Number(process.env.NEXTAUTH_SESSION_MAX_AGE ?? 60 * 60 * 24 * 7) // 7 days default
            const expiresAt = new Date(Date.now() + maxAgeSec * 1000).toISOString()
            await supabase.from('sessions').insert({
              user_email: user.email,
              session_token: sid,
              user_agent: 'nextauth-jwt',
              expires_at: expiresAt,
            })
            ;(token as any).sid = sid
            ;(token as any).sid_expires = expiresAt
          }
        } catch (e) {
          console.warn('Supabase user/session sync failed:', e)
        }
      }
      if (user) {
        ;(token as any).id = (user as any).id
        if ((user as any).accessToken) {
          (token as any).accessToken = (user as any).accessToken
          ;(token as any).idToken = (user as any).idToken
          ;(token as any).refreshToken = (user as any).refreshToken
          ;(token as any).tokenType = (user as any).tokenType
          ;(token as any).expiresIn = Date.now() + ((user as any).expiresIn || 0) * 1000
        }
      }
      return token
    },
    async session({ session, token }: any) {
      if (session.user) {
        ;(session.user as any).id = (token.sub as string) ?? (token as any).id
      }
      ;(session as any).accessToken = (token as any).accessToken
      ;(session as any).sid = (token as any).sid
      ;(session as any).sid_expires = (token as any).sid_expires
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
})

