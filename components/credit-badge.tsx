"use client"

import { useEffect, useState } from "react"
import { Coins, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

interface CreditBadgeProps {
  className?: string
  size?: "sm" | "md"
  onPurchase?: () => Promise<void> | void
}

export function CreditBadge({ className, size = "sm", onPurchase }: CreditBadgeProps) {
  const [credits, setCredits] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let ignore = false
    const fetchCredits = async () => {
      try {
        const res = await fetch("/api/credits", { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        if (!ignore && typeof data.credits === "number") setCredits(data.credits)
      } catch {}
    }
    fetchCredits()
    const handler = () => fetchCredits()
    window.addEventListener("creditsUpdated", handler)
    return () => { ignore = true; window.removeEventListener("creditsUpdated", handler) }
  }, [])

  const handleBuy = async () => {
    try {
      setLoading(true)
      if (onPurchase) return await onPurchase()
      const res = await fetch("/api/checkout", { method: "POST" })
      const data = await res.json().catch(() => null as any)
      if (!res.ok) throw new Error(data?.error || data?.code || `HTTP ${res.status}`)
      if (data?.url) {
        window.location.href = data.url as string
      } else {
        throw new Error("No checkout URL returned")
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Unable to start checkout. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const isSmall = size === "sm"

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-border bg-background/80 backdrop-blur",
        isSmall ? "px-2.5 py-1 text-sm" : "px-3.5 py-1.5 text-base",
        className
      )}
      aria-label={`${credits} credits`}
    >
      <Coins className={cn("text-primary", isSmall ? "h-4 w-4" : "h-5 w-5")} />
      <span className="font-semibold text-foreground leading-none">{credits}</span>
      <button
        type="button"
        onClick={handleBuy}
        disabled={loading}
        className={cn(
          "ml-1 inline-flex items-center gap-1 rounded-full border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-colors",
          isSmall ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
        )}
        aria-label="Buy credits"
      >
        <Plus className={cn(isSmall ? "h-3.5 w-3.5" : "h-4 w-4")} />
        Buy
      </button>
    </div>
  )
}

export default CreditBadge
