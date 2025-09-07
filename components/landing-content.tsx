"use client";

import Link from "next/link";
import { Wand2, Image, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LandingContent() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        {/* Hero */}
        <section className="text-center mb-16">
          <h1 className="text-5xl font-bold text-foreground mb-6">
            Transform Your Photos with
            <span className="text-primary"> AI Magic</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Upload clothing and see yourself wearing it. Incredible fidelity.
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
        </section>

        {/* Features */}
        <section className="grid md:grid-cols-3 gap-8 mb-16">
          <Card>
            <CardHeader>
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Image className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Multiple Image Support</CardTitle>
              <CardDescription>Search for clothes in-line using natural language.</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Wand2 className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Natural Language Editing</CardTitle>
              <CardDescription>Try before you buy!</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Secure & Private</CardTitle>
              <CardDescription>Your photos are processed securely and never stored permanently.</CardDescription>
            </CardHeader>
          </Card>
        </section>

        {/* How It Works */}
        <section className="text-center mb-16">
          <h2 className="text-3xl font-bold text-foreground mb-8">How It Works</h2>
          <div className="grid md:grid-cols-4 gap-6">
            {["Sign In","Upload Photos","Describe Outfit","Get Result"].map((label, i) => (
              <div key={label} className="text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-primary">{i+1}</span>
                </div>
                <h3 className="font-semibold mb-2">{label}</h3>
                <p className="text-sm text-muted-foreground">
                  {i===0 && "Quick Google OAuth authentication"}
                  {i===1 && "Drag & drop images, or search."}
                  {i===2 && "Search or enter what you'd like to try on"}
                  {i===3 && "Download your AI-generated image"}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section>
          <Card className="max-w-2xl mx-auto text-center">
            <CardContent className="p-8">
              <h2 className="text-2xl font-bold text-foreground mb-4">Ready to Transform Your Photos?</h2>
              <p className="text-muted-foreground mb-6">Join thousands of users already creating amazing images with AI</p>
              <Button asChild size="lg">
                <Link href="/auth/signin">
                  <Zap className="mr-2 h-5 w-5" />
                  Start Creating Now
                </Link>
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
