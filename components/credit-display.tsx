"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Coins, Plus } from "lucide-react"
import { CREDITS_PER_DOLLAR } from "@/lib/credits"

interface CreditDisplayProps {
  onPurchaseCredits: () => void
}

export function CreditDisplay({ onPurchaseCredits }: CreditDisplayProps) {
  const [credits, setCredits] = useState(0)

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

    const handleChange = () => fetchCredits()
    window.addEventListener("creditsUpdated", handleChange)
    return () => {
      ignore = true
      window.removeEventListener("creditsUpdated", handleChange)
    }
  }, [])

  return (
    <Card className="bg-primary/5 border-primary/20">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            <span className="font-medium text-foreground">{credits} credits</span>
          </div>
          <Button
            onClick={onPurchaseCredits}
            size="sm"
            variant="outline"
            className="border-primary text-primary hover:bg-primary hover:text-primary-foreground bg-transparent"
          >
            <Plus className="h-4 w-4 mr-1" />
            Buy {CREDITS_PER_DOLLAR} for $0.99
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Each edit costs 1 credit</p>
      </CardContent>
    </Card>
  )
}
