import { type NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { GoogleGenerativeAI } from "@google/generative-ai"
import Replicate from "replicate"
import { getSupabaseAdmin } from "@/lib/supabase"
import { DEFAULT_FREE_CREDITS } from "@/lib/credits"
import * as path from "path"
import * as fs from "fs"
import sharp from "sharp"

export const runtime = "nodejs"

if (!process.env.GEMINI_API_KEY) {
  console.error("[v0] GEMINI_API_KEY environment variable is not set")
}

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null

const replicateToken = process.env.REPLICATE_API_TOKEN

if (!replicateToken) {
  console.error("[open-edit] Missing REPLICATE_API_TOKEN environment variable")
}

const replicateClient = replicateToken ? new Replicate({ auth: replicateToken }) : null

const FLUX_KONTEXT_MODEL_ID = "black-forest-labs/flux-kontext-pro"

type ResolvedReplicateOutput = {
  remoteUrl: string | null
  dataUrl: string | null
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
        console.warn("[open-edit] Failed to resolve url() from replicate output", err)
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
        console.warn("[open-edit] Failed to convert file-like replicate output", err)
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
        console.warn("[open-edit] Failed to fetch replicate asset", response.status, response.statusText)
      }
    } catch (err) {
      console.warn("[open-edit] Error fetching replicate asset", err)
    }
  }

  if (!remoteUrl && dataUrl && dataUrl.startsWith("data:")) {
    remoteUrl = dataUrl
  }

  return { remoteUrl, dataUrl }
}

// Server-side image compression function
async function compressImage(inputPath: string, outputPath: string, maxWidth = 800, quality = 70) {
  await sharp(inputPath)
    .resize({ width: maxWidth })
    .jpeg({ quality })
    .toFile(outputPath);
  
  return outputPath;
}

// Detect if the request likely originates from a mobile device
function isMobileRequest(request: NextRequest): boolean {
  try {
    const ua = request.headers.get("user-agent") || ""
    const chMobile = request.headers.get("sec-ch-ua-mobile") // ?1 on mobile chromium
    const qpMobile = request.nextUrl?.searchParams?.get("mobile")
    if (qpMobile === "1" || qpMobile === "true") return true
    if (chMobile === "?1") return true
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
  } catch {
    return false
  }
}

