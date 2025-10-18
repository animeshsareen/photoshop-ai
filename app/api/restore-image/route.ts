import { type NextRequest, NextResponse } from "next/server"
import Replicate from "replicate"
import { getSupabaseAdmin } from "@/lib/supabase"
import * as path from "path"
import * as fs from "fs"
import sharp from "sharp"

export const runtime = "nodejs"

const RESTORE_MODEL_ID = "flux-kontext-apps/restore-image"
const replicateToken = process.env.REPLICATE_API_TOKEN

if (!replicateToken) {
  console.error("[restore-image] Missing REPLICATE_API_TOKEN environment variable")
}

const replicateClient = replicateToken ? new Replicate({ auth: replicateToken }) : null

async function compressImage(inputPath: string, outputPath: string, maxWidth = 800, quality = 70) {
  await sharp(inputPath).resize({ width: maxWidth }).jpeg({ quality }).toFile(outputPath)
  return outputPath
}

function isMobileRequest(request: NextRequest): boolean {
  try {
    const ua = request.headers.get("user-agent") || ""
    const chMobile = request.headers.get("sec-ch-ua-mobile")
    const qpMobile = request.nextUrl?.searchParams?.get("mobile")
    if (qpMobile === "1" || qpMobile === "true") return true
    if (chMobile === "?1") return true
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
  } catch {
    return false
  }
}

