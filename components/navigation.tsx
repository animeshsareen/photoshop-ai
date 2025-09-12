"use client"

import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Image, LogOut, LogIn, Shirt, Paintbrush } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import Link from "next/link"
import { signOut } from "next-auth/react"

export default function Navigation() {
  const { user, status } = useAuth(false) // don't auto redirect on nav

  const handleSignOut = () => {
    signOut({ callbackUrl: "/" })
  }

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
            {/* Feature buttons adjacent to brand */}
            <Button asChild variant="ghost" size="sm" className="px-2" aria-label="Try My Clothes">
              <Link href="/app" prefetch>
                <Shirt className="h-4 w-4 mr-1" />
                TryMyClothes
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="px-2" aria-label="Free Edit">
              <Link href="/free-edit" prefetch>
                <Paintbrush className="h-4 w-4 mr-1" />
                OpenEdit
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="px-2" aria-label="DeClutter">
              <Link href="/declutter" prefetch>
                <BroomIcon className="h-4 w-4 mr-1" />
                DeClutter
              </Link>
            </Button>
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