// Recompress generated image for mobile: cap width and convert to WebP
async function recompressForMobile(base64Png: string) {
  const inputBuffer = Buffer.from(base64Png, "base64")
  const outputBuffer = await sharp(inputBuffer)
    .rotate()
    .resize({ width: 1080, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer()
  return { base64: outputBuffer.toString("base64"), mime: "image/webp" as const }
}

export async function POST(request: NextRequest) {
  try {
    console.log("[v0] API route called")

    // Note: We only require Gemini for TryOn; OpenEdit now uses Replicate

  const formData = await request.formData()
    const userPrompt = (formData.get("prompt") as string | null)?.trim() || ""
    // Mode flags: try-on (implicit via you_image+clothing_image), declutter (explicit flag)
    const modeRaw = ((formData.get("mode") as string | null) || (formData.get("feature") as string | null) || "").toLowerCase()
    const declutterFlag = ((formData.get("declutter") as string | null) || "").toLowerCase()
    const isDeClutterRequested = ["declutter", "de-clutter", "de_clutter"].includes(modeRaw) || declutterFlag === "1" || declutterFlag === "true"
    // Optional sub-section selection data
    const maskDataUrl = formData.get('mask') as string | null
    const shapesJson = formData.get('shapes') as string | null
    let shapesMeta: any = null
    if (shapesJson) {
      try { shapesMeta = JSON.parse(shapesJson) } catch { shapesMeta = null }
    }

    // Support new virtual try-on fields plus legacy multi-image fields
    const images: File[] = []

    const youImage = formData.get('you_image') as File | null
    const clothingImage = formData.get('clothing_image') as File | null
    if (youImage) images.push(youImage)
    if (clothingImage) images.push(clothingImage)

    if (images.length === 0) {
      // Fallback to legacy numbered fields if new fields absent
      let index = 0
      while (true) {
        const image = formData.get(`image_${index}`) as File
        if (!image) break
        images.push(image)
        index++
      }
    }

    if (images.length === 0) {
      console.log("[v0] Missing images")
      return NextResponse.json({ error: "At least one image is required" }, { status: 400 })
    }

    // Server-side credit enforcement: require authenticated user and deduct upfront
    // `auth()` is implemented via NextAuth and syncs users to Supabase on sign-in.
    const { auth } = await import("@/lib/auth")
    const session = await auth()
    const userEmail = session?.user?.email as string | undefined
    if (!userEmail) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }
    const h = await headers()
    const xf = h.get("x-forwarded-for") || ""
    const ip = xf ? xf.split(",")[0]?.trim() || null : h.get("x-real-ip") || null

    // Resolve absolute base URL for internal server fetches
    const getBaseUrl = () => {
      const envUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").trim()
      if (envUrl) return envUrl.replace(/\/$/, "")
      try { return request.nextUrl.origin } catch { /* no-op */ }
      const host = request.headers.get("host") || "localhost:3000"
      const proto = request.headers.get("x-forwarded-proto") || "http"
      return `${proto}://${host}`
    }
    const idempotencyKey = `edit:${userEmail}:${Date.now()}:${Math.random().toString(36).slice(2)}`

    // Helper: modify user credits using Supabase service role, idempotent via user_credit_ledger
    async function modifyUserCredits(email: string, delta: number, reason?: string, idemp?: string) {
      const supabase = getSupabaseAdmin()
      // Idempotency check
      if (idemp) {
        const { data: existing, error: ledErr } = await supabase
          .from("user_credit_ledger")
          .select("id, delta")
          .eq("user_email", email)
          .eq("idempotency_key", idemp)
          .maybeSingle()
        if (ledErr) throw ledErr
        if (existing) {
          const { data: bal } = await supabase.from("users").select("credits").eq("email", email).single()
          return { idempotent: true, credits: bal?.credits ?? 0 }
        }
      }

      const { data: cur, error: curErr } = await supabase
        .from("users")
        .select("credits")
        .eq("email", email)
        .single()
      if (curErr) throw curErr
      const newBalance = (cur.credits || 0) + delta
      if (newBalance < 0) return { error: "Insufficient credits", status: 402 }
      const { error: updErr } = await supabase.from("users").update({ credits: newBalance }).eq("email", email)
      if (updErr) throw updErr
      const { error: ledUserErr } = await supabase.from("user_credit_ledger").insert({
        user_email: email,
        ip_address: ip,
        delta,
        reason: reason || null,
        idempotency_key: idemp || null,
      })
      if (ledUserErr) console.warn("[credits] user ledger insert failed", ledUserErr)
      return { credits: newBalance }
    }

    // Deduct 1 credit idempotently
    const deductResult = await modifyUserCredits(userEmail, -1, "edit-image", idempotencyKey)
    if ((deductResult as any).error) {
      if ((deductResult as any).status === 402) return NextResponse.json({ error: "Insufficient credits" }, { status: 402 })
      return NextResponse.json({ error: "Failed to deduct credits" }, { status: 500 })
    }

    const MAX_IMAGE_SIZE = 4 * 1024 * 1024 // 4MB per image
    const MAX_TOTAL_SIZE = 10 * 1024 * 1024 // 10MB total
    let totalSize = 0

    // Compress images that are too large
    const compressedImages: File[] = []
    for (const image of images) {
      console.log(`[v0] Image ${image.name}: ${(image.size / 1024 / 1024).toFixed(2)}MB`)
      
      // Compress image if it exceeds the size limit
      if (image.size > MAX_IMAGE_SIZE) {
        console.log(`[v0] Compressing oversized image: ${image.name}`)
        
        try {
          // Create temporary files for compression
          const tempDir = "/tmp"
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true })
          }
          
          const parsedIn = path.parse(image.name || "image")
          const inputPath = path.join(tempDir, `input-${Date.now()}-${parsedIn.name}${parsedIn.ext || ""}`)
          const outputPath = path.join(tempDir, `compressed-${Date.now()}-${parsedIn.name}.jpg`)
          
          // Write the original file to disk
          const arrayBuffer = await image.arrayBuffer()
          fs.writeFileSync(inputPath, Buffer.from(arrayBuffer))
          
          // Compress the image
          await compressImage(inputPath, outputPath)
          
          // Read the compressed file
          const compressedBuffer = fs.readFileSync(outputPath)
          
          // Create a new File object with compressed data; ensure correct JPEG extension and MIME
          const jpegName = `${parsedIn.name || "image"}.jpg`
          const compressedFile = new File(
            [compressedBuffer], 
            jpegName, 
            { type: "image/jpeg" }
          )
          
          console.log(`[v0] Compressed ${image.name}: ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB (was ${(image.size / 1024 / 1024).toFixed(2)}MB)`)
          
          // Clean up temporary files
          fs.unlinkSync(inputPath)
          fs.unlinkSync(outputPath)
          
          compressedImages.push(compressedFile)
          totalSize += compressedFile.size
        } catch (compressError) {
          console.error("[v0] Error compressing image:", compressError)
          // If compression fails, use the original image
          compressedImages.push(image)
          totalSize += image.size
        }
      } else {
        compressedImages.push(image)
        totalSize += image.size
      }
    }

    // Check if total size still exceeds limit after compression
    if (totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json(
        {
          error: `Total image size is too large (${(totalSize / 1024 / 1024).toFixed(2)}MB). Maximum total size is ${(MAX_TOTAL_SIZE / 1024 / 1024).toFixed(1)}MB.`,
          suggestion: "Try uploading fewer images or compress them to reduce file sizes."
        },
        { status: 400 },
      )
    }

  console.log(`[v0] Processing ${compressedImages.length} image(s) with total size: ${(totalSize / 1024 / 1024).toFixed(2)}MB. User prompt length: ${userPrompt.length}. Mask? ${!!maskDataUrl}`)

    // Enforce DeClutter single-image constraint
    if (isDeClutterRequested && compressedImages.length !== 1) {
      return NextResponse.json(
        {
          error: "DeClutter requires exactly one image",
          suggestion: "Upload a single photo to clean background noise."
        },
        { status: 400 },
      )
    }

    const imageParts = await Promise.all(
      compressedImages.map(async (image) => {
        const imageBuffer = await image.arrayBuffer()
        const base64Image = Buffer.from(imageBuffer).toString("base64")
        console.log(`[v0] Converted image to base64, length: ${base64Image.length}`)
        return {
          inlineData: {
            data: base64Image,
            mimeType: image.type,
          },
        }
      }),
    )

    // Prepare Gemini model (used for TryOn and DeClutter)
    const model = genAI?.getGenerativeModel({
      model: "gemini-2.5-flash-image",
    })
    // (model availability check moved below after mode resolution)

    // TryMyClothes: dedicated virtual try-on system prompt
    const tryOnSystemPrompt = `You are a virtual fashion try-on assistant. You will always receive exactly two input images:
  1. PERSON photo (the model) – preserve identity, body shape, pose, lighting, and background.
  2. GARMENT photo – apply only this clothing item onto the person.

TASK: Generate a single photorealistic image of the PERSON wearing the GARMENT.

STRICT REQUIREMENTS:
  • Keep the person’s face, hair, skin, body proportions, hands, and background fully unchanged.
  • Fit the garment naturally to the person: correct size, drape, folds, perspective, and alignment with pose.
  • Reproduce fabric texture, material, color accuracy, logos, and patterns from the garment image with exact fidelity.
  • Ensure consistent lighting, shadows, and shading with the original photo.
  • Blend garment edges seamlessly, with no halos, artifacts, or distortions.
  • Do not add or alter anything else (no extra accessories, no different clothes, no text, no stylization).
  • If garment details (sleeves, neckline, length) are unclear, infer a subtle, plausible completion.
  • Deliver only the final edited image—no captions, alternatives, or other outputs.

GOAL: A single, best-quality, hyper-realistic try-on result indistinguishable from a real photo.`

  // DeClutter: single-image cleanup system prompt
  const declutterSystemPrompt = `You are a professional photo cleanup assistant.
INPUT: A single photo of a subject.
TASK: Remove people, items, artifacts from the picture's background while otherwise preserving the subject and the background with natural edges and realistic lighting. Maintain original colors and texture of the subject. Keep the overall look photorealistic—no stylization, text, or overlays. If a selection mask is provided, ONLY clean inside the white (selected) area; leave other pixels unchanged.

Deliver only the final edited image.`

    // Choose prompt based on mode: TryMyClothes (you_image + clothing_image) vs OpenEdit (default)
    const isTryOnMode = !!youImage && !!clothingImage
    const isDeClutterMode = !!isDeClutterRequested
    if ((isTryOnMode || isDeClutterMode) && !model) {
      console.error('[v0] Gemini model unavailable or GEMINI_API_KEY not set')
      return NextResponse.json({ error: 'GEMINI model not available or GEMINI_API_KEY not configured', suggestion: 'Ensure GEMINI_API_KEY and model permissions are correct, or try again with the Replicate provider.' }, { status: 502 })
    }
    let editPrompt: string
    if (isTryOnMode) {
      // Use strict virtual try-on prompt; ignore free-form user text for consistency
      editPrompt = tryOnSystemPrompt
    } else if (isDeClutterMode) {
      // DeClutter: background noise removal for a single image
      editPrompt = declutterSystemPrompt
      if (userPrompt) {
        editPrompt += `\n\nUSER ADDITIONAL INSTRUCTIONS ():\n${userPrompt}`
      }
      if (maskDataUrl) {
        editPrompt += `\n\nA selection mask was provided. ONLY clean inside the white (selected) area; keep all other pixels 100% identical to the original image.`
      }
    } else {
      // OpenEdit: build instruction prompt for Flux Kontext model
      const promptSegments: string[] = [
        "Transform the uploaded photo while preserving core subject identity and overall realism.",
      ]
      if (userPrompt) {
        promptSegments.push(userPrompt)
      } else {
        promptSegments.push("Apply tasteful stylistic enhancements suited to the requested edit.")
      }
      if (maskDataUrl) {
        promptSegments.push("Only modify the region indicated by the provided mask; keep all other pixels untouched.")
      }
      editPrompt = promptSegments.join(" ").trim()
    }

    console.log("[v0] Dispatching edit request to provider")

    // Execute request via provider based on mode
    let response: any = null
    let generatedImageData: string | null = null
    let finalMime: string = "image/png"

    try {
      if (isTryOnMode || isDeClutterMode) {
        if (!genAI || !model) {
          return NextResponse.json({ error: "GEMINI_API_KEY environment variable is not configured" }, { status: 500 })
        }
        // Build Gemini inputs: TryOn -> both images; DeClutter -> only first image (+ optional mask image)
        const geminiInputs: any[] = [editPrompt]
        if (isTryOnMode) {
          geminiInputs.push(...imageParts)
        } else {
          geminiInputs.push(imageParts[0])
          if (maskDataUrl) {
            try {
              const maskHeader = maskDataUrl.split(",")[0] || "data:image/png;base64"
              const maskMime = (maskHeader.split(":")[1] || "image/png;base64").split(";")[0] || "image/png"
              const maskBase64 = maskDataUrl.split(",")[1]
              if (maskBase64) {
                geminiInputs.push({ inlineData: { data: maskBase64, mimeType: maskMime } })
              }
            } catch { /* ignore mask attachment errors */ }
          }
        }
        response = await model.generateContent(geminiInputs as any)
        console.log(`[$v0] Gemini API call successful (${isTryOnMode ? "try-on" : "declutter"})`)
      } else {
        if (!replicateClient) {
          // Refund the credit if Replicate isn't configured (idempotent)
          try {
            if (userEmail) await modifyUserCredits(userEmail, 1, "refund:edit-image", `${idempotencyKey}:refund`)
          } catch {}
          return NextResponse.json({ error: "Replicate client not configured" }, { status: 500 })
        }

        const primaryImage = compressedImages[0]
        if (!primaryImage) {
          throw new Error("No image available for OpenEdit processing")
        }

        if (compressedImages.length > 1) {
          console.warn("[v0] OpenEdit received multiple images; only the first will be used with Flux Kontext.")
        }

        const replicatePrompt = editPrompt || "Transform the uploaded photo while preserving core subject identity."
        const replicateInput: Record<string, unknown> = {
          prompt: replicatePrompt,
          input_image: primaryImage,
          output_format: "jpg",
        }

        console.log("[v0] Calling Replicate Flux Kontext Pro model for OpenEdit")
        const replicateOutput = await replicateClient.run(FLUX_KONTEXT_MODEL_ID, {
          input: replicateInput,
        })
        const assets = await resolveReplicateOutput(replicateOutput)
        const finalDataUrl = assets.dataUrl || assets.remoteUrl

        if (!finalDataUrl) {
          throw new Error("Replicate did not return an image")
        }

        if (finalDataUrl.startsWith("data:")) {
          const [header, data] = finalDataUrl.split(",")
          if (!data) throw new Error("Invalid data URL returned from Replicate")
          const mimeType = (header.split(";")[0] || "data:image/png").split(":")[1] || "image/png"
          generatedImageData = data
          finalMime = mimeType
        } else {
          const fetchResponse = await fetch(finalDataUrl)
          if (!fetchResponse.ok) {
            throw new Error(`Failed to fetch Replicate image (${fetchResponse.status})`)
          }
          const buffer = Buffer.from(await fetchResponse.arrayBuffer())
          finalMime = fetchResponse.headers.get("content-type") || "image/png"
          generatedImageData = buffer.toString("base64")
        }
      }
    } catch (apiError) {
      console.error("[v0] Provider API call failed:", apiError)

      // Refund the credit on API failure (idempotent)
      try {
        if (userEmail) await modifyUserCredits(userEmail, 1, "refund:edit-image", `${idempotencyKey}:refund`)
      } catch {}

      if (apiError instanceof Error) {
        console.log("[v0] Error message:", apiError.message)

        if (apiError.message.includes("API key") || apiError.message.includes("apikey")) {
          return NextResponse.json({ 
            error: "Invalid or missing API key",
            suggestion: "Please check your API configuration for the selected provider."
          }, { status: 401 })
        }
        if (apiError.message.includes("quota") || apiError.message.includes("limit") || apiError.message.includes("Rate limit")) {
          return NextResponse.json({ 
            error: "API quota or rate limit exceeded.",
            suggestion: "Please try again later."
          }, { status: 429 })
        }
        if (apiError.message.includes("model")) {
            console.error('[v0] Provider model error details:', apiError)
            return NextResponse.json({ 
              error: "Model not available or incompatible with the request.",
              details: apiError.message,
              suggestion: "Try reducing image size or count, verify your GEMINI model name/availability and key permissions, or check provider status.",
            }, { status: 502 })
        }
        if (apiError.message.includes("size") || apiError.message.includes("large")) {
          return NextResponse.json(
            { 
              error: "Images too large for processing. Please reduce image size and try again.",
              suggestion: "Try compressing your images to under 4MB each before uploading."
            },
            { status: 400 },
          )
        }

        return NextResponse.json({ 
          error: `Image generation error: ${apiError.message}`,
          suggestion: "Please try again with different images or a different prompt."
        }, { status: 500 })
      }

      return NextResponse.json({ 
        error: "Unknown error occurred while calling the image provider",
        suggestion: "Please try again later."
      }, { status: 500 })
    }

    console.log("[v0] Received response from provider")

    const isGeminiMode = isTryOnMode || isDeClutterMode
    if (isGeminiMode && (!response || !response.response)) {
      console.log("[v0] No response object from Gemini API")
      try {
        if (userEmail) await modifyUserCredits(userEmail, 1, "refund:edit-image", `${idempotencyKey}:refund`)
      } catch {}
      return NextResponse.json({ 
        error: "No response received from Gemini API",
        suggestion: "Please try again with a different prompt or images."
      }, { status: 500 })
    }

    if (isGeminiMode && (!response.response.candidates || response.response.candidates.length === 0)) {
      console.log("[v0] No candidates in response:", JSON.stringify(response.response))
      try {
        await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || ""}/api/credits`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "add", amount: 1, reason: "refund:edit-image", idempotencyKey: `${idempotencyKey}:refund` }),
        })
      } catch {}

      // Check for blocked content
      if (response.response.promptFeedback?.blockReason) {
        return NextResponse.json(
          { 
            error: `Content blocked: ${response.response.promptFeedback.blockReason}`,
            suggestion: "Try rephrasing your prompt to avoid triggering content filters."
          },
          { status: 400 },
        )
      }

      return NextResponse.json({ 
        error: "No content candidates generated by Gemini API",
        suggestion: "Try a different prompt or check if your images are appropriate for AI processing."
      }, { status: 500 })
    }
    if (isGeminiMode) {
      const candidate = response.response.candidates[0]

      if (candidate.finishReason === "SAFETY") {
        return NextResponse.json({ 
          error: "Content was filtered due to safety concerns",
          suggestion: "Try a different prompt that doesn't involve potentially sensitive content."
        }, { status: 400 })
      }

      if (!candidate.content || !candidate.content.parts) {
        console.log("[v0] No content parts in response candidate")
        try {
          await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || ""}/api/credits`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "add", amount: 1, reason: "refund:edit-image", idempotencyKey: `${idempotencyKey}:refund` }),
          })
        } catch {}
        return NextResponse.json({ 
          error: "No content parts generated in response",
          suggestion: "Try a different prompt or check your image quality."
        }, { status: 500 })
      }

      for (const part of candidate.content.parts) {
        if ((part as any).inlineData) {
          generatedImageData = (part as any).inlineData.data
          break
        }
      }

      if (!generatedImageData) {
        console.log("[v0] No image generated in response")
        try {
          await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || ""}/api/credits`, {
            method: "POST",
            headers: { 
              "content-type": "application/json",
              cookie: request.headers.get("cookie") || ""
            },
            body: JSON.stringify({ action: "add", amount: 1, reason: "refund:edit-image", idempotencyKey: `${idempotencyKey}:refund` }),
          })
        } catch {}
        return NextResponse.json({ 
          error: "No image was generated",
          suggestion: "Try a different prompt or ensure your images are clear and well-defined."
        }, { status: 500 })
      }
    }

    console.log("[v0] Successfully generated single edited image from multiple inputs")

    // For mobile clients, downscale + convert to WebP to reduce payload
  const mobileClient = isMobileRequest(request)
  let finalImageBase64 = (generatedImageData || "") as string
    if (mobileClient && finalImageBase64) {
      try {
        const optimized = await recompressForMobile(finalImageBase64)
        finalImageBase64 = optimized.base64
        finalMime = optimized.mime
        console.log("[v0] Optimized output for mobile (WebP, max 1080w)")
      } catch (e) {
        console.warn("[v0] Mobile recompression failed, returning original PNG", e)
      }
    }

    // If mask provided, attempt naive merge (currently we just return the raw generated image; real blending could be implemented with sharp)
    // Persist mask + metadata temporarily (for future GET retrieval)
    if (maskDataUrl) {
      try {
        const tempDir = '/tmp/subsections';
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
        const ts = Date.now()
        const maskPath = path.join(tempDir, `mask-${ts}.png`)
        const metaPath = path.join(tempDir, `mask-${ts}.json`)
        const maskBase64 = maskDataUrl.split(',')[1]
        if (maskBase64) fs.writeFileSync(maskPath, Buffer.from(maskBase64, 'base64'))
        fs.writeFileSync(metaPath, JSON.stringify({ shapes: shapesMeta, createdAt: ts }))
      } catch (e) {
        console.warn('[v0] Failed to persist mask metadata', e)
      }
    }

    return NextResponse.json({
      editedImageUrl: `data:${finalMime};base64,${finalImageBase64}`,
      message: isTryOnMode
        ? `Single image successfully generated from ${compressedImages.length} input image(s) using Gemini`
        : isDeClutterMode
        ? `Background cleaned for ${compressedImages.length} image using Gemini`
        : `Single image successfully generated from ${compressedImages.length} input image(s) using Replicate Flux Kontext Pro`,
      usedMask: !!maskDataUrl,
      shapes: shapesMeta || undefined,
      mobileOptimized: mobileClient,
    })
  } catch (error) {
    console.error("[v0] Error processing image:", error)

    // Refund on unexpected server error (use authenticated user idempotent refund)
    try {
      const { auth } = await import("@/lib/auth")
      const session = await auth()
      const userEmail = session?.user?.email as string | undefined
      if (userEmail) {
        await fetch(`${(process.env.NEXT_PUBLIC_SITE_URL || "").trim() || request.nextUrl.origin}/api/credits`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: request.headers.get("cookie") || "" },
          body: JSON.stringify({ action: "add", amount: 1, reason: "refund:edit-image", idempotencyKey: `edit:${userEmail}:fallback-refund` }),
        })
      }
    } catch {}

    if (error instanceof Error) {
      console.error("[v0] Error details:", error.message)
      console.error("[v0] Error stack:", error.stack)

      // Handle specific error types
      if (error.message.includes("FormData")) {
        return NextResponse.json({ 
          error: "Invalid form data format",
          suggestion: "Please ensure you're uploading valid image files."
        }, { status: 400 })
      }

      if (error.message.includes("fetch")) {
        return NextResponse.json({ 
          error: "Network error occurred",
          suggestion: "Please check your internet connection and try again."
        }, { status: 503 })
      }

      return NextResponse.json({ 
        error: "Failed to process image", 
        details: error.message,
        suggestion: "Please try again with different images or contact support if the issue persists."
      }, { status: 500 })
    }

    return NextResponse.json({ 
      error: "Unknown error occurred while processing image",
      suggestion: "Please try again later or contact support."
    }, { status: 500 })
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
