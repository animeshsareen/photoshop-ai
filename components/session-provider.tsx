"use client"

import { SessionProvider, useSession } from "next-auth/react"
import { ReactNode, useEffect } from "react"
import { ensureInitialCredits } from "@/lib/credits"

interface Props {
  children: ReactNode
}

export default function AuthSessionProvider({ children }: Props) {
  return (
    <SessionProvider>
      <SeedCreditsOnAuth />
      {children}
    </SessionProvider>
  )
}

function SeedCreditsOnAuth() {
  const { status } = useSession()
  useEffect(() => {
    if (status === "authenticated") {
      ensureInitialCredits()
    }
  }, [status])
  return null
}
