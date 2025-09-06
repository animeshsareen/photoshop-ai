"use client"

import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import * as React from 'react'

export function ThemeToggle() {
  const { theme, setTheme, systemTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const current = theme === 'system' ? systemTheme : theme

  const toggle = () => {
    if (current === 'dark') setTheme('light')
    else setTheme('dark')
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={toggle}
      className="relative"
    >
      {!mounted ? (
        <span className="h-4 w-4" />
      ) : current === 'dark' ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
