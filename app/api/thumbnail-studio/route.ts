import { type NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getSupabaseAdmin } from "@/lib/supabase"
import { DEFAULT_FREE_CREDITS } from "@/lib/credits"
import * as path from "path"
import * as fs from "fs"
import sharp from "sharp"

export const runtime = "nodejs"

if (!process.env.GEMINI_API_KEY) {
  console.error("[thumbnail-studio] GEMINI_API_KEY environment variable is not set")
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

export async function POST(request: NextRequest) {
  try {
    console.log("[thumbnail-studio] API route called")

    const formData = await request.formData()
    const userPrompt = (formData.get("prompt") as string | null)?.trim() || ""
    const mainTitle = (formData.get("mainTitle") as string | null)?.trim() || ""

    if (!userPrompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 })
    }

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
      console.log("[thumbnail-studio] Missing images")
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
    const idempotencyKey = `thumbnail-studio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Check and deduct credits
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("credits")
      .eq("email", userEmail)
      .single()

    if (userError || !userData) {
      console.error("[thumbnail-studio] User lookup failed:", userError)
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
      console.error("[thumbnail-studio] Credit deduction failed:", creditError)
      return NextResponse.json({ error: "Failed to deduct credits" }, { status: 500 })
    }

    // Process and compress images (following the same pattern as edit-image)
    const compressedImages: File[] = []
    const MAX_TOTAL_SIZE = 50 * 1024 * 1024 // 50MB total limit
    let totalSize = 0

    console.log("[thumbnail-studio] Starting image processing for", images.length, "images")

    // Create temp directory if it doesn't exist
    const tempDir = "/tmp"
    if (!fs.existsSync(tempDir)) {
      console.log("[thumbnail-studio] Creating temp directory:", tempDir)
      fs.mkdirSync(tempDir, { recursive: true })
    }

    for (let i = 0; i < images.length; i++) {
      const image = images[i]
      console.log(`[thumbnail-studio] Processing image ${i + 1}/${images.length}: ${image.name} (${(image.size / 1024 / 1024).toFixed(2)}MB)`)
      
      // Only compress if image is larger than 1MB
      if (image.size > 1024 * 1024) {
        console.log(`[thumbnail-studio] Image ${i + 1} is larger than 1MB, compressing...`)
        try {
          const parsedIn = path.parse(image.name || "image")
          const inputPath = path.join(tempDir, `input-${Date.now()}-${parsedIn.name}${parsedIn.ext || ""}`)
          const outputPath = path.join(tempDir, `compressed-${Date.now()}-${parsedIn.name}.jpg`)
          
          console.log(`[thumbnail-studio] Writing image ${i + 1} to temp file:`, inputPath)
          // Write the original file to disk
          const arrayBuffer = await image.arrayBuffer()
          fs.writeFileSync(inputPath, Buffer.from(arrayBuffer))
          
          console.log(`[thumbnail-studio] Compressing image ${i + 1}...`)
          // Compress the image
          await compressImage(inputPath, outputPath)
          
          console.log(`[thumbnail-studio] Reading compressed image ${i + 1}...`)
          // Read the compressed file
          const compressedBuffer = fs.readFileSync(outputPath)
          
          // Create a new File object with compressed data
          const jpegName = `${parsedIn.name || "image"}.jpg`
          const compressedFile = new File(
            [compressedBuffer], 
            jpegName, 
            { type: "image/jpeg" }
          )
          
          console.log(`[thumbnail-studio] Compressed ${image.name}: ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB (was ${(image.size / 1024 / 1024).toFixed(2)}MB)`)
          
          // Clean up temporary files
          console.log(`[thumbnail-studio] Cleaning up temp files for image ${i + 1}`)
          fs.unlinkSync(inputPath)
          fs.unlinkSync(outputPath)
          
          compressedImages.push(compressedFile)
          totalSize += compressedFile.size
        } catch (compressError) {
          console.error(`[thumbnail-studio] Error compressing image ${i + 1} (${image.name}):`, compressError)
          console.error(`[thumbnail-studio] Compression error details:`, {
            name: compressError instanceof Error ? compressError.name : 'Unknown',
            message: compressError instanceof Error ? compressError.message : String(compressError),
            stack: compressError instanceof Error ? compressError.stack : undefined
          })
          // If compression fails, use the original image
          console.log(`[thumbnail-studio] Using original image ${i + 1} due to compression failure`)
          compressedImages.push(image)
          totalSize += image.size
        }
      } else {
        console.log(`[thumbnail-studio] Image ${i + 1} is small enough, using original`)
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

    console.log(`[thumbnail-studio] Processing ${compressedImages.length} image(s) with total size: ${(totalSize / 1024 / 1024).toFixed(2)}MB. User prompt length: ${userPrompt.length}`)

    // Convert images to base64 for Gemini
    console.log(`[thumbnail-studio] Converting ${compressedImages.length} images to base64 for Gemini`)
    const imageParts = await Promise.all(
      compressedImages.map(async (image, index) => {
        try {
          console.log(`[thumbnail-studio] Converting image ${index + 1} to base64: ${image.name} (${image.type})`)
          const imageBuffer = await image.arrayBuffer()
          const base64Image = Buffer.from(imageBuffer).toString("base64")
          console.log(`[thumbnail-studio] Converted image ${index + 1} to base64, length: ${base64Image.length}`)
          return {
            inlineData: {
              data: base64Image,
              mimeType: image.type,
            },
          }
        } catch (conversionError) {
          console.error(`[thumbnail-studio] Error converting image ${index + 1} to base64:`, conversionError)
          throw conversionError
        }
      }),
    )
    console.log(`[thumbnail-studio] Successfully converted all images to base64`)

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

    // Build the thumbnail generation prompt
    let thumbnailPrompt = `You are an expert graphic designer specializing in YouTube thumbnails.
Your task is to generate a high-quality, eye-catching thumbnail image using the provided inputs.

Inputs:
  • One or multiple images (to be used as source material or background/foreground elements).
  • A descriptive text prompt that explains the concept, mood, or style of the thumbnail.
  • An optional Title Text string. If provided, this text must be clearly and prominently displayed in the final thumbnail in a bold, readable style optimized for YouTube.

Requirements:
  • Composition should be visually striking, high contrast, and attention-grabbing.
  • If multiple images are given, intelligently combine or collage them to best fit the concept.
  • Always prioritize clarity and readability.
  • If Title Text is provided:
    • Place it in a prominent location, around the main subject of the image.
    • Make it bold and ensure it is fully in frame, and readable.
    • Use bold, clean typography that stands out against the background.
    • Ensure text is legible even at small sizes.

Output:
  • A single finished YouTube thumbnail image incorporating the given prompt, source images, and optional Title Text.


User's description: ${userPrompt}`

    if (mainTitle) {
      thumbnailPrompt += `\n\nMain title to include: "${mainTitle}"`
    }

    thumbnailPrompt += `\n\nGenerate a single, high-quality YouTube thumbnail that incorporates the provided images and follows these requirements. The thumbnail should be compelling and designed to increase click-through rates.`

    // Execute Gemini request
    let response: any = null
    let generatedImageData: string | null = null
    let finalMime: string = "image/png"

    try {
      const geminiInputs: any[] = [thumbnailPrompt, ...imageParts]
      console.log("[thumbnail-studio] Calling Gemini API with prompt length:", thumbnailPrompt.length)
      console.log("[thumbnail-studio] Number of image parts:", imageParts.length)
      console.log("[thumbnail-studio] Image parts mime types:", imageParts.map(p => p.inlineData?.mimeType))
      
      response = await model.generateContent(geminiInputs as any)
      console.log("[thumbnail-studio] Gemini API call successful")
      console.log("[thumbnail-studio] Response structure:", {
        hasResponse: !!response?.response,
        hasCandidates: !!response?.response?.candidates,
        candidatesLength: response?.response?.candidates?.length || 0
      })

      // Extract image from response
      const result = response.response
      console.log("[thumbnail-studio] Full response result:", JSON.stringify(result, null, 2))
      
      if (result && result.candidates && result.candidates[0]) {
        const candidate = result.candidates[0]
        console.log("[thumbnail-studio] First candidate:", {
          hasContent: !!candidate.content,
          hasParts: !!candidate.content?.parts,
          partsLength: candidate.content?.parts?.length || 0,
          hasInlineData: !!candidate.content?.parts?.[0]?.inlineData
        })
        
        if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
          const content = candidate.content
          const firstPart = content.parts[0]
          console.log("[thumbnail-studio] First part:", {
            hasInlineData: !!firstPart.inlineData,
            mimeType: firstPart.inlineData?.mimeType,
            dataLength: firstPart.inlineData?.data?.length || 0
          })
          
          if (firstPart.inlineData) {
            generatedImageData = firstPart.inlineData.data
            finalMime = firstPart.inlineData.mimeType || "image/png"
            console.log("[thumbnail-studio] Successfully extracted image data, length:", generatedImageData?.length)
          } else {
            console.error("[thumbnail-studio] No inlineData found in first part")
          }
        } else {
          console.error("[thumbnail-studio] No content or parts found in first candidate")
        }
      } else {
        console.error("[thumbnail-studio] No candidates found in response")
      }

      if (!generatedImageData) {
        console.error("[thumbnail-studio] No image data extracted from Gemini response")
        console.error("[thumbnail-studio] Full response for debugging:", JSON.stringify(response, null, 2))
        throw new Error("No image generated by Gemini - check response structure")
      }
    } catch (error) {
      console.error("[thumbnail-studio] Gemini API call failed with error:", error)
      console.error("[thumbnail-studio] Error details:", {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      
      // Refund the credit on failure
      try {
        console.log("[thumbnail-studio] Attempting to refund credit due to failure")
        await supabase
          .from("users")
          .update({ credits: currentCredits })
          .eq("email", userEmail)
        console.log("[thumbnail-studio] Credit refund successful")
      } catch (refundError) {
        console.error("[thumbnail-studio] Failed to refund credit:", refundError)
      }
      
      return NextResponse.json({ 
        error: "Failed to generate thumbnail", 
        details: error instanceof Error ? error.message : "Unknown error"
      }, { status: 500 })
    }

    // Handle mobile optimization
    const isMobile = isMobileRequest(request)
    console.log(`[thumbnail-studio] Mobile device detected: ${isMobile}`)
    let finalImageData = generatedImageData
    let finalImageMime = finalMime

    if (isMobile && finalMime === "image/png") {
      console.log("[thumbnail-studio] Applying mobile optimization to PNG image")
      try {
        const mobileResult = await recompressForMobile(generatedImageData)
        finalImageData = mobileResult.base64
        finalImageMime = mobileResult.mime
        console.log(`[thumbnail-studio] Mobile optimization successful, new size: ${finalImageData.length} chars`)
      } catch (error) {
        console.warn("[thumbnail-studio] Mobile optimization failed, using original:", error)
        console.warn("[thumbnail-studio] Mobile optimization error details:", {
          name: error instanceof Error ? error.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    } else {
      console.log(`[thumbnail-studio] Skipping mobile optimization (isMobile: ${isMobile}, mimeType: ${finalMime})`)
    }

    // Return the generated thumbnail
    const thumbnailUrl = `data:${finalImageMime};base64,${finalImageData}`
    console.log(`[thumbnail-studio] Successfully generated thumbnail, final URL length: ${thumbnailUrl.length}`)

    return NextResponse.json({
      thumbnailUrl,
      mimeType: finalImageMime,
      creditsUsed: creditCost,
      remainingCredits: currentCredits - creditCost
    })

  } catch (error) {
    console.error("[thumbnail-studio] Unexpected error in main handler:", error)
    console.error("[thumbnail-studio] Error details:", {
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
