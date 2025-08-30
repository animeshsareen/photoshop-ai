"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Coins, Plus } from "lucide-react"
import { getCredits, CREDITS_PER_DOLLAR } from "@/lib/credits"

interface CreditDisplayProps {
  onPurchaseCredits: () => void
}

export function CreditDisplay({ onPurchaseCredits }: CreditDisplayProps) {
  const [credits, setCredits] = useState(0)

  useEffect(() => {
    setCredits(getCredits())

    // Listen for credit changes
    const handleStorageChange = () => {
      setCredits(getCredits())
    }

    window.addEventListener("storage", handleStorageChange)
    // Custom event for same-tab updates
    window.addEventListener("creditsUpdated", handleStorageChange)

    return () => {
      window.removeEventListener("storage", handleStorageChange)
      window.removeEventListener("creditsUpdated", handleStorageChange)
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
            Buy {CREDITS_PER_DOLLAR} for $1
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Each edit costs 1 credit</p>
      </CardContent>
    </Card>
  )
}
