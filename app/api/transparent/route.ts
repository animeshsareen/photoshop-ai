import { NextRequest, NextResponse } from "next/server"
import Replicate from "replicate"

import { auth } from "@/lib/auth"
import { CREDIT_COST_PER_EDIT } from "@/lib/credits"
import { getSupabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

const replicateToken = process.env.REPLICATE_API_TOKEN

if (!replicateToken) {
  console.error("[transparent] Missing REPLICATE_API_TOKEN environment variable")
}

const replicateClient = replicateToken ? new Replicate({ auth: replicateToken }) : null

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

    const supabase = getSupabaseAdmin()

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("credits")
      .eq("email", userEmail)
      .single()

    if (userError || !userData) {
      console.error("[transparent] User lookup failed", userError)
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
      console.error("[transparent] Failed to deduct credits", creditError)
      return NextResponse.json({ error: "Failed to deduct credits" }, { status: 500 })
    }

    try {
      const output: unknown = await replicateClient.run("bria/remove-background", {
        input: { image: file },
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
            console.warn("[transparent] Failed to resolve output url from function", urlError)
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
            console.warn("[transparent] Failed to convert output arrayBuffer", arrayBufferError)
          }
        }
      }

      if (!dataUrl && remoteUrl) {
        try {
          const response = await fetch(remoteUrl)
          if (response.ok) {
            dataUrl = await toDataUrlFromResponse(response)
          } else {
            console.warn("[transparent] Failed to fetch transparent asset", response.status, response.statusText)
          }
        } catch (fetchError) {
          console.warn("[transparent] Error fetching transparent image", fetchError)
        }
      }

      if (!dataUrl && remoteUrl) {
        dataUrl = remoteUrl
      }

      if (!dataUrl) {
        throw new Error("No transparent image generated")
      }

      return NextResponse.json({
        transparentUrl: dataUrl,
        remainingCredits: newBalance,
        creditsUsed: creditCost,
      })
    } catch (generationError) {
      console.error("[transparent] Generation error", generationError)
      try {
        await supabase.from("users").update({ credits: currentCredits }).eq("email", userEmail)
      } catch (refundError) {
        console.error("[transparent] Credit refund failed", refundError)
      }
      return NextResponse.json({ error: "Failed to remove background" }, { status: 500 })
    }
  } catch (error) {
    console.error("[transparent] Unexpected error", error)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}
