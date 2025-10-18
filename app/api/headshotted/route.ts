import { NextRequest, NextResponse } from "next/server"
import Replicate from "replicate"

import { auth } from "@/lib/auth"
import { CREDIT_COST_PER_EDIT } from "@/lib/credits"
import { getSupabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

const replicateToken = process.env.REPLICATE_API_TOKEN

if (!replicateToken) {
  console.error("[headshotted] Missing REPLICATE_API_TOKEN environment variable")
}

const replicateClient = replicateToken ? new Replicate({ auth: replicateToken }) : null

const UPSCALE_MODEL_ID = "bria/increase-resolution"
const HEADSHOT_UPSCALE_INCREASE = (() => {
  const parsed = Number(process.env.HEADSHOT_UPSCALE_INCREASE)
  if (Number.isFinite(parsed)) {
    return Math.min(4, Math.max(2, Math.round(parsed)))
  }
  return 2
})()

function sanitizeString(value: string | null | undefined) {
  return value ? value.trim() : null
}

async function toDataUrlFromResponse(res: Response) {
  const arrayBuffer = await res.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const mimeType = res.headers.get("content-type") || "image/png"
  const base64 = buffer.toString("base64")
  return `data:${mimeType};base64,${base64}`
}

type ResolvedReplicateOutput = {
  remoteUrl: string | null
  dataUrl: string | null
}

async function resolveReplicateOutput(output: any): Promise<ResolvedReplicateOutput> {
  let remoteUrl: string | null = null
  let dataUrl: string | null = null
  const visited = new Set<any>()

  const walk = async (value: any): Promise<void> => {
    if (value == null || (remoteUrl && dataUrl)) {
      return
    }

    if (typeof value === "string") {
      if (value.startsWith("data:")) {
        if (!dataUrl) dataUrl = value
      } else if (!remoteUrl) {
        remoteUrl = value
      }
      return
    }

    if (typeof value !== "object") {
      return
    }

    if (visited.has(value)) {
      return
    }
    visited.add(value)

    const maybeUrl = (value as any).url
    if (typeof maybeUrl === "function" && !remoteUrl) {
      try {
        const result = await maybeUrl.call(value)
        await walk(result)
      } catch (err) {
        console.warn("[headshotted] Failed to resolve url() from replicate output", err)
      }
    } else if (typeof maybeUrl === "string" && !remoteUrl) {
      remoteUrl = maybeUrl
    }

    if (typeof (value as any).arrayBuffer === "function" && !dataUrl) {
      try {
        const buffer = Buffer.from(await (value as any).arrayBuffer())
        const mimeType = (value as any).type || "image/png"
        dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`
      } catch (err) {
        console.warn("[headshotted] Failed to convert file-like replicate output", err)
      }
    }

    const candidateKeys = ["image", "images", "output", "result", "data", "file", "files"]
    for (const key of candidateKeys) {
      if (key in (value as Record<string, unknown>)) {
        await walk((value as Record<string, unknown>)[key])
        if (remoteUrl && dataUrl) return
      }
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        await walk(item)
        if (remoteUrl && dataUrl) return
      }
    } else {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (candidateKeys.includes(key)) continue
        await walk((value as Record<string, unknown>)[key])
        if (remoteUrl && dataUrl) return
      }
    }
  }

  await walk(output)

  if (!dataUrl && remoteUrl) {
    try {
      const response = await fetch(remoteUrl)
      if (response.ok) {
        dataUrl = await toDataUrlFromResponse(response)
      } else {
        console.warn("[headshotted] Failed to fetch replicate asset", response.status, response.statusText)
      }
    } catch (err) {
      console.warn("[headshotted] Error fetching replicate asset", err)
    }
  }

  if (!remoteUrl && dataUrl && dataUrl.startsWith("data:")) {
    remoteUrl = dataUrl
  }

  return { remoteUrl, dataUrl }
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
      (formData.get("image") as File | null) || (formData.get("image_0") as File | null) || (formData.get("file") as File | null)

    if (!file) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 })
    }

    const gender = sanitizeString(formData.get("gender") as string | null)
    const aspectRatio = sanitizeString(formData.get("aspect_ratio") as string | null)
    const stylePrompt = sanitizeString(formData.get("style_prompt") as string | null)

    const supabase = getSupabaseAdmin()

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("credits")
      .eq("email", userEmail)
      .single()

    if (userError || !userData) {
      console.error("[headshotted] User lookup failed", userError)
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
      console.error("[headshotted] Failed to deduct credits", creditError)
      return NextResponse.json({ error: "Failed to deduct credits" }, { status: 500 })
    }

    try {
      const input: Record<string, any> = {
        input_image: file,
      }

      if (gender) input.gender = gender
      if (aspectRatio) input.aspect_ratio = aspectRatio
      if (stylePrompt) input.style_prompt = stylePrompt

      let output: any
      try {
        output = await replicateClient.run("flux-kontext-apps/professional-headshot", {
          input,
        })
      } catch (runError) {
        if (stylePrompt) {
          console.warn("[headshotted] Initial run failed with style prompt, retrying without style", runError)
          delete input.style_prompt
          output = await replicateClient.run("flux-kontext-apps/professional-headshot", {
            input,
          })
        } else {
          throw runError
        }
      }

      const headshotAssets = await resolveReplicateOutput(output)

      let finalDataUrl = headshotAssets.dataUrl

      if (headshotAssets.remoteUrl && !headshotAssets.remoteUrl.startsWith("data:")) {
        try {
          const upscaleInput = {
            image: headshotAssets.remoteUrl,
            desired_increase: HEADSHOT_UPSCALE_INCREASE,
          }

          const upscaledOutput = await replicateClient.run(UPSCALE_MODEL_ID, {
            input: upscaleInput,
          })

          const upscaledAssets = await resolveReplicateOutput(upscaledOutput)

          if (upscaledAssets.dataUrl) {
            finalDataUrl = upscaledAssets.dataUrl
          } else {
            console.warn("[headshotted] Upscaled output did not include image data")
          }
        } catch (upscaleError) {
          console.warn("[headshotted] Upscaling failed, returning original headshot", upscaleError)
        }
      } else if (headshotAssets.remoteUrl) {
        console.warn("[headshotted] Skipping upscaling due to data URL output")
      } else {
        console.warn("[headshotted] Skipping upscaling: could not resolve remote URL from headshot output")
      }

      if (!finalDataUrl) {
        finalDataUrl = headshotAssets.dataUrl
      }

      if (!finalDataUrl) {
        throw new Error("No headshot generated")
      }

      return NextResponse.json({
        headshotUrl: finalDataUrl,
        remainingCredits: newBalance,
        creditsUsed: creditCost,
      })
    } catch (generationError) {
      console.error("[headshotted] Generation error", generationError)
      // Refund credits on failure
      try {
        await supabase.from("users").update({ credits: currentCredits }).eq("email", userEmail)
      } catch (refundError) {
        console.error("[headshotted] Credit refund failed", refundError)
      }
      return NextResponse.json({ error: "Failed to generate headshot" }, { status: 500 })
    }
  } catch (error) {
    console.error("[headshotted] Unexpected error", error)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}
