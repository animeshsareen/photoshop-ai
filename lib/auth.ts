import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

// NextAuth v5 configuration using the new helper
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Allow NextAuth to infer host from Vercel deployment URLs
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
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
  async jwt({ token, user }: any) {
      if (user) {
        // Persist user id on the token for session callback
        ;(token as any).id = (user as any).id
      }
      return token
    },
  async session({ session, token }: any) {
      if (session.user) {
        // Add id to the client session
        // token.sub holds the user id by default; fall back to token.id if set
        ;(session.user as any).id = (token.sub as string) ?? (token as any).id
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
})

