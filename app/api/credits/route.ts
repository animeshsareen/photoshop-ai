import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { getSupabaseAdmin } from "@/lib/supabase"
import { DEFAULT_FREE_CREDITS } from "@/lib/credits"
import { auth } from "@/lib/auth"

export const runtime = "nodejs"

// Device-based balance removed; we now rely solely on user accounts + ledger

function getClientIp(h: Headers): string | null {
  let ip: string | null = null
  const xf = h.get("x-forwarded-for") || ""
  if (xf) {
    const first = xf.split(",")[0]?.trim()
    if (first) ip = first
  }
  if (!ip) ip = h.get("x-real-ip") || null
  // Normalize IPv6-mapped IPv4 and drop loopback
  if (ip?.startsWith("::ffff:")) ip = ip.slice(7)
  if (ip === "::1" || ip === "127.0.0.1") ip = null
  return ip
}

// All device-based logic removed.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    const userEmail = session?.user?.email as string | undefined
    const h = await headers()
    const ip = getClientIp(h)
    const supabase = getSupabaseAdmin()
    if (!userEmail) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Ensure user row exists and initialize credits if needed
    const { data: userRow, error: userErr } = await supabase
      .from("users")
      .select("email, credits")
      .eq("email", userEmail)
      .maybeSingle()
    if (userErr) throw userErr
    let credits = userRow?.credits ?? null
    if (credits === null || credits === undefined) {
      const { data: up, error: upErr } = await supabase
        .from("users")
        .update({ credits: DEFAULT_FREE_CREDITS })
        .eq("email", userEmail)
        .select("credits")
        .single()
      if (upErr) throw upErr
      credits = up.credits
    }
    return NextResponse.json({ key: `user:${userEmail}`, mode: "user", ip, credits })
  } catch (e: any) {
    console.error("[credits] GET failed", e)
    return NextResponse.json({ error: e?.message || "Failed to fetch credits" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    const userEmail = session?.user?.email as string | undefined
    const h = await headers()
    const ip = getClientIp(h)
    const body = await req.json().catch(() => ({}))
    const { action, amount, reason, idempotencyKey } = body as { action: "add" | "deduct"; amount: number; reason?: string; idempotencyKey?: string }
    if (!action || typeof amount !== "number" || amount <= 0) {
      return NextResponse.json({ error: "Invalid action or amount" }, { status: 400 })
    }
    const supabase = getSupabaseAdmin()

    // User-based flow
    if (!userEmail) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Idempotency check against user ledger (table: user_credit_ledger)
    if (idempotencyKey) {
      const { data: existing, error: ledErr } = await supabase
        .from("user_credit_ledger")
        .select("id, delta")
        .eq("user_email", userEmail)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle()
      if (ledErr) throw ledErr
      if (existing) {
        const { data: bal } = await supabase.from("users").select("credits").eq("email", userEmail).single()
        return NextResponse.json({ key: `user:${userEmail}`, mode: "user", ip, credits: bal?.credits ?? 0, idempotent: true })
      }
    }

    const delta = action === "add" ? Math.abs(amount) : -Math.abs(amount)
    const { data: cur, error: curErr } = await supabase
      .from("users")
      .select("credits")
      .eq("email", userEmail)
      .single()
    if (curErr) throw curErr
    const newBalance = (cur.credits || 0) + delta
    if (newBalance < 0) return NextResponse.json({ error: "Insufficient credits" }, { status: 402 })
    const { error: updErr } = await supabase.from("users").update({ credits: newBalance }).eq("email", userEmail)
    if (updErr) throw updErr
    const { error: ledUserErr } = await supabase.from("user_credit_ledger").insert({
      user_email: userEmail,
      ip_address: ip,
      delta,
      reason: reason || null,
      idempotency_key: idempotencyKey || null,
    })
    if (ledUserErr) console.warn("[credits] user ledger insert failed", ledUserErr)
    return NextResponse.json({ key: `user:${userEmail}`, mode: "user", ip, credits: newBalance })
  } catch (e: any) {
    console.error("[credits] POST failed", e)
    return NextResponse.json({ error: e?.message || "Failed to update credits" }, { status: 500 })
  }
}
