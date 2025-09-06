"use client"

import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Image, LogOut } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import Link from "next/link"
import { signOut } from "next-auth/react"

export default function Navigation() {
  const { user } = useAuth()

  const handleSignOut = () => {
    signOut({ callbackUrl: "/" })
  }

  return (
    <nav className="bg-background border-b border-border">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-4">
            <Link href="/app" className="flex items-center space-x-2">
              <Image className="h-6 w-6" />
              <span className="font-bold text-lg">AI Photo Editor</span>
            </Link>
          </div>

          <div className="flex items-center space-x-2">
            <ThemeToggle />
            <div className="w-px h-6 bg-border" />
            <div className="flex items-center space-x-4">
            <span className="text-sm text-muted-foreground hidden md:block">
              Welcome, {user?.name}
            </span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}
