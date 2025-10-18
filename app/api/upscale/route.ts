import { NextRequest, NextResponse } from "next/server"
import Replicate from "replicate"

import { auth } from "@/lib/auth"
import { CREDIT_COST_PER_EDIT } from "@/lib/credits"
import { getSupabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

const replicateToken = process.env.REPLICATE_API_TOKEN

if (!replicateToken) {
  console.error("[upscale] Missing REPLICATE_API_TOKEN environment variable")
}

const replicateClient = replicateToken ? new Replicate({ auth: replicateToken }) : null

function parseDesiredIncrease(raw: string | null): number {
  const FALLBACK = 2
  if (!raw) return FALLBACK
  const numeric = Number.parseInt(raw, 10)
  return [2, 3, 4].includes(numeric) ? numeric : FALLBACK
}

async function toDataUrlFromResponse(res: Response) {
  const arrayBuffer = await res.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const mimeType = res.headers.get("content-type") || "image/png"
  const base64 = buffer.toString("base64")
  return `data:${mimeType};base64,${base64}`
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
      (formData.get("image_0") as File | null) ||
      (formData.get("file") as File | null)

    if (!file) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 })
    }

    const desiredIncrease = parseDesiredIncrease((formData.get("desired_increase") as string | null) || null)

    const supabase = getSupabaseAdmin()

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("credits")
      .eq("email", userEmail)
      .single()

    if (userError || !userData) {
      console.error("[upscale] User lookup failed", userError)
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const currentCredits = userData.credits || 0
    const creditCost = CREDIT_COST_PER_EDIT

    if (currentCredits < creditCost) {
      return NextResponse.json({ error: "Insufficient credits" }, { status: 402 })
    }

    const newBalance = currentCredits - creditCost
    const { error: creditError } = await supabase.from("users").update({ credits: newBalance }).eq("email", userEmail)
    if (creditError) {
      console.error("[upscale] Failed to deduct credits", creditError)
      return NextResponse.json({ error: "Failed to deduct credits" }, { status: 500 })
    }

    try {
      const input = {
        image: file,
        desired_increase: desiredIncrease,
      }

      const output: unknown = await replicateClient.run("bria/increase-resolution", {
        input,
      })

      let remoteUrl: string | null = null
      let dataUrl: string | null = null

      if (typeof output === "string") {
        remoteUrl = output
      } else if (Array.isArray(output)) {
        remoteUrl = output.find((item): item is string => typeof item === "string") ?? null
      } else if (output && typeof output === "object") {
        const maybeUrl = (output as any).url
        if (typeof maybeUrl === "function") {
          try {
            remoteUrl = await maybeUrl.call(output)
          } catch (urlError) {
            console.warn("[upscale] Failed to resolve output url from function", urlError)
          }
        } else if (typeof maybeUrl === "string") {
          remoteUrl = maybeUrl
        } else if (typeof (output as any).image === "string") {
          remoteUrl = (output as any).image
        }

        if (!remoteUrl && typeof (output as any).arrayBuffer === "function") {
          try {
            const buffer = Buffer.from(await (output as any).arrayBuffer())
            const mimeType = (output as any).type || "image/png"
            const base64 = buffer.toString("base64")
            dataUrl = `data:${mimeType};base64,${base64}`
          } catch (arrayBufferError) {
            console.warn("[upscale] Failed to convert output arrayBuffer", arrayBufferError)
          }
        }
      }

      if (!dataUrl && remoteUrl) {
        try {
          const response = await fetch(remoteUrl)
          if (response.ok) {
            dataUrl = await toDataUrlFromResponse(response)
          } else {
            console.warn("[upscale] Failed to fetch upscale asset", response.status, response.statusText)
          }
        } catch (fetchError) {
          console.warn("[upscale] Error fetching upscaled image", fetchError)
        }
      }

      if (!dataUrl && remoteUrl) {
        dataUrl = remoteUrl
      }

      if (!dataUrl) {
        throw new Error("No upscaled image generated")
      }

      return NextResponse.json({
        upscaledUrl: dataUrl,
        remainingCredits: newBalance,
        creditsUsed: creditCost,
        desiredIncrease,
      })
    } catch (generationError) {
      console.error("[upscale] Generation error", generationError)
      try {
        await supabase.from("users").update({ credits: currentCredits }).eq("email", userEmail)
      } catch (refundError) {
        console.error("[upscale] Credit refund failed", refundError)
      }
      return NextResponse.json({ error: "Failed to upscale image" }, { status: 500 })
    }
  } catch (error) {
    console.error("[upscale] Unexpected error", error)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}
