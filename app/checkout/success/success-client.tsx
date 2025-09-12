"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CREDITS_PER_DOLLAR } from "@/lib/credits"

export default function SuccessClient() {
  const params = useSearchParams()
  const router = useRouter()
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    const sessionId = params.get("session_id")
    if (!sessionId) return
    const key = `credited_${sessionId}`
    if (localStorage.getItem(key)) {
      setApplied(true)
      return
    }
    ;(async () => {
      try {
        const res = await fetch("/api/credits", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "add", amount: CREDITS_PER_DOLLAR, reason: `stripe:session:${sessionId}` , idempotencyKey: `stripe:${sessionId}`}),
        })
        if (res.ok) {
          localStorage.setItem(key, "1")
          window.dispatchEvent(new Event("creditsUpdated"))
          setApplied(true)
        }
      } catch {}
    })()
  }, [params])

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <h1 className="text-2xl font-semibold">Payment Successful</h1>
        <p>{applied ? `Added ${CREDITS_PER_DOLLAR} credits to your account.` : "Applying credits..."}</p>
        <Button onClick={() => router.push("/app")}>Go back to app</Button>
      </div>
    </div>
  )
}
