import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    // In a real app, you'd use Stripe here
    // For demo purposes, we'll simulate a successful payment
    const { amount } = await request.json()

    // Simulate payment processing
    await new Promise((resolve) => setTimeout(resolve, 1000))

    return NextResponse.json({
      success: true,
      clientSecret: "demo_payment_intent_" + Date.now(),
      amount,
    })
  } catch (error) {
    console.error("Payment error:", error)
    return NextResponse.json({ error: "Payment failed" }, { status: 500 })
  }
}
