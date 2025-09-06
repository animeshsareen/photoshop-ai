import { NextResponse } from "next/server"
import Stripe from "stripe"

// Helper to build an absolute site URL in all environments.
function getBaseUrl() {
  // Prefer an explicitly configured public site URL first (you can add NEXT_PUBLIC_SITE_URL in Vercel dashboard).
  const explicit = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL
  if (explicit) return explicit.replace(/\/$/, "")
  // Vercel provides VERCEL_URL without protocol (e.g. my-app.vercel.app)
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  // Fallback to localhost for local dev only.
  return "http://localhost:3000"
}

export async function POST(req: Request) {
  try {
    const secret = process.env.STRIPE_SECRET_KEY
    const price = process.env.STRIPE_PRICE_ID

    if (!secret) {
      return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY" }, { status: 500 })
    }
    if (!price) {
      return NextResponse.json({ error: "Missing STRIPE_PRICE_ID" }, { status: 500 })
    }

    const stripe = new Stripe(secret, { apiVersion: "2024-06-20" })

    const baseUrl = getBaseUrl()

    // Warn (server-side only) if we unexpectedly ended up with localhost while in production.
    if (process.env.NODE_ENV === "production" && baseUrl.includes("localhost")) {
      console.warn("[checkout] Base URL resolved to localhost in production. Set NEXT_PUBLIC_SITE_URL or NEXTAUTH_URL.")
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        { price, quantity: 1 },
      ],
      success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout/cancel`,
      allow_promotion_codes: false,
    })

    return NextResponse.json({ id: session.id, url: session.url })
  } catch (error) {
    console.error("Error creating Stripe Checkout Session", error)
    return NextResponse.json({ error: "Unable to start checkout" }, { status: 500 })
  }
}
