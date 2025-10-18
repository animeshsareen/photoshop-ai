import { NextRequest, NextResponse } from "next/server"
import Replicate from "replicate"

import { auth } from "@/lib/auth"
import { CREDIT_COST_PER_EDIT } from "@/lib/credits"
import { getSupabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

const replicateToken = process.env.REPLICATE_API_TOKEN

if (!replicateToken) {
  console.error("[ghiblify] Missing REPLICATE_API_TOKEN environment variable")
}

const replicateClient = replicateToken ? new Replicate({ auth: replicateToken }) : null

const MODEL_ID = "danila013/ghibli-easycontrol:6c4785d791d08ec65ff2ca5e9a7a0c2b0ac4e07ffadfb367231aa16bc7a52cbb"
const UPSCALE_MODEL_ID = "bria/increase-resolution"

type ResolvedReplicateOutput = {
  remoteUrl: string | null
  dataUrl: string | null
}

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
        console.warn("[ghiblify] Failed to resolve url() from replicate output", err)
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
        console.warn("[ghiblify] Failed to convert file-like replicate output", err)
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
        console.warn("[ghiblify] Failed to fetch replicate asset", response.status, response.statusText)
      }
    } catch (err) {
      console.warn("[ghiblify] Error fetching replicate asset", err)
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
      (formData.get("image") as File | null) ||
      (formData.get("image_0") as File | null) ||
      (formData.get("file") as File | null)

    if (!file) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 })
    }

    const prompt =
      sanitizeString(formData.get("prompt") as string | null) ||
      "Studio Ghibli inspired portrait, vibrant colors, whimsical atmosphere, whimsical background, painterly texture"
    const desiredIncreaseRaw = sanitizeString(formData.get("desired_increase") as string | null)
    const desiredIncrease = (() => {
      if (!desiredIncreaseRaw) return 2
      const parsed = Number.parseInt(desiredIncreaseRaw, 10)
      return [2, 3, 4].includes(parsed) ? parsed : 2
    })()

    const supabase = getSupabaseAdmin()

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("credits")
      .eq("email", userEmail)
      .single()

    if (userError || !userData) {
      console.error("[ghiblify] User lookup failed", userError)
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
      console.error("[ghiblify] Failed to deduct credits", creditError)
      return NextResponse.json({ error: "Failed to deduct credits" }, { status: 500 })
    }

    try {
      const replicateInput: Record<string, unknown> = {
        input_image: file,
        prompt,
      }

      const output: unknown = await replicateClient.run(MODEL_ID, { input: replicateInput })
      const stylizedAssets = await resolveReplicateOutput(output)

      let finalDataUrl = stylizedAssets.dataUrl
      let usedUpscaling = false

      if (stylizedAssets.remoteUrl && !stylizedAssets.remoteUrl.startsWith("data:")) {
        try {
          const upscaleInput = {
            image: stylizedAssets.remoteUrl,
            desired_increase: desiredIncrease,
          }

          const upscaledOutput = await replicateClient.run(UPSCALE_MODEL_ID, {
            input: upscaleInput,
          })

          const upscaledAssets = await resolveReplicateOutput(upscaledOutput)

          if (upscaledAssets.dataUrl) {
            finalDataUrl = upscaledAssets.dataUrl
            usedUpscaling = true
          } else {
            console.warn("[ghiblify] Upscaled output did not include image data")
          }
        } catch (upscaleError) {
          console.warn("[ghiblify] Upscaling failed, returning original stylized image", upscaleError)
        }
      } else if (stylizedAssets.remoteUrl) {
        console.warn("[ghiblify] Skipping upscaling due to data URL output")
      } else {
        console.warn("[ghiblify] Skipping upscaling: could not resolve remote URL from stylized output")
      }

      if (!finalDataUrl) {
        finalDataUrl = stylizedAssets.dataUrl
      }

      if (!finalDataUrl) {
        throw new Error("No stylized image generated")
      }

      return NextResponse.json({
        ghibliUrl: finalDataUrl,
        remainingCredits: newBalance,
        creditsUsed: creditCost,
        appliedUpscaling: usedUpscaling,
        settings: {
          prompt,
          desiredIncrease,
        },
      })
    } catch (generationError) {
      console.error("[ghiblify] Generation error", generationError)
      try {
        await supabase.from("users").update({ credits: currentCredits }).eq("email", userEmail)
      } catch (refundError) {
        console.error("[ghiblify] Credit refund failed", refundError)
      }
      return NextResponse.json({ error: "Failed to stylize image" }, { status: 500 })
    }
  } catch (error) {
    console.error("[ghiblify] Unexpected error", error)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}
