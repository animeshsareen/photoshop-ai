"use client"

import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Image, LogOut, LogIn, Shirt, Paintbrush, Video, RefreshCw, ChevronDown, Wrench } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import Link from "next/link"
import { signOut } from "next-auth/react"
import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

export default function Navigation() {
  const { user, status } = useAuth(false) // don't auto redirect on nav
  const [isToolsOpen, setIsToolsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const handleSignOut = () => {
    signOut({ callbackUrl: "/" })
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsToolsOpen(false)
      }
    }

    if (isToolsOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isToolsOpen])

  const BroomIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* handle */}
      <path d="M14 3l7 7" />
      {/* ferrule */}
      <path d="M12.5 6.5l5 5" />
      {/* broom head */}
      <path d="M3 21c1-3 4-6 7-7l4 4c-1 3-4 6-7 7" />
      {/* bristles */}
      <path d="M9 18l3 3" />
      <path d="M7 19l2 2" />
    </svg>
  )

  return (
    <nav className="bg-background border-b border-border">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-3">
            {/* Brand should always take user to the public landing page */}
            <Link href="/landing" className="flex items-center space-x-2" aria-label="Go to landing page">
              <Image className="h-6 w-6" />
              <span className="font-bold text-lg">PhotoshopAI</span>
            </Link>
            {/* Tools dropdown */}
            <div className="relative" ref={dropdownRef}>
              <Button
                variant="ghost"
                size="sm"
                className="px-2"
                onClick={() => setIsToolsOpen(!isToolsOpen)}
                aria-label="Tools"
              >
                <Wrench className="h-4 w-4 mr-1" />
                Tools
                <ChevronDown 
                  className={cn(
                    "h-4 w-4 ml-1 transition-transform duration-200",
                    isToolsOpen && "rotate-180"
                  )} 
                />
              </Button>
              
              {/* Dropdown menu */}
              <div
                className={cn(
                  "absolute top-full left-0 mt-1 w-48 bg-background border border-border rounded-md shadow-lg z-50 transition-all duration-200 ease-in-out",
                  isToolsOpen 
                    ? "opacity-100 visible translate-y-0" 
                    : "opacity-0 invisible -translate-y-2"
                )}
              >
                <div className="py-1">
                  <Button asChild variant="ghost" size="sm" className="w-full justify-start px-3 py-2 h-auto" aria-label="Try My Clothes">
                    <Link href="/app" prefetch onClick={() => setIsToolsOpen(false)}>
                      <Shirt className="h-4 w-4 mr-2" />
                      TryMyClothes
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="w-full justify-start px-3 py-2 h-auto" aria-label="DeClutter">
                    <Link href="/declutter" prefetch onClick={() => setIsToolsOpen(false)}>
                      <BroomIcon className="h-4 w-4 mr-2" />
                      DeClutter
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="w-full justify-start px-3 py-2 h-auto" aria-label="Open Edit">
                    <Link href="/free-edit" prefetch onClick={() => setIsToolsOpen(false)}>
                      <Paintbrush className="h-4 w-4 mr-2" />
                      OpenEdit
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="w-full justify-start px-3 py-2 h-auto" aria-label="RestoreAI">
                    <Link href="/restore-ai" prefetch onClick={() => setIsToolsOpen(false)}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      RestoreAI
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="w-full justify-start px-3 py-2 h-auto" aria-label="ThumbnailStudio">
                    <Link href="/thumbnail-studio" prefetch onClick={() => setIsToolsOpen(false)}>
                      <Video className="h-4 w-4 mr-2" />
                      ThumbnailStudio
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <ThemeToggle />
            <div className="w-px h-6 bg-border" />
            <div className="flex items-center space-x-4">
              {status === 'authenticated' && (
                <span className="text-sm text-muted-foreground hidden md:block" data-auth="yes">
                  Welcome, {user?.name || 'User'}
                </span>
              )}
              {status === 'authenticated' ? (
                <Button variant="outline" size="sm" onClick={handleSignOut} data-testid="sign-out-btn">
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </Button>
              ) : status === 'unauthenticated' ? (
                <Button asChild variant="outline" size="sm" data-testid="sign-in-btn">
                  <Link href="/auth/signin">
                    <LogIn className="h-4 w-4 mr-2" />
                    Sign In
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}
