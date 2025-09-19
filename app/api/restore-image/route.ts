import { type NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getSupabaseAdmin } from "@/lib/supabase"
import { DEFAULT_FREE_CREDITS } from "@/lib/credits"
import * as path from "path"
import * as fs from "fs"
import sharp from "sharp"

export const runtime = "nodejs"

if (!process.env.GEMINI_API_KEY) {
  console.error("[restore-image] GEMINI_API_KEY environment variable is not set")
}

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null

// Server-side image compression function
async function compressImage(inputPath: string, outputPath: string, maxWidth = 800, quality = 70) {
  await sharp(inputPath)
    .resize({ width: maxWidth })
    .jpeg({ quality })
    .toFile(outputPath)
  
  return outputPath
}

// Detect if the request likely originates from a mobile device
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

function extractFirstInlineImage(result: any): { data: string; mime: string } | null {
  const cands = result?.candidates ?? []
  for (const c of cands) {
    const parts = c?.content?.parts ?? []
    for (const p of parts) {
      if (p?.inlineData?.data) {
        return { data: p.inlineData.data, mime: p.inlineData.mimeType || "image/png" }
      }
    }
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    console.log("[restore-image] API route called")

    const formData = await request.formData()
    const userPrompt = (formData.get("prompt") as string | null)?.trim() || ""
    const restorationType = (formData.get("restorationType") as string | null)?.trim() || "general"

    // Get images from form data
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

    // Server-side credit enforcement: require authenticated user and deduct upfront
    const { auth } = await import("@/lib/auth")
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    const userEmail = session.user.email
    const supabase = getSupabaseAdmin()
    const idempotencyKey = `restore-image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Check and deduct credits
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("credits")
      .eq("email", userEmail)
      .single()

    if (userError || !userData) {
      console.error("[restore-image] User lookup failed:", userError)
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const currentCredits = userData.credits || 0
    const creditCost = 1 // Same as other features

    if (currentCredits < creditCost) {
      return NextResponse.json({ error: "Insufficient credits" }, { status: 402 })
    }

    // Deduct credit
    const { error: creditError } = await supabase
      .from("users")
      .update({ credits: currentCredits - creditCost })
      .eq("email", userEmail)

    if (creditError) {
      console.error("[restore-image] Credit deduction failed:", creditError)
      return NextResponse.json({ error: "Failed to deduct credits" }, { status: 500 })
    }

    // Process and compress images (following the same pattern as edit-image)
    const compressedImages: File[] = []
    const MAX_TOTAL_SIZE = 50 * 1024 * 1024 // 50MB total limit
    let totalSize = 0

    console.log("[restore-image] Starting image processing for", images.length, "images")

    // Create temp directory if it doesn't exist
    const tempDir = "/tmp"
    if (!fs.existsSync(tempDir)) {
      console.log("[restore-image] Creating temp directory:", tempDir)
      fs.mkdirSync(tempDir, { recursive: true })
    }

    for (let i = 0; i < images.length; i++) {
      const image = images[i]
      console.log(`[restore-image] Processing image ${i + 1}/${images.length}: ${image.name} (${(image.size / 1024 / 1024).toFixed(2)}MB)`)
      
      // Only compress if image is larger than 1MB
      if (image.size > 1024 * 1024) {
        console.log(`[restore-image] Image ${i + 1} is larger than 1MB, compressing...`)
        try {
          const parsedIn = path.parse(image.name || "image")
          const inputPath = path.join(tempDir, `input-${Date.now()}-${parsedIn.name}${parsedIn.ext || ""}`)
          const outputPath = path.join(tempDir, `compressed-${Date.now()}-${parsedIn.name}.jpg`)
          
          console.log(`[restore-image] Writing image ${i + 1} to temp file:`, inputPath)
          // Write the original file to disk
          const arrayBuffer = await image.arrayBuffer()
          fs.writeFileSync(inputPath, Buffer.from(arrayBuffer))
          
          console.log(`[restore-image] Compressing image ${i + 1}...`)
          // Compress the image
          await compressImage(inputPath, outputPath)
          
          console.log(`[restore-image] Reading compressed image ${i + 1}...`)
          // Read the compressed file
          const compressedBuffer = fs.readFileSync(outputPath)
          
          // Create a new File object with compressed data
          const jpegName = `${parsedIn.name || "image"}.jpg`
          const compressedFile = new File(
            [compressedBuffer], 
            jpegName, 
            { type: "image/jpeg" }
          )
          
          console.log(`[restore-image] Compressed ${image.name}: ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB (was ${(image.size / 1024 / 1024).toFixed(2)}MB)`)
          
          // Clean up temporary files
          console.log(`[restore-image] Cleaning up temp files for image ${i + 1}`)
          fs.unlinkSync(inputPath)
          fs.unlinkSync(outputPath)
          
          compressedImages.push(compressedFile)
          totalSize += compressedFile.size
        } catch (compressError) {
          console.error(`[restore-image] Error compressing image ${i + 1} (${image.name}):`, compressError)
          console.error(`[restore-image] Compression error details:`, {
            name: compressError instanceof Error ? compressError.name : 'Unknown',
            message: compressError instanceof Error ? compressError.message : String(compressError),
            stack: compressError instanceof Error ? compressError.stack : undefined
          })
          // If compression fails, use the original image
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

    // Check if total size exceeds limit after compression
    if (totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json(
        {
          error: `Total image size is too large (${(totalSize / 1024 / 1024).toFixed(2)}MB). Maximum total size is ${(MAX_TOTAL_SIZE / 1024 / 1024).toFixed(1)}MB.`,
          suggestion: "Try uploading fewer images or compress them to reduce file sizes."
        },
        { status: 400 },
      )
    }

    console.log(`[restore-image] Processing ${compressedImages.length} image(s) with total size: ${(totalSize / 1024 / 1024).toFixed(2)}MB. User prompt length: ${userPrompt.length}`)

    // Convert images to base64 for Gemini
    console.log(`[restore-image] Converting ${compressedImages.length} images to base64 for Gemini`)
    const imageParts = await Promise.all(
      compressedImages.map(async (image, index) => {
        try {
          console.log(`[restore-image] Converting image ${index + 1} to base64: ${image.name} (${image.type})`)
          const imageBuffer = await image.arrayBuffer()
          const base64Image = Buffer.from(imageBuffer).toString("base64")
          console.log(`[restore-image] Converted image ${index + 1} to base64, length: ${base64Image.length}`)
          return {
            inlineData: {
              data: base64Image,
              mimeType: image.type,
            },
          }
        } catch (conversionError) {
          console.error(`[restore-image] Error converting image ${index + 1} to base64:`, conversionError)
          throw conversionError
        }
      }),
    )
    console.log(`[restore-image] Successfully converted all images to base64`)

    // Prepare Gemini model
    const model = genAI?.getGenerativeModel({
      model: "gemini-2.5-flash-image-preview",
    })

    if (!genAI || !model) {
      // Refund the credit if Gemini isn't configured
      try {
        await supabase
          .from("users")
          .update({ credits: currentCredits })
          .eq("email", userEmail)
      } catch {}
      return NextResponse.json({ error: "GEMINI_API_KEY environment variable is not configured" }, { status: 500 })
    }

    // Build the restoration prompt based on restoration type
    let restorationPrompt = `You are an expert photo restoration specialist with advanced AI capabilities.
Your task is to restore old, damaged, or low-quality photos to their original beauty and clarity.

Inputs:
  • One or multiple images that need restoration (old photos, damaged images, low-quality scans, etc.)
  • Optional restoration instructions from the user
  • Restoration type: ${restorationType}

Restoration Types:
  • "general" - Standard restoration for typical old photos. Improve photorealism, clarity, and sharpness.
  • "heavy_damage" - For severely damaged photos with tears, stains, or major defects. Improve photorealism, clarity, and sharpness
  • "color_enhancement" - Focus on restoring faded colors and improving color accuracy. Improve photorealism, clarity, and sharpness
  • "noise_reduction" - Remove grain, noise, and artifacts from scanned or digital photos. Improve photorealism, clarity, and sharpness

Requirements:
  • Analyze the image(s) to identify specific damage types (fading, scratches, tears, noise, color loss, etc.)
  • Apply appropriate restoration techniques for each type of damage
  • Maintain the original character and authenticity of the photo
  • Enhance details while preserving the historical integrity
  • If multiple images are provided, restore each one individually
  • Output should be high-quality, clean, and visually appealing

Restoration Process:
  1. Analyze the damage and deterioration patterns
  2. Remove scratches, dust, and artifacts
  3. Restore missing or damaged areas
  4. Enhance contrast and brightness
  5. Restore or improve colors if needed
  6. Reduce noise and grain
  7. Sharpen details appropriately
  8. Ensure natural-looking results

Output:
  • A single restored image that brings the photo back to life
  • The restored image should look natural and authentic
  • Preserve the original composition and important details
  • Enhance visual quality while maintaining historical accuracy`

    if (userPrompt) {
      restorationPrompt += `\n\nUser's specific instructions: ${userPrompt}`
    }

    restorationPrompt += `\n\nGenerate a high-quality restored version of the provided image(s) that addresses the specific restoration needs based on the restoration type and any user instructions.`

    // Execute Gemini request
    let response: any = null
    let generatedImageData: string | null = null
    let finalMime: string = "image/png"

    try {
      const geminiInputs: any[] = [restorationPrompt, ...imageParts]
      console.log("[restore-image] Calling Gemini API with prompt length:", restorationPrompt.length)
      console.log("[restore-image] Number of image parts:", imageParts.length)
      console.log("[restore-image] Image parts mime types:", imageParts.map(p => p.inlineData?.mimeType))
      
      response = await model.generateContent(geminiInputs as any)
      console.log("[restore-image] Gemini API call successful")
      console.log("[restore-image] Response structure:", {
        hasResponse: !!response?.response,
        hasCandidates: !!response?.response?.candidates,
        candidatesLength: response?.response?.candidates?.length || 0
      })

      // Extract image from response
      const result = response.response
      const img = extractFirstInlineImage(result)

      if (!img) {
        // Try to surface a text reason if present
        const firstText = result?.candidates?.flatMap((c: any) => c?.content?.parts ?? [])
          ?.find((p: any) => typeof p?.text === "string")?.text

        console.warn("[restore-image] No image returned by Gemini. Reason (if any):", firstText?.slice(0, 300) || "none")

        // Refund is handled below in catch; here we return a precise 422
        try {
          await supabase.from("users").update({ credits: currentCredits }).eq("email", userEmail)
        } catch {}

        return NextResponse.json({
          error: "Model did not return an image",
          details: firstText || "The model responded without inline image data."
        }, { status: 422 })
      }

      generatedImageData = img.data
      finalMime = img.mime
    } catch (error) {
      console.error("[restore-image] Gemini API call failed with error:", error)
      console.error("[restore-image] Error details:", {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      
      // Refund the credit on failure
      try {
        console.log("[restore-image] Attempting to refund credit due to failure")
        await supabase
          .from("users")
          .update({ credits: currentCredits })
          .eq("email", userEmail)
        console.log("[restore-image] Credit refund successful")
      } catch (refundError) {
        console.error("[restore-image] Failed to refund credit:", refundError)
      }
      
      return NextResponse.json({ 
        error: "Failed to restore image", 
        details: error instanceof Error ? error.message : "Unknown error"
      }, { status: 500 })
    }

    // Handle mobile optimization
    const isMobile = isMobileRequest(request)
    console.log(`[restore-image] Mobile device detected: ${isMobile}`)
    let finalImageData = generatedImageData
    let finalImageMime = finalMime

    if (isMobile && finalMime === "image/png") {
      console.log("[restore-image] Applying mobile optimization to PNG image")
      try {
        const mobileResult = await recompressForMobile(generatedImageData)
        finalImageData = mobileResult.base64
        finalImageMime = mobileResult.mime
        console.log(`[restore-image] Mobile optimization successful, new size: ${finalImageData.length} chars`)
      } catch (error) {
        console.warn("[restore-image] Mobile optimization failed, using original:", error)
        console.warn("[restore-image] Mobile optimization error details:", {
          name: error instanceof Error ? error.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    } else {
      console.log(`[restore-image] Skipping mobile optimization (isMobile: ${isMobile}, mimeType: ${finalMime})`)
    }

    // Return the restored image
    const restoredImageUrl = `data:${finalImageMime};base64,${finalImageData}`
    console.log(`[restore-image] Successfully restored image, final URL length: ${restoredImageUrl.length}`)

    return NextResponse.json({
      restoredImageUrl,
      mimeType: finalImageMime,
      creditsUsed: creditCost,
      remainingCredits: currentCredits - creditCost
    })

  } catch (error) {
    console.error("[restore-image] Unexpected error in main handler:", error)
    console.error("[restore-image] Error details:", {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    return NextResponse.json({ 
      error: "Internal server error", 
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 })
  }
}
