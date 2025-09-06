"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Wand2, Image, Shield, Zap } from "lucide-react"
import Link from "next/link"

export default function LandingContent() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-foreground mb-6">
            Transform Your Photos with
            <span className="text-primary"> AI Magic</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Upload multiple photos and describe your vision in natural language. 
            Our AI will create stunning edited images that bring your ideas to life.
          </p>
          <div className="flex gap-4 justify-center">
            <Button asChild size="lg">
              <Link href="/auth/signin">
                <Wand2 className="mr-2 h-5 w-5" />
                Get Started Free
              </Link>
            </Button>
            <Button variant="outline" size="lg">
              Learn More
            </Button>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <Card>
            <CardHeader>
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Image className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Multiple Image Support</CardTitle>
              <CardDescription>
                Upload several photos at once and let AI combine them into one masterpiece
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Wand2 className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Natural Language Editing</CardTitle>
              <CardDescription>
                Describe your vision in plain English - no technical skills required
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Secure & Private</CardTitle>
              <CardDescription>
                Your photos are processed securely and never stored permanently
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* How It Works */}
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold text-foreground mb-8">How It Works</h2>
          <div className="grid md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary">1</span>
              </div>
              <h3 className="font-semibold mb-2">Sign In</h3>
              <p className="text-sm text-muted-foreground">Quick Google OAuth authentication</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary">2</span>
              </div>
              <h3 className="font-semibold mb-2">Upload Photos</h3>
              <p className="text-sm text-muted-foreground">Drag & drop multiple images</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary">3</span>
              </div>
              <h3 className="font-semibold mb-2">Describe Edit</h3>
              <p className="text-sm text-muted-foreground">Tell AI what you want to create</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary">4</span>
              </div>
              <h3 className="font-semibold mb-2">Get Result</h3>
              <p className="text-sm text-muted-foreground">Download your AI-generated image</p>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <Card className="max-w-2xl mx-auto text-center">
          <CardContent className="p-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">
              Ready to Transform Your Photos?
            </h2>
            <p className="text-muted-foreground mb-6">
              Join thousands of users who are already creating amazing images with AI
            </p>
            <Button asChild size="lg">
              <Link href="/auth/signin">
                <Zap className="mr-2 h-5 w-5" />
                Start Creating Now
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
