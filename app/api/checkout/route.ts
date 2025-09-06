import { NextResponse } from "next/server"
import Stripe from "stripe"

export async function POST() {
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

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price,
          quantity: 1,
        },
      ],
      // These must be absolute URLs
      success_url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/checkout/cancel`,
      // Optional: collect email to correlate later
      allow_promotion_codes: false,
    })

    return NextResponse.json({ id: session.id, url: session.url })
  } catch (error) {
    console.error("Error creating Stripe Checkout Session", error)
    return NextResponse.json({ error: "Unable to start checkout" }, { status: 500 })
  }
}
