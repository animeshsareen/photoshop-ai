"use client"

import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Wand2, Image, Shield, Zap } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import LandingContent from "@/components/landing-content"

export default async function LandingPage() {
  // Server-side check to eliminate client flicker
  const session = await auth()
  if (session?.user) {
    redirect("/app")
  }
  return <LandingContent />
}

