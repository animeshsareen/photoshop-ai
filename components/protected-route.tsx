"use client"

import { useAuth } from "@/hooks/use-auth"
import { Loader2 } from "lucide-react"
import { ReactNode } from "react"

interface ProtectedRouteProps {
  children: ReactNode
  fallback?: ReactNode
}

export default function ProtectedRoute({ children, fallback }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      fallback || (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      )
    )
  }

  if (!isAuthenticated) {
    return null // This will trigger the redirect in useAuth hook
  }

  return <>{children}</>
}
