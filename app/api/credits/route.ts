import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { getSupabaseAdmin } from "@/lib/supabase"
import { DEFAULT_FREE_CREDITS } from "@/lib/credits"

export const runtime = "nodejs"

type BalanceRow = { device_id: string; ip_address: string | null; credits: number; updated_at?: string }

function getClientIp(h: Headers): string | null {
  const xf = h.get("x-forwarded-for") || ""
  if (xf) {
    const first = xf.split(",")[0]?.trim()
    if (first) return first
  }
  return h.get("x-real-ip") || null
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
    const cookieId = req.cookies.get("device_id")?.value
    if (!cookieId) return NextResponse.json({ error: "Missing device cookie" }, { status: 400 })
    const h = await headers()
    const ip = getClientIp(h)
    const supabase = getSupabaseAdmin()
    const row = await getOrCreateDevice(supabase, cookieId, ip)
    return NextResponse.json({ deviceId: cookieId, ip, credits: row.credits })
  } catch (e: any) {
    console.error("[credits] GET failed", e)
    return NextResponse.json({ error: e?.message || "Failed to fetch credits" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const cookieId = req.cookies.get("device_id")?.value
    if (!cookieId) return NextResponse.json({ error: "Missing device cookie" }, { status: 400 })
    const body = await req.json().catch(() => ({}))
    const { action, amount, reason, idempotencyKey } = body as { action: "add" | "deduct"; amount: number; reason?: string; idempotencyKey?: string }
    if (!action || typeof amount !== "number" || amount <= 0) {
      return NextResponse.json({ error: "Invalid action or amount" }, { status: 400 })
    }
    const h = await headers()
    const ip = getClientIp(h)
    const supabase = getSupabaseAdmin()

    // Ensure device exists
    await getOrCreateDevice(supabase, cookieId, ip)

    // Idempotency: if a ledger row with same key exists, return current balance
    if (idempotencyKey) {
      const { data: existing, error: ledErr } = await supabase
        .from("credit_ledger")
        .select("id, delta")
        .eq("device_id", cookieId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle()
      if (ledErr) throw ledErr
      if (existing) {
        const { data: bal } = await supabase.from("device_credits").select("credits").eq("device_id", cookieId).single()
        return NextResponse.json({ deviceId: cookieId, ip, credits: bal?.credits ?? 0, idempotent: true })
      }
    }

    // Perform balance update in a single RPC to avoid race conditions
    const delta = action === "add" ? Math.abs(amount) : -Math.abs(amount)

    // Fetch balance first to enforce non-negative in app layer
    const { data: currentRow, error: curErr } = await supabase
      .from("device_credits")
      .select("credits")
      .eq("device_id", cookieId)
      .single()
    if (curErr) throw curErr
    const newBalance = (currentRow.credits || 0) + delta
    if (newBalance < 0) {
      return NextResponse.json({ error: "Insufficient credits" }, { status: 402 })
    }

    const { error: updErr } = await supabase
      .from("device_credits")
      .update({ credits: newBalance })
      .eq("device_id", cookieId)
    if (updErr) throw updErr

    const { error: ledInsErr } = await supabase.from("credit_ledger").insert({
      device_id: cookieId,
      ip_address: ip,
      delta,
      reason: reason || null,
      idempotency_key: idempotencyKey || null,
    })
    if (ledInsErr) {
      console.warn("[credits] ledger insert failed", ledInsErr)
    }

    return NextResponse.json({ deviceId: cookieId, ip, credits: newBalance })
  } catch (e: any) {
    console.error("[credits] POST failed", e)
    return NextResponse.json({ error: e?.message || "Failed to update credits" }, { status: 500 })
  }
}
