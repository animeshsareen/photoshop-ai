import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  // Ensure a stable, anonymous device identifier is present
  try {
    const cookieName = "device_id"
    const existing = req.cookies.get(cookieName)?.value
    if (!existing) {
      const deviceId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
      const res = NextResponse.next()
      // 400 days (~13 months) max per browser policy
      res.cookies.set(cookieName, deviceId, { path: "/", httpOnly: false, sameSite: "lax", maxAge: 60 * 60 * 24 * 400 })
      return res
    }
  } catch {
    // Best-effort only
  }
  return NextResponse.next()
})

export const config = {
  matcher: [
    "/app/:path*",
    "/checkout/:path*",
    "/api/edit-image/:path*",
    "/api/create-payment-intent/:path*",
  "/api/checkout/:path*",
    "/api/credits/:path*",
    // Add other protected routes here
  ],
}
