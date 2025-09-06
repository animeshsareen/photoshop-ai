import { type NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import * as path from "path"
import * as fs from "fs"
import sharp from "sharp"

if (!process.env.GEMINI_API_KEY) {
  console.error("[v0] GEMINI_API_KEY environment variable is not set")
}

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null

// Server-side image compression function
async function compressImage(inputPath: string, outputPath: string, maxWidth = 800, quality = 70) {
  await sharp(inputPath)
    .resize({ width: maxWidth })
    .jpeg({ quality })
    .toFile(outputPath);
  
  return outputPath;
}

export async function POST(request: NextRequest) {
  try {
    console.log("[v0] API route called")

    if (!genAI) {
      return NextResponse.json({ error: "GEMINI_API_KEY environment variable is not configured" }, { status: 500 })
    }

    const formData = await request.formData()
    const userPrompt = (formData.get("prompt") as string | null)?.trim() || ""

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
          
          const inputPath = path.join(tempDir, `input-${Date.now()}-${image.name}`)
          const outputPath = path.join(tempDir, `compressed-${Date.now()}-${image.name}`)
          
          // Write the original file to disk
          const arrayBuffer = await image.arrayBuffer()
          fs.writeFileSync(inputPath, Buffer.from(arrayBuffer))
          
          // Compress the image
          await compressImage(inputPath, outputPath)
          
          // Read the compressed file
          const compressedBuffer = fs.readFileSync(outputPath)
          
          // Create a new File object with compressed data
          const compressedFile = new File(
            [compressedBuffer], 
            image.name, 
            { type: image.type }
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

  console.log(`[v0] Processing ${compressedImages.length} image(s) with total size: ${(totalSize / 1024 / 1024).toFixed(2)}MB. User prompt length: ${userPrompt.length}`)

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

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-image-preview", // Use the working model name
    })

  const baseSystemPrompt = `You are a virtual fashion try-on assistant. You will always receive exactly two input images:
	1.	PERSON photo (the model) – preserve identity, body shape, pose, lighting, and background.
	2.	GARMENT photo – apply only this clothing item onto the person.

TASK: Generate a single photorealistic image of the PERSON wearing the GARMENT.

STRICT REQUIREMENTS:
	•	Keep the person’s face, hair, skin, body proportions, hands, and background fully unchanged.
	•	Fit the garment naturally to the person: correct size, drape, folds, perspective, and alignment with pose.
	•	Reproduce fabric texture, material, color accuracy, logos, and patterns from the garment image with exact fidelity.
	•	Ensure consistent lighting, shadows, and shading with the original photo.
	•	Blend garment edges seamlessly, with no halos, artifacts, or distortions.
	•	Do not add or alter anything else (no extra accessories, no different clothes, no text, no stylization).
	•	If garment details (sleeves, neckline, length) are unclear, infer a subtle, plausible completion.
	•	Deliver only the final edited image—no captions, alternatives, or other outputs.

GOAL: A single, best-quality, hyper-realistic try-on result indistinguishable from a real photo.

⸻

Do you want me to also rewrite it in a shorter “system-prompt style” version that you can drop straight into an API call, without explanations?`

    // If the user supplied an additional (optional) prompt, append it in a controlled way.
    const editPrompt = userPrompt ? `${baseSystemPrompt}\n\nUSER ADDITIONAL INSTRUCTIONS (optional – follow only if they don't conflict):\n${userPrompt}` : baseSystemPrompt

    console.log("[v0] Sending virtual try-on request to Gemini API with multiple images")

    let response
    try {
  response = await model.generateContent([editPrompt, ...imageParts])
      console.log("[v0] Gemini API call successful")
    } catch (apiError) {
      console.error("[v0] Gemini API call failed:", apiError)

      if (apiError instanceof Error) {
        console.log("[v0] Error message:", apiError.message)

        if (apiError.message.includes("API key")) {
          return NextResponse.json({ 
            error: "Invalid or missing API key for Gemini API",
            suggestion: "Please check your API configuration."
          }, { status: 401 })
        }
        if (apiError.message.includes("quota") || apiError.message.includes("limit")) {
          return NextResponse.json({ 
            error: "API quota exceeded. Please try again later.",
            suggestion: "You may have reached your daily API limit."
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
          error: `Gemini API error: ${apiError.message}`,
          suggestion: "Please try again with different images or a different prompt."
        }, { status: 500 })
      }

      return NextResponse.json({ 
        error: "Unknown error occurred while calling Gemini API",
        suggestion: "Please try again later."
      }, { status: 500 })
    }

    console.log("[v0] Received response from Gemini API")

    if (!response || !response.response) {
      console.log("[v0] No response object from Gemini API")
      return NextResponse.json({ 
        error: "No response received from Gemini API",
        suggestion: "Please try again with a different prompt or images."
      }, { status: 500 })
    }

    if (!response.response.candidates || response.response.candidates.length === 0) {
      console.log("[v0] No candidates in response:", JSON.stringify(response.response))

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

    const candidate = response.response.candidates[0]

    if (candidate.finishReason === "SAFETY") {
      return NextResponse.json({ 
        error: "Content was filtered due to safety concerns",
        suggestion: "Try a different prompt that doesn't involve potentially sensitive content."
      }, { status: 400 })
    }

    if (!candidate.content || !candidate.content.parts) {
      console.log("[v0] No content parts in response candidate")
      return NextResponse.json({ 
        error: "No content parts generated in response",
        suggestion: "Try a different prompt or check your image quality."
      }, { status: 500 })
    }

    let generatedImageData = null
    for (const part of candidate.content.parts) {
      if (part.inlineData) {
        generatedImageData = part.inlineData.data
        break
      }
    }

    if (!generatedImageData) {
      console.log("[v0] No image generated in response")
      return NextResponse.json({ 
        error: "No image was generated",
        suggestion: "Try a different prompt or ensure your images are clear and well-defined."
      }, { status: 500 })
    }

    console.log("[v0] Successfully generated single edited image from multiple inputs")

    return NextResponse.json({
      editedImageUrl: `data:image/png;base64,${generatedImageData}`,
      message: `Single image successfully generated from ${compressedImages.length} input image(s) using Gemini 2.0 Flash`,
    })
  } catch (error) {
    console.error("[v0] Error processing image:", error)

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