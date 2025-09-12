"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { Wand2, Image, Shield, Zap, Coins, Paintbrush, Shirt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DEFAULT_FREE_CREDITS } from "@/lib/credits"

// Marketing feature list (kept local for quick iteration)
const FEATURES = [
  {
    icon: <Wand2 className="h-6 w-6 text-primary" aria-hidden="true" />,
    title: "Advanced Image AI",
    desc: "Use the best model available: Gemini 2.5 Flash Image.",
  },
  {
    icon: <Image className="h-6 w-6 text-primary" aria-hidden="true" />,
    title: "Smart Search",
    desc: "Inline clothing search so you can try more outfits, faster.",
  },
  {
    icon: <Shield className="h-6 w-6 text-primary" aria-hidden="true" />,
    title: "Private by Default",
    desc: "Local credit tracking & secure Google sign‑in.",
  },
  {
    icon: <Zap className="h-6 w-6 text-primary" aria-hidden="true" />,
    title: "Fast Pipeline",
    desc: "Built-in image compression and quick generation.",
  },
]

export default function LandingContent() {
  const { status } = useSession()
  const isAuthed = status === "authenticated"

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-background/60">
      <div className="mx-auto w-full max-w-6xl px-4 py-24 md:py-32">
        {/* Hero */}
        <section className="text-center space-y-6" aria-labelledby="hero-heading">
          <h1 id="hero-heading" className="text-balance text-5xl md:text-6xl font-bold tracking-tight">
            Try your clothes <span className="text-primary">with AI</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Virtual try‑ons, clothing search, and a freeform image editor.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center pt-2" aria-label="Primary actions">
            {isAuthed ? (
              <>
                <Button asChild size="lg" className="px-8" data-testid="cta-go-to-app">
                  <Link href="/app" prefetch>
                    <Shirt className="h-5 w-5 mr-2" /> Get Started
                  </Link>
                </Button>
                <Button variant="outline" asChild size="lg" className="px-8" data-testid="cta-free-edit">
                  <Link href="/free-edit" prefetch>
                    <Paintbrush className="h-5 w-5 mr-2" /> OpenEdit
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild size="lg" className="px-8" data-testid="cta-get-started">
                  <Link href="/auth/signin">
                    Get Started
                  </Link>
                </Button>
                <Button variant="outline" asChild size="lg" className="px-8" data-testid="cta-try-editor">
                  <Link href="/free-edit" prefetch>
                    Try OpenEdit
                  </Link>
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1" aria-live="polite">
            <Coins className="h-3.5 w-3.5 text-primary" /> Includes {DEFAULT_FREE_CREDITS} free credits on first sign‑in.
          </p>
        </section>

        {/* Feature Grid */}
        <section className="mt-28" aria-labelledby="features-heading">
          <h2 id="features-heading" className="sr-only">Key Features</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(f => (
              <Card key={f.title} className="relative overflow-hidden group">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-3">
                    <div className="rounded-md bg-primary/10 p-2 ring-1 ring-primary/15 group-hover:ring-primary/40 transition-colors">
                      {f.icon}
                    </div>
                    <CardTitle className="text-base font-semibold leading-tight">
                      {f.title}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <CardDescription className="text-sm leading-relaxed">
                    {f.desc}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" aria-labelledby="how-heading" className="mt-32">
          <div className="text-center mb-12 space-y-2">
            <h2 id="how-heading" className="text-3xl md:text-4xl font-bold tracking-tight">How It Works</h2>
            <p className="text-sm md:text-base text-muted-foreground max-w-xl mx-auto">
              Four quick steps from sign‑in to download.
            </p>
          </div>
          <ol className="grid md:grid-cols-4 gap-6" aria-label="Steps">
            {["Sign In","Upload Photos","Describe Outfit","Get Result"].map((label, i) => (
              <li key={label} className="text-center flex flex-col items-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 font-bold text-primary text-2xl">
                  {i + 1}
                </div>
                <h3 className="font-semibold mb-1">{label}</h3>
                <p className="text-sm text-muted-foreground max-w-[18ch] mx-auto">
                  {i===0 && "Secure OAuth sign‑in"}
                  {i===1 && "Drag & drop or select"}
                  {i===2 && "Inline garment search"}
                  {i===3 && "Download & iterate"}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Secondary CTA */}
        <section className="mt-40 text-center" aria-labelledby="cta-end-heading">
          <h2 id="cta-end-heading" className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Ready to Experiment?</h2>
          <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
            Jump straight into virtual try-ons, or try OpenEdit for natural language editing.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" data-testid="cta-bottom-primary">
              <Link href={isAuthed ? "/app" : "/auth/signin"}>{isAuthed ? "TryMyClothes" : "Get Started Free"}</Link>
            </Button>
            <Button variant="outline" asChild size="lg" data-testid="cta-bottom-secondary">
              <Link href="/free-edit" prefetch>OpenEdit</Link>
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
