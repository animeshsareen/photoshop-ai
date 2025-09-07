"use client"

import { signIn, getSession } from "next-auth/react"
import React, { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"

export default function SignIn() {
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await getSession()
        if (session) {
          router.push("/app")
        }
      } catch (error) {
        console.error("Session check error:", error)
        // Continue to show sign-in page if there's an error
      } finally {
        setIsCheckingSession(false)
      }
    }
    checkSession()
  }, [router])

  // (Optional) could fetch providers, but with only two known ones we hardcode.

  const providers = [
    {
      id: "google",
      label: "Google",
      icon: (
        <img
          src="/google-icon.png"
          alt="Google"
          className="h-4 w-4"
          width={16}
          height={16}
          loading="lazy"
        />
      )
    }
  ]

  // Removed popup flow; using credentials grant inline.

  const handleProvider = async (id: string) => {
  setIsLoading(true)
  setErrorMsg(null)
    try {
      if (id === "google") {
        const maybe: any = await signIn(id, { callbackUrl: "/app", redirect: true })
        if (maybe && maybe.error) {
          setErrorMsg(maybe.error)
          setIsLoading(false)
        }
      } else {
        setIsLoading(false)
      }
    } catch (e: unknown) {
      console.error("Sign in error:", e)
      setIsLoading(false)
      const msg = typeof e === "object" && e && 'message' in e ? (e as any).message : "Sign in failed"
      setErrorMsg(msg)
    }
  }

  // Username/password flow removed; only Google OAuth remains.

  if (isCheckingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
  <Card className="w-full max-w-md border border-black">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome to PhotoshopAI</CardTitle>
          <CardDescription>
            Sign in to start editing your photos with AI
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-3">
            {providers.map(p => (
              <Button
                key={p.id}
                onClick={() => handleProvider(p.id)}
                disabled={isLoading}
                size="lg"
                variant="default"
                className="w-full justify-center bg-[#34A853] hover:bg-[#2c8c47] text-white border-transparent focus-visible:ring-offset-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...
                  </>
                ) : (
                  <span className="flex items-center gap-2 font-medium">
                    {p.icon}
                    {`Sign in with ${p.label}`}
                  </span>
                )}
              </Button>
            ))}
          </div>
          {errorMsg && (
            <div className="text-center text-sm text-destructive" role="alert">
              {errorMsg}
            </div>
          )}
          <div className="text-center text-sm text-muted-foreground">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
