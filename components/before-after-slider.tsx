"use client"

import type { PointerEvent as ReactPointerEvent } from "react"
import { useRef, useState, useCallback } from "react"
import Image from "next/image"
import { ChevronsLeftRight } from "lucide-react"

import { cn } from "@/lib/utils"

interface BeforeAfterSliderProps {
  beforeSrc: string
  afterSrc: string
  beforeAlt?: string
  afterAlt?: string
  beforeLabel?: string
  afterLabel?: string
  className?: string
}

export function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  beforeAlt = "Before",
  afterAlt = "After",
  beforeLabel = "Before",
  afterLabel = "After",
  className,
}: BeforeAfterSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [percent, setPercent] = useState(50)
  const [isActive, setIsActive] = useState(false)

  const clampPercent = useCallback((value: number) => {
    if (Number.isNaN(value)) return 0
    return Math.min(100, Math.max(0, value))
  }, [])

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const bounds = containerRef.current?.getBoundingClientRect()
      if (!bounds) return
      const next = ((clientX - bounds.left) / bounds.width) * 100
      setPercent(clampPercent(next))
    },
    [clampPercent],
  )

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsActive(true)
    updateFromClientX(event.clientX)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isActive) return
    updateFromClientX(event.clientX)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId)
    setIsActive(false)
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full overflow-hidden rounded-lg border border-border bg-muted touch-none select-none cursor-col-resize",
        className,
      )}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="absolute inset-0">
        <Image src={afterSrc} alt={afterAlt} fill className="object-cover" sizes="(min-width: 1024px) 480px, 320px" />
      </div>
      <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${percent}%` }}>
        <Image src={beforeSrc} alt={beforeAlt} fill className="object-cover" sizes="(min-width: 1024px) 480px, 320px" />
      </div>
      <div className="absolute top-3 left-3 z-20 rounded-full bg-background/70 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-foreground shadow-sm">
        {beforeLabel}
      </div>
      <div className="absolute top-3 right-3 z-20 rounded-full bg-background/70 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-foreground shadow-sm">
        {afterLabel}
      </div>
      <div className="absolute inset-y-0 z-10 flex w-px items-stretch" style={{ left: `${percent}%`, transform: "translateX(-50%)" }}>
        <span className="h-full w-[2px] bg-background/70 backdrop-blur-sm" />
      </div>
      <div
        className="pointer-events-none absolute top-1/2 z-20 flex items-center justify-center"
        style={{ left: `${percent}%`, transform: "translate(-50%, -50%)" }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background/80 shadow-md backdrop-blur">
          <ChevronsLeftRight className="h-5 w-5 text-foreground" />
        </div>
      </div>
    </div>
  )
}
