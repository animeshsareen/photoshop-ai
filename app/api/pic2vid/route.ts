import { NextRequest, NextResponse } from "next/server"
import Replicate from "replicate"

import { auth } from "@/lib/auth"
import { CREDIT_COST_PIC2VID } from "@/lib/credits"
import { getSupabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

const replicateToken = process.env.REPLICATE_API_TOKEN

if (!replicateToken) {
  console.error("[pic2vid] Missing REPLICATE_API_TOKEN environment variable")
}

const replicateClient = replicateToken ? new Replicate({ auth: replicateToken }) : null

const ULTRA_MODEL_ID = "kwaivgi/kling-v2.1"
const NORMAL_MODEL_ID = "wan-video/wan-2.2-i2v-fast"

function sanitizeString(value: string | null | undefined) {
  return value ? value.trim() : null
}

async function resolveVideoUrl(output: any): Promise<string | null> {
  if (!output) return null

  const visited = new Set<any>()
  const queue: any[] = [output]

  while (queue.length > 0) {
    const value = queue.shift()
    if (value == null) continue

    if (typeof value === "string") {
      if (value.startsWith("http")) {
        return value
      }
      continue
    }

    if (typeof value !== "object") {
      continue
    }

    if (visited.has(value)) {
      continue
    }

    visited.add(value)

    const maybeUrlFn = (value as any).url
    if (typeof maybeUrlFn === "function") {
      try {
        const resolved = await maybeUrlFn.call(value)
        if (typeof resolved === "string" && resolved.startsWith("http")) {
          return resolved
        }
        if (resolved) queue.push(resolved)
      } catch (error) {
        console.warn("[pic2vid] Failed to resolve url() from replicate output", error)
      }
    } else if (typeof maybeUrlFn === "string" && maybeUrlFn.startsWith("http")) {
      return maybeUrlFn
    }

    if ((value as any).href && typeof (value as any).href === "string" && (value as any).href.startsWith("http")) {
      return (value as any).href
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        queue.push(item)
      }
      continue
    }

    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (key === "url") continue
      queue.push((value as Record<string, unknown>)[key])
    }
  }

  return null
}

export async function POST(request: NextRequest) {
  if (!replicateClient) {
    return NextResponse.json({ error: "Replicate client not configured" }, { status: 500 })
  }

  try {
    const session = await auth()
    const userEmail = session?.user?.email as string | undefined

    if (!userEmail) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    const formData = await request.formData()
    const file =
      (formData.get("image") as File | null) ||
      (formData.get("start_image") as File | null) ||
      (formData.get("file") as File | null)

    if (!file) {
      return NextResponse.json({ error: "Starting image is required" }, { status: 400 })
    }

    const prompt = sanitizeString(formData.get("prompt") as string | null)
    const quality = (sanitizeString(formData.get("quality") as string | null) || "ultra").toLowerCase()

    const supabase = getSupabaseAdmin()

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("credits")
      .eq("email", userEmail)
      .single()

    if (userError || !userData) {
      console.error("[pic2vid] User lookup failed", userError)
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const currentCredits = userData.credits || 0
    const creditCost = CREDIT_COST_PIC2VID

    if (currentCredits < creditCost) {
      return NextResponse.json({ error: "Insufficient credits" }, { status: 402 })
    }

    const newBalance = currentCredits - creditCost
    const { error: creditError } = await supabase.from("users").update({ credits: newBalance }).eq("email", userEmail)
    if (creditError) {
      console.error("[pic2vid] Failed to deduct credits", creditError)
      return NextResponse.json({ error: "Failed to deduct credits" }, { status: 500 })
    }

    try {
      let output: unknown
      if (quality === "normal") {
        const input: Record<string, unknown> = { image: file }
        if (prompt) input.prompt = prompt
        output = await replicateClient.run(NORMAL_MODEL_ID, { input })
      } else {
        const input: Record<string, unknown> = { start_image: file }
        if (prompt) input.prompt = prompt
        output = await replicateClient.run(ULTRA_MODEL_ID, { input })
      }
      const videoUrl = await resolveVideoUrl(output)

      if (!videoUrl) {
        console.error("[pic2vid] Unable to resolve video URL from replicate response")
        return NextResponse.json({ error: "Failed to generate video" }, { status: 500 })
      }

      return NextResponse.json({ videoUrl, remainingCredits: newBalance })
    } catch (err) {
      console.error("[pic2vid] Generation failed", err)
      const { error: rollbackError } = await supabase
        .from("users")
        .update({ credits: currentCredits })
        .eq("email", userEmail)
      if (rollbackError) {
        console.error("[pic2vid] Failed to rollback credits after error", rollbackError)
      }
      return NextResponse.json({ error: "Failed to generate video" }, { status: 500 })
    }
  } catch (error) {
    console.error("[pic2vid] Unexpected error", error)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}
