"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export default function CancelPage() {
  const router = useRouter()
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <h1 className="text-2xl font-semibold">Payment Canceled</h1>
        <p>You can try again anytime.</p>
        <Button onClick={() => router.push("/app")}>Back to app</Button>
      </div>
    </div>
  )
}