async function recompressForMobile(base64Png: string) {
  const inputBuffer = Buffer.from(base64Png, "base64")
  const outputBuffer = await sharp(inputBuffer).rotate().resize({ width: 1080, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer()
  return { base64: outputBuffer.toString("base64"), mime: "image/webp" as const }
}

async function toDataUrlFromResponse(res: Response) {
  const arrayBuffer = await res.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const mimeType = res.headers.get("content-type") || "image/png"
  return `data:${mimeType};base64,${buffer.toString("base64")}`
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
    if (value == null || (remoteUrl && dataUrl)) return

    if (typeof value === "string") {
      if (value.startsWith("data:")) {
        if (!dataUrl) dataUrl = value
      } else if (!remoteUrl) {
        remoteUrl = value
      }
      return
    }

    if (typeof value !== "object") return
    if (visited.has(value)) return
    visited.add(value)

    const maybeUrl = (value as any).url
    if (typeof maybeUrl === "function" && !remoteUrl) {
      try {
        const result = await maybeUrl.call(value)
        await walk(result)
      } catch (error) {
        console.warn("[restore-image] Failed to resolve url() from replicate output", error)
      }
    } else if (typeof maybeUrl === "string" && !remoteUrl) {
      remoteUrl = maybeUrl
    }

    if (typeof (value as any).arrayBuffer === "function" && !dataUrl) {
      try {
        const buffer = Buffer.from(await (value as any).arrayBuffer())
        const mimeType = (value as any).type || "image/png"
        dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`
      } catch (error) {
        console.warn("[restore-image] Failed to convert file-like replicate output", error)
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
        console.warn("[restore-image] Failed to fetch replicate asset", response.status, response.statusText)
      }
    } catch (error) {
      console.warn("[restore-image] Error fetching replicate asset", error)
    }
  }

  if (!remoteUrl && dataUrl && dataUrl.startsWith("data:")) {
    remoteUrl = dataUrl
  }

  return { remoteUrl, dataUrl }
}

const RESTORATION_TYPE_DESCRIPTIONS: Record<string, string> = {
  general: "Standard restoration for typical old photos. Improve photorealism, clarity, and sharpness.",
  heavy_damage: "For severely damaged photos with tears, stains, or major defects. Repair damage and improve clarity.",
  color_enhancement: "Focus on restoring faded colors and improving overall color accuracy.",
  noise_reduction: "Remove grain, noise, and scanning artifacts while preserving detail.",
}

function buildRestorationPrompt(restorationType: string, userPrompt: string) {
  const typeKey = restorationType && RESTORATION_TYPE_DESCRIPTIONS[restorationType] ? restorationType : "general"
  const typeDescription = RESTORATION_TYPE_DESCRIPTIONS[typeKey]
  let prompt = `Restore this photo with the following requirements:\n• Restoration type: ${typeKey}\n• Details: ${typeDescription}`
  if (userPrompt) {
    prompt += `\n• Additional instructions: ${userPrompt}`
  }
  prompt += "\nDeliver a natural, high-quality restored image that preserves subject identity."
  return prompt
}

function extractDataUrlParts(dataUrl: string) {
  if (!dataUrl.startsWith("data:")) return null
  const [header, base64] = dataUrl.split(",", 2)
  if (!header || !base64) return null
  const match = /^data:(.*?);base64$/i.exec(header)
  const mimeType = match?.[1] || "image/png"
  return { mimeType, base64 }
}

export async function POST(request: NextRequest) {
  const client = replicateClient
  if (!client) {
    return NextResponse.json({ error: "Replicate client not configured" }, { status: 500 })
  }

  const supabase = getSupabaseAdmin()
  let userEmail: string | null = null
  let currentCredits = 0
  let creditsDeducted = false
  let newBalance = 0

  try {
    console.log("[restore-image] API route called")

    const formData = await request.formData()
    const userPrompt = (formData.get("prompt") as string | null)?.trim() || ""
    const restorationType = (formData.get("restorationType") as string | null)?.trim() || "general"

    const images: File[] = []
    let index = 0
    while (true) {
      const image = formData.get(`image_${index}`) as File
      if (!image) break
      images.push(image)
      index++
    }

    if (images.length === 0) {
      console.log("[restore-image] Missing images")
      return NextResponse.json({ error: "At least one image is required" }, { status: 400 })
    }

    const { auth } = await import("@/lib/auth")
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    userEmail = session.user.email

    const { data: userData, error: userError } = await supabase.from("users").select("credits").eq("email", userEmail).single()

    if (userError || !userData) {
      console.error("[restore-image] User lookup failed:", userError)
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    currentCredits = userData.credits || 0
    const creditCost = 1

    if (currentCredits < creditCost) {
      return NextResponse.json({ error: "Insufficient credits" }, { status: 402 })
    }

    newBalance = currentCredits - creditCost
    const { error: creditError } = await supabase.from("users").update({ credits: newBalance }).eq("email", userEmail)

    if (creditError) {
      console.error("[restore-image] Credit deduction failed:", creditError)
      return NextResponse.json({ error: "Failed to deduct credits" }, { status: 500 })
    }
    creditsDeducted = true

    const compressedImages: File[] = []
    const MAX_TOTAL_SIZE = 50 * 1024 * 1024
    let totalSize = 0

    console.log("[restore-image] Starting image processing for", images.length, "images")

    const tempDir = "/tmp"
    if (!fs.existsSync(tempDir)) {
      console.log("[restore-image] Creating temp directory:", tempDir)
      fs.mkdirSync(tempDir, { recursive: true })
    }

    for (let i = 0; i < images.length; i++) {
      const image = images[i]
      console.log(`[restore-image] Processing image ${i + 1}/${images.length}: ${image.name} (${(image.size / 1024 / 1024).toFixed(2)}MB)`)

      if (image.size > 1024 * 1024) {
        console.log(`[restore-image] Image ${i + 1} is larger than 1MB, compressing...`)
        try {
          const parsedIn = path.parse(image.name || "image")
          const inputPath = path.join(tempDir, `input-${Date.now()}-${parsedIn.name}${parsedIn.ext || ""}`)
          const outputPath = path.join(tempDir, `compressed-${Date.now()}-${parsedIn.name}.jpg`)

          console.log(`[restore-image] Writing image ${i + 1} to temp file:`, inputPath)
          const arrayBuffer = await image.arrayBuffer()
          fs.writeFileSync(inputPath, Buffer.from(arrayBuffer))

          console.log(`[restore-image] Compressing image ${i + 1}...`)
          await compressImage(inputPath, outputPath)

          console.log(`[restore-image] Reading compressed image ${i + 1}...`)
          const compressedBuffer = fs.readFileSync(outputPath)

          const jpegName = `${parsedIn.name || "image"}.jpg`
          const compressedFile = new File([compressedBuffer], jpegName, { type: "image/jpeg" })

          console.log(`[restore-image] Compressed ${image.name}: ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB (was ${(image.size / 1024 / 1024).toFixed(2)}MB)`)

          console.log(`[restore-image] Cleaning up temp files for image ${i + 1}`)
          fs.unlinkSync(inputPath)
          fs.unlinkSync(outputPath)

          compressedImages.push(compressedFile)
          totalSize += compressedFile.size
        } catch (compressError) {
          console.error(`[restore-image] Error compressing image ${i + 1} (${image.name}):`, compressError)
          console.error("[restore-image] Compression error details:", {
            name: compressError instanceof Error ? compressError.name : "Unknown",
            message: compressError instanceof Error ? compressError.message : String(compressError),
            stack: compressError instanceof Error ? compressError.stack : undefined,
          })
          console.log(`[restore-image] Using original image ${i + 1} due to compression failure`)
          compressedImages.push(image)
          totalSize += image.size
        }
      } else {
        console.log(`[restore-image] Image ${i + 1} is small enough, using original`)
        compressedImages.push(image)
        totalSize += image.size
      }
    }

    if (totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json(
        {
          error: `Total image size is too large (${(totalSize / 1024 / 1024).toFixed(2)}MB). Maximum total size is ${(MAX_TOTAL_SIZE / 1024 / 1024).toFixed(1)}MB.`,
          suggestion: "Try uploading fewer images or compress them to reduce file sizes.",
        },
        { status: 400 },
      )
    }

    console.log(`[restore-image] Processing ${compressedImages.length} image(s) with total size: ${(totalSize / 1024 / 1024).toFixed(2)}MB`)

    const primaryImage = compressedImages[0]
    if (!primaryImage) {
      throw new Error("No image available after processing")
    }

    if (compressedImages.length > 1) {
      console.warn("[restore-image] Multiple images received. Only the first image will be sent to the restore model.")
    }

    const replicateInput: Record<string, any> = {
      input_image: primaryImage,
    }

    if (userPrompt || restorationType) {
      replicateInput.prompt = buildRestorationPrompt(restorationType, userPrompt)
    }

    let output: any
    let finalUrl: string | null = null
    let finalMime = "image/png"

    try {
      try {
        console.log("[restore-image] Calling Replicate restore-image model")
        output = await client.run(RESTORE_MODEL_ID, {
          input: replicateInput,
        })
      } catch (initialError) {
        if (replicateInput.prompt) {
          console.warn("[restore-image] Initial Replicate call failed with custom prompt, retrying without prompt", initialError)
          delete replicateInput.prompt
          output = await client.run(RESTORE_MODEL_ID, {
            input: replicateInput,
          })
        } else {
          throw initialError
        }
      }

      const assets = await resolveReplicateOutput(output)
      finalUrl = assets.dataUrl || assets.remoteUrl

      if (!finalUrl) {
        throw new Error("No restored image generated")
      }

      const isMobile = isMobileRequest(request)

      if (finalUrl.startsWith("data:")) {
        const parsed = extractDataUrlParts(finalUrl)
        if (parsed) {
          finalMime = parsed.mimeType
          if (isMobile && parsed.mimeType === "image/png") {
            console.log("[restore-image] Applying mobile optimization to PNG image")
            try {
              const mobileResult = await recompressForMobile(parsed.base64)
              finalMime = mobileResult.mime
              finalUrl = `data:${mobileResult.mime};base64,${mobileResult.base64}`
              console.log("[restore-image] Mobile optimization successful")
            } catch (error) {
              console.warn("[restore-image] Mobile optimization failed, using original image", error)
            }
          }
        }
      } else {
        console.log("[restore-image] Final output is a remote URL; skipping mobile optimization")
      }
    } catch (generationError) {
      console.error("[restore-image] Failed during replication/generation stage", generationError)
      if (creditsDeducted && userEmail) {
        try {
          await supabase.from("users").update({ credits: currentCredits }).eq("email", userEmail)
          creditsDeducted = false
        } catch (refundError) {
          console.error("[restore-image] Credit refund failed after generation error", refundError)
        }
      }
      return NextResponse.json({ error: "Failed to restore image" }, { status: 500 })
    }

    console.log("[restore-image] Successfully restored image")

    if (!finalUrl) {
      return NextResponse.json({ error: "Failed to restore image" }, { status: 500 })
    }

    return NextResponse.json({
      restoredImageUrl: finalUrl,
      mimeType: finalMime,
      creditsUsed: creditCost,
      remainingCredits: newBalance,
    })
  } catch (error) {
    console.error("[restore-image] Unexpected error in main handler:", error)
    console.error("[restore-image] Error details:", {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    if (creditsDeducted && userEmail) {
      try {
        await supabase.from("users").update({ credits: currentCredits }).eq("email", userEmail)
      } catch (refundError) {
        console.error("[restore-image] Failed to refund credits after unexpected error:", refundError)
      }
    }

    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
