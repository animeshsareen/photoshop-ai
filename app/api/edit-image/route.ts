import { type NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { GoogleGenerativeAI } from "@google/generative-ai"
import OpenAI from "openai"
import { toFile } from "openai/uploads"
import * as path from "path"
import * as fs from "fs"
import sharp from "sharp"

export const runtime = "nodejs"

if (!process.env.GEMINI_API_KEY) {
  console.error("[v0] GEMINI_API_KEY environment variable is not set")
}

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

// Server-side image compression function
async function compressImage(inputPath: string, outputPath: string, maxWidth = 800, quality = 70) {
  await sharp(inputPath)
    .resize({ width: maxWidth })
    .jpeg({ quality })
    .toFile(outputPath);
  
  return outputPath;
}

// OpenAI Images API accepts only JPEG, PNG, WEBP
const SUPPORTED_OPENAI_MIME = new Set(["image/jpeg", "image/png", "image/webp"])

// Ensure buffer + filename + mime are acceptable to OpenAI; convert if needed
async function ensureSupportedImage(buffer: Buffer, originalMime?: string | null, originalName?: string | null) {
  const inMime = (originalMime || "").toLowerCase()
  let outBuf = buffer
  let outMime = inMime
  let outName = originalName || "image.png"
  if (!SUPPORTED_OPENAI_MIME.has(inMime)) {
    // Convert unknown or unsupported format (e.g., HEIC, octet-stream) to PNG
    outBuf = await sharp(buffer).toFormat("png").toBuffer()
    outMime = "image/png"
    const parsed = path.parse(outName)
    outName = `${parsed.name || "image"}.png`
  }
  return { buffer: outBuf, mime: outMime, name: outName }
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

    // Note: We only require Gemini for TryOn; OpenEdit can use OpenAI

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

    // Server-side credit enforcement: deduct upfront, refund on failure
    const cookieId = request.cookies.get("device_id")?.value
    if (!cookieId) {
      return NextResponse.json({ error: "Missing device cookie" }, { status: 400 })
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
    const creditsUrl = `${getBaseUrl()}/api/credits`
    const forwardCookie = request.headers.get("cookie") || ""

    const idempotencyKey = `edit:${cookieId}:${Date.now()}:${Math.random().toString(36).slice(2)}`
    const creditsResp = await fetch(creditsUrl, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: forwardCookie },
      body: JSON.stringify({ action: "deduct", amount: 1, reason: "edit-image", idempotencyKey }),
    })
    if (!creditsResp.ok) {
      const payload = await creditsResp.json().catch(() => ({} as any))
      const status = creditsResp.status
      if (status === 402) {
        return NextResponse.json({ error: "Insufficient credits" }, { status: 402 })
      }
      return NextResponse.json({ error: payload?.error || "Failed to deduct credits" }, { status: 500 })
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

    // Prepare Gemini model (used for TryOn only)
    const model = genAI?.getGenerativeModel({
      model: "gemini-2.5-flash-image-preview",
    })

  const baseSystemPrompt = `You are an advanced image editing and generation system.  
The user can upload multiple reference images, and you have just read their text prompt describing desired edits. There may optionally be drawings or shapes on top of the images to highlight areas for modification.  

Your task:  
1. Analyze all uploaded reference images together as context.  
2. Interpret the user’s prompt carefully, ensuring that the requested edits are applied to the correct regions and in a realistic, cohesive way.  
3. If the user has provided drawings or shapes, treat them as visual instructions that indicate where and how to apply changes.  
4. Always generate a single, unified output image that incorporates the user’s edits while preserving the overall quality and integrity of the original references.  

Output only the final edited image—do not include extra text, overlays, or intermediate steps.`

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
TASK: Remove background noise, clutter, distractions, reflections, and artifacts while preserving the subject with natural edges and realistic lighting. Maintain original colors and texture of the subject. Keep the overall look photorealistic—no stylization, text, or overlays. If a selection mask is provided, ONLY clean inside the white (selected) area; leave other pixels unchanged.

Deliver only the final edited image.`

    // Choose prompt based on mode: TryMyClothes (you_image + clothing_image) vs OpenEdit (default)
    const isTryOnMode = !!youImage && !!clothingImage
    const isDeClutterMode = !!isDeClutterRequested
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
      // OpenEdit: use base prompt and optional user instructions
      editPrompt = userPrompt ? `${baseSystemPrompt}\n\nUSER ADDITIONAL INSTRUCTIONS ():\n${userPrompt}` : baseSystemPrompt
      if (maskDataUrl) {
        editPrompt += `\n\nA selection mask was provided. ONLY apply changes inside the white (selected) area of the mask; keep all other pixels 100% identical to the original person image.`
      }
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
        console.log(`[$v0] Gemini API call successful (${isTryOnMode ? 'try-on' : 'declutter'})`)
      } else {
        if (!openai) {
          // Refund the credit if OpenAI isn't configured
          try {
            await fetch(creditsUrl, {
              method: "POST",
              headers: { "content-type": "application/json", cookie: forwardCookie },
              body: JSON.stringify({ action: "add", amount: 1, reason: "refund:edit-image", idempotencyKey: `${idempotencyKey}:refund` }),
            })
          } catch {}
          return NextResponse.json({ error: "OPENAI_API_KEY environment variable is not configured" }, { status: 500 })
        }

  // Prepare base image and dimensions
  const baseImage = compressedImages[0]
  const baseBuffer = Buffer.from(await baseImage.arrayBuffer())
  const baseMeta = await sharp(baseBuffer).metadata()
  const width = baseMeta.width || 1024
  const height = baseMeta.height || 1024

        // Build OpenAI inputs
        let maskFile: File | undefined
        if (maskDataUrl) {
          try {
            const maskBase64 = maskDataUrl.split(",")[1]
            const maskBuffer = Buffer.from(maskBase64, "base64")
            // Create transparent PNG mask for OpenAI edits: transparent (0 alpha) where edits ALLOWED
            // Our mask has white for selected area -> convert white to alpha=0, others alpha=255
            const alphaRaw = await sharp(maskBuffer)
              .resize({ width, height })
              .greyscale()
              .threshold(200)
              .negate()
              .raw()
              .toBuffer({ resolveWithObject: true })
            const baseWhite = sharp({
              create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
            })
            const maskPng = await baseWhite
              .joinChannel(alphaRaw.data, { raw: { width, height, channels: 1 } })
              .png()
              .toBuffer()

            // Use toFile to build InputFile
            const inputMask = await toFile(maskPng, "mask.png", { type: "image/png" })
            // Type hack: toFile returns a compatible InputFile; SDK accepts it directly
            ;(maskFile as any) = inputMask as any
          } catch (e) {
            console.warn("[v0] Failed to build OpenAI mask; proceeding without mask", e)
          }
        }

  // Build OpenAI input files; support multiple images per docs when no mask is present
  const normalizedBase = await ensureSupportedImage(baseBuffer, (baseImage as any).type, baseImage.name)
  const inputImage = await toFile(normalizedBase.buffer, normalizedBase.name || "image.png", { type: normalizedBase.mime as any })
        const additionalImages: any[] = []
        if (!maskDataUrl && compressedImages.length > 1) {
          for (let i = 1; i < compressedImages.length; i++) {
            const f = compressedImages[i]
            const buf = Buffer.from(await f.arrayBuffer())
            const normalized = await ensureSupportedImage(buf, (f as any).type, f.name)
            const fileObj = await toFile(normalized.buffer, normalized.name || `image_${i}.png`, { type: normalized.mime as any })
            additionalImages.push(fileObj as any)
          }
        }

        let aiResult
        if (maskFile) {
          aiResult = await openai.images.edit({
            model: "gpt-image-1",
            image: inputImage as any,
            mask: maskFile as any,
            prompt: userPrompt || "Apply the requested edits only within the mask",
            size: "1024x1024",
          })
        } else {
          const imagesParam = additionalImages.length ? ([inputImage as any, ...additionalImages] as any) : (inputImage as any)
          aiResult = await openai.images.edit({
            model: "gpt-image-1",
            image: imagesParam,
            prompt: userPrompt || "Apply the requested edits",
            size: "1024x1024",
          })
        }

        if (!aiResult || !aiResult.data || !aiResult.data.length || !aiResult.data[0].b64_json) {
          throw new Error("OpenAI did not return an image")
        }

        generatedImageData = aiResult.data[0].b64_json as string
        finalMime = "image/png"
      }
    } catch (apiError) {
      console.error("[v0] Provider API call failed:", apiError)

      // Refund the credit on API failure
      try {
        await fetch(creditsUrl, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: forwardCookie },
          body: JSON.stringify({ action: "add", amount: 1, reason: "refund:edit-image", idempotencyKey: `${idempotencyKey}:refund` }),
        })
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
          return NextResponse.json({ 
            error: "Model not available. Try reducing image size or count.",
            suggestion: "The selected model may not support the current image format or size."
          }, { status: 400 })
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
        await fetch(creditsUrl, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: forwardCookie },
          body: JSON.stringify({ action: "add", amount: 1, reason: "refund:edit-image", idempotencyKey: `${idempotencyKey}:refund` }),
        })
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
          await fetch(creditsUrl, {
            method: "POST",
            headers: { "content-type": "application/json", cookie: forwardCookie },
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
        : `Single image successfully generated from ${compressedImages.length} input image(s) using OpenAI`,
      usedMask: !!maskDataUrl,
      shapes: shapesMeta || undefined,
      mobileOptimized: mobileClient,
    })
  } catch (error) {
    console.error("[v0] Error processing image:", error)

    // Refund on unexpected server error
    try {
      const cookieId = request.cookies.get("device_id")?.value
      if (cookieId) {
        await fetch(`${(process.env.NEXT_PUBLIC_SITE_URL || "").trim() || request.nextUrl.origin}/api/credits`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: request.headers.get("cookie") || "" },
          body: JSON.stringify({ action: "add", amount: 1, reason: "refund:edit-image", idempotencyKey: `edit:${cookieId}:fallback-refund` }),
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