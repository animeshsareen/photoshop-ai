import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { getSupabaseAdmin } from "@/lib/supabase"
import { DEFAULT_FREE_CREDITS } from "@/lib/credits"
import { auth } from "@/lib/auth"

export const runtime = "nodejs"

type BalanceRow = { device_id: string; ip_address: string | null; credits: number; updated_at?: string }

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

function resolveTrackingKey(req: NextRequest, h: Headers): { key: string; ip: string | null; mode: "ip" | "device"; deviceId: string | null } {
  const queryMode = (req.nextUrl.searchParams.get("by") || "").toLowerCase()
  const envMode = (process.env.CREDITS_TRACKING_MODE || "device").toLowerCase()
  const mode: "ip" | "device" = (queryMode === "ip" || queryMode === "device") ? (queryMode as any) : (envMode === "ip" ? "ip" : "device")
  const ip = getClientIp(h)
  const cookieId = req.cookies.get("device_id")?.value || null
  if (mode === "ip" && ip) return { key: `ip:${ip}`, ip, mode, deviceId: cookieId }
  // Fallback to device if IP not available or mode is device
  const deviceKey = cookieId ? `device:${cookieId}` : `device:unknown`
  return { key: deviceKey, ip, mode: "device", deviceId: cookieId }
}

async function getOrCreateDevice(supabase: ReturnType<typeof getSupabaseAdmin>, deviceId: string, ip: string | null) {
  const { data, error } = await supabase
    .from("device_credits")
    .select("device_id, ip_address, credits")
    .eq("device_id", deviceId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    const { data: inserted, error: insErr } = await supabase
      .from("device_credits")
      .insert({ device_id: deviceId, ip_address: ip, credits: DEFAULT_FREE_CREDITS })
      .select("device_id, ip_address, credits")
      .single()
    if (insErr) throw insErr
    return inserted as BalanceRow
  }
  // Optionally update last seen IP
  if (ip && ip !== data.ip_address) {
    await supabase.from("device_credits").update({ ip_address: ip }).eq("device_id", deviceId)
  }
  return data as BalanceRow
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    const userEmail = session?.user?.email as string | undefined
    const h = await headers()
    const { key, ip, mode, deviceId } = resolveTrackingKey(req, h)
    const supabase = getSupabaseAdmin()
    if (userEmail) {
      // Prefer user-based credits when authenticated
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
      return NextResponse.json({ key: `user:${userEmail}`, mode: "user", deviceId, ip, credits })
    }

    const row = await getOrCreateDevice(supabase, key, ip)
    return NextResponse.json({ key, mode, deviceId, ip, credits: row.credits })
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
    const { key, ip, mode, deviceId } = resolveTrackingKey(req, h)
    const body = await req.json().catch(() => ({}))
    const { action, amount, reason, idempotencyKey } = body as { action: "add" | "deduct"; amount: number; reason?: string; idempotencyKey?: string }
    if (!action || typeof amount !== "number" || amount <= 0) {
      return NextResponse.json({ error: "Invalid action or amount" }, { status: 400 })
    }
    const supabase = getSupabaseAdmin()

    // User-based flow
    if (userEmail) {
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
          return NextResponse.json({ key: `user:${userEmail}`, mode: "user", deviceId, ip, credits: bal?.credits ?? 0, idempotent: true })
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
      return NextResponse.json({ key: `user:${userEmail}`, mode: "user", deviceId, ip, credits: newBalance })
    }

    // Device-based fallback (legacy)
    // Ensure device exists
    await getOrCreateDevice(supabase, key, ip)

    // Idempotency: if a ledger row with same key exists, return current balance
    if (idempotencyKey) {
      const { data: existing, error: ledErr } = await supabase
        .from("credit_ledger")
        .select("id, delta")
        .eq("device_id", key)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle()
      if (ledErr) throw ledErr
      if (existing) {
        const { data: bal } = await supabase.from("device_credits").select("credits").eq("device_id", key).single()
        return NextResponse.json({ key, mode, deviceId, ip, credits: bal?.credits ?? 0, idempotent: true })
      }
    }

    // Perform balance update in a single RPC to avoid race conditions
    const delta = action === "add" ? Math.abs(amount) : -Math.abs(amount)

    // Fetch balance first to enforce non-negative in app layer
    const { data: currentRow, error: curErr } = await supabase
      .from("device_credits")
      .select("credits")
      .eq("device_id", key)
      .single()
    if (curErr) throw curErr
    const newBalance = (currentRow.credits || 0) + delta
    if (newBalance < 0) {
      return NextResponse.json({ error: "Insufficient credits" }, { status: 402 })
    }

    const { error: updErr } = await supabase
      .from("device_credits")
      .update({ credits: newBalance })
      .eq("device_id", key)
    if (updErr) throw updErr

    const { error: ledInsErr } = await supabase.from("credit_ledger").insert({
      device_id: key,
      ip_address: ip,
      delta,
      reason: reason || null,
      idempotency_key: idempotencyKey || null,
    })
    if (ledInsErr) {
      console.warn("[credits] ledger insert failed", ledInsErr)
    }

    return NextResponse.json({ key, mode, deviceId, ip, credits: newBalance })
  } catch (e: any) {
    console.error("[credits] POST failed", e)
    return NextResponse.json({ error: e?.message || "Failed to update credits" }, { status: 500 })
  }
}
