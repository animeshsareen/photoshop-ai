import { NextResponse } from "next/server"
import { headers } from "next/headers"
import Stripe from "stripe"

// Helper to build an absolute site URL in all environments.
async function getBaseUrl() {
  // 1. Explicit public site URL (recommended to set in production)
  const explicit = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL
  if (explicit) return explicit.replace(/\/$/, "")

  // 2. Derive from request headers (host + forwarded proto) – works on Vercel & most hosts
  const h = await headers()
  const host = h.get("x-forwarded-host") || h.get("host") || ""
  if (host) {
    const proto = h.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https")
    return `${proto}://${host}`.replace(/\/$/, "")
  }

  // 3. Vercel-provided env var (no protocol)
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`

  // 4. Local dev fallback
  return "http://localhost:3000"
}

export async function POST(req: Request) {
  try {
    const secret = process.env.STRIPE_SECRET_KEY
    const price = process.env.STRIPE_PRICE_ID
  const debug = process.env.DEBUG_CHECKOUT === "1"

    if (!secret) {
      return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY", code: "ENV_MISSING_SECRET" }, { status: 500 })
    }
    if (!price) {
      return NextResponse.json({ error: "Missing STRIPE_PRICE_ID", code: "ENV_MISSING_PRICE" }, { status: 500 })
    }
    if (!price.startsWith("price_")) {
      return NextResponse.json({ error: "Invalid STRIPE_PRICE_ID format", code: "ENV_BAD_PRICE_FORMAT" }, { status: 500 })
    }

    const stripe = new Stripe(secret, { apiVersion: "2024-06-20" })

  const baseUrl = await getBaseUrl()

    // Warn (server-side only) if we unexpectedly ended up with localhost while in production.
    if (process.env.NODE_ENV === "production" && baseUrl.includes("localhost")) {
      console.warn("[checkout] WARNING: Base URL resolved to localhost in production. Set NEXT_PUBLIC_SITE_URL (preferred) or NEXTAUTH_URL.")
    }

    let session
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          { price, quantity: 1 },
        ],
        success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/checkout/cancel`,
        allow_promotion_codes: false,
      })
    } catch (stripeErr: any) {
      console.error("Stripe API error", {
        message: stripeErr?.message,
        type: stripeErr?.type,
        code: stripeErr?.code,
        raw: stripeErr,
        // Don't log secrets, just whether they exist
        env: {
          hasSecret: !!secret,
          hasPrice: !!price,
          nodeEnv: process.env.NODE_ENV,
          resolvedBaseUrl: baseUrl,
        },
      })
      return NextResponse.json({
        error: "Stripe session creation failed",
        code: "STRIPE_API_ERROR",
        stripe: debug ? {
          message: stripeErr?.message,
          type: stripeErr?.type,
          code: stripeErr?.code,
        } : undefined,
      }, { status: 500 })
    }

    return NextResponse.json({ id: session.id, url: session.url })
  } catch (error) {
    console.error("Error creating Stripe Checkout Session", error)
    return NextResponse.json({ error: "Unable to start checkout", code: "UNKNOWN_ERROR" }, { status: 500 })
  }
}
