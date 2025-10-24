"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { Upload, Film, Download, Loader2, X, AlertCircle, Lightbulb } from "lucide-react"

import ProtectedRoute from "@/components/protected-route"
import UserProfile from "@/components/user-profile"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/hooks/use-auth"
import { CREDIT_COST_PIC2VID } from "@/lib/credits"
import { compressAndValidateImage, formatFileSize, MAX_IMAGE_SIZE } from "@/lib/image-utils"

interface SelectedImage {
  id: string
  data: string
  file: File
  originalSize: number
  compressedSize?: number
  isCompressed: boolean
}

function Pic2VidContent() {
  const { user } = useAuth()
  const [image, setImage] = useState<SelectedImage | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<string>("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [credits, setCredits] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [isCompressing, setIsCompressing] = useState(false)
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null)
  const [estimatedDuration, setEstimatedDuration] = useState<number>(0)
  const [progress, setProgress] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [quality, setQuality] = useState<"ultra" | "normal">("ultra")

  const openFileDialog = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    fileInputRef.current?.click()
  }

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch("/api/credits", { cache: "no-store" })
        if (res.ok) {
          const j = await res.json()
          if (typeof j.credits === "number") setCredits(j.credits)
        }
      } catch {
        /* ignored */
      }
    })()
  }, [])

  const processFile = async (file: File) => {
    setUploadError(null)
    setGenerationError(null)
    setIsCompressing(true)
    try {
      if (!file.type.startsWith("image/")) {
        setUploadError("Please upload an image.")
        return
      }
      const result = await compressAndValidateImage(file)
      if (!result.isValid) {
        setUploadError(result.error || "Failed to process image")
        return
      }
      await new Promise<void>((resolve) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          setImage({
            id: Math.random().toString(36).substr(2, 9),
            data: e.target?.result as string,
            file: result.compressedFile || file,
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            isCompressed: result.isCompressed,
          })
          setVideoUrl(null)
          resolve()
        }
        reader.readAsDataURL(result.compressedFile || file)
      })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to process image")
    } finally {
      setIsCompressing(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    await processFile(f)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const img = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"))
    if (img) await processFile(img)
  }

  const removeImage = () => {
    setImage(null)
    setVideoUrl(null)
    setGenerationError(null)
  }

  const estimateGenerationDuration = (bytes: number) => {
    if (!bytes) return 18
    const mb = bytes / (1024 * 1024)
    const base = 16
    const perMb = 1.5
    const est = base + mb * perMb
    return Math.min(75, Math.max(14, est))
  }

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    if (isProcessing && generationStartTime) {
      interval = setInterval(() => {
        const elapsed = (Date.now() - generationStartTime) / 1000
        if (estimatedDuration > 0) {
          const pct = Math.min(99, (elapsed / estimatedDuration) * 100)
          setProgress(pct)
          const remaining = Math.max(0, Math.ceil(estimatedDuration - elapsed))
          setRemainingSeconds(remaining)
        }
      }, 500)
    } else {
      setProgress(0)
      setRemainingSeconds(null)
      setGenerationStartTime(null)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isProcessing, generationStartTime, estimatedDuration])

  const handleGenerateVideo = async () => {
    if (!image) {
      setGenerationError("Add a starting image before generating.")
      return
    }

    setGenerationError(null)
    try {
      const res = await fetch("/api/credits", { cache: "no-store" })
      if (res.ok) {
        const j = await res.json()
        if (typeof j.credits === "number") {
          setCredits(j.credits)
          if ((j.credits ?? 0) < CREDIT_COST_PIC2VID) {
            alert(`Insufficient credits! Need ${CREDIT_COST_PIC2VID}.`)
            return
          }
        }
      }
    } catch {
      /* ignored */
    }

    const totalSize = image.compressedSize || image.originalSize
    const est = estimateGenerationDuration(totalSize)
    setEstimatedDuration(est)
    setGenerationStartTime(Date.now())
    setProgress(0)
    setRemainingSeconds(est)
    setIsProcessing(true)

    try {
      const formData = new FormData()
      formData.append("start_image", image.file)
      if (prompt.trim()) formData.append("prompt", prompt.trim())
      formData.append("quality", quality)

      const resp = await fetch("/api/pic2vid", {
        method: "POST",
        body: formData,
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error || `Failed: ${resp.status}`)
      }
      const json = await resp.json()
      setVideoUrl(json.videoUrl || null)
      if (typeof json.remainingCredits === "number") setCredits(json.remainingCredits)
      try {
        const creditResp = await fetch("/api/credits", { cache: "no-store" })
        if (creditResp.ok) {
          const k = await creditResp.json()
          if (typeof k.credits === "number") setCredits(k.credits)
        }
      } catch {
        /* ignored */
      }
      window.dispatchEvent(new Event("creditsUpdated"))
      setProgress(100)
      setRemainingSeconds(0)
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Video generation failed")
    } finally {
      setIsProcessing(false)
    }
  }

  const downloadVideo = () => {
    if (!videoUrl) return
    const link = document.createElement("a")
    link.href = videoUrl
    link.download = "pic2vid.mp4"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div className="text-center md:text-left space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
              <Film className="h-3.5 w-3.5" />
              Pic2Vid
            </div>
            <h1 className="text-4xl font-bold text-foreground text-balance">Turn a still into motion</h1>
            <p className="text-muted-foreground text-lg text-pretty">
              Upload a reference photo and optionally guide the scene with a prompt to generate a short AI video.
            </p>
            <p className="text-sm text-muted-foreground">
              Each generation costs <span className="font-semibold text-foreground">{CREDIT_COST_PIC2VID} credits</span>.
            </p>
          </div>
          <UserProfile />
        </div>

        <div className="space-y-8">
          <div className="grid lg:grid-cols-2 gap-8 items-start">
            <div className="space-y-6">
              {(uploadError || generationError) && (
                <Card className="border-destructive/20 bg-destructive/5">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-2 text-destructive">
                      <AlertCircle className="h-4 w-4 mt-0.5" />
                      <div className="text-sm font-medium space-y-1">
                        {uploadError && <p>{uploadError}</p>}
                        {generationError && <p>{generationError}</p>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="border-border hover:border-primary/50 transition-colors">
                <CardContent className="p-5">
                  <div
                    className="text-center cursor-pointer"
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={(e) => {
                      if (e.target === e.currentTarget) openFileDialog()
                    }}
                  >
                    <h4 className="text-md font-semibold text-foreground mb-3">Starting Image (required)</h4>
                    {!image ? (
                      <>
                        <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground mb-2">Drag a single image or click to browse.</p>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p>Max size: {formatFileSize(MAX_IMAGE_SIZE)}</p>
                          <p>Faces and motion cues produce richer movement.</p>
                        </div>
                        <div className="mt-3">
                          <Button variant="outline" disabled={isCompressing} onClick={openFileDialog}>
                            {isCompressing ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Processing...
                              </>
                            ) : (
                              "Choose File"
                            )}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-3">
                        <div className="relative aspect-square rounded-lg overflow-hidden bg-muted group">
                          <Image src={image.data} alt="Reference" fill className="object-cover" unoptimized />
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              removeImage()
                            }}
                            className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="Remove image"
                          >
                            <X className="h-3 w-3" />
                          </button>
                          {image.isCompressed && (
                            <div className="absolute bottom-1 left-1 bg-primary/80 text-primary-foreground rounded-full px-2 py-0.5 text-[10px]">
                              Comp
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 justify-center">
                          <Button size="sm" variant="outline" onClick={openFileDialog} disabled={isCompressing}>
                            {isCompressing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : "Replace"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={removeImage}>
                            Clear
                          </Button>
                        </div>
                        <div className="text-xs text-muted-foreground text-center">
                          Size: {formatFileSize(image.compressedSize || image.originalSize)}
                        </div>
                      </div>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border">
                <CardContent className="p-5 space-y-4">
                  <div className="space-y-3">
                    <h4 className="text-md font-semibold text-foreground">Quality</h4>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">Normal</span>
                      <Switch
                        checked={quality === "ultra"}
                        onCheckedChange={(checked) => setQuality(checked ? "ultra" : "normal")}
                        aria-label="Toggle quality between Normal and Ultra"
                        className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-black dark:data-[state=unchecked]:bg-white"
                        thumbClassName="dark:data-[state=unchecked]:bg-black"
                      />
                      <span className="text-sm text-muted-foreground">Ultra</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <h4 className="text-md font-semibold text-foreground">Optional Prompt</h4>
                    <Badge variant="outline">Boost motion</Badge>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pic2vid-prompt" className="text-sm text-muted-foreground">
                      Describe the action, mood, or environment to steer the video.
                    </Label>
                    <Textarea
                      id="pic2vid-prompt"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={'Example: "Camera slowly pans as neon lights flicker in the rain."'}
                      rows={4}
                      className="resize-none"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center gap-2 text-foreground">
                    <Lightbulb className="h-4 w-4 text-primary" />
                    <h4 className="text-md font-semibold">Tips for vivid motion</h4>
                  </div>
                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 text-left">
                    <li>Use sharp, well-lit subjects with clear movement cues.</li>
                    <li>Keep the person fully in frame to avoid clipping when animating.</li>
                    <li>including prompt is highly useful and recommended.</li>
                    <li>Mention camera movement or weather for atmospheric shots.</li>
                  </ul>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="border-border">
                <CardContent className="p-5 space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-md font-semibold text-foreground">Generate video</h4>
                      <p className="text-xs text-muted-foreground">
                        {isProcessing ? "Working on it..." : "Result plays here when ready"}
                      </p>
                    </div>
                    <Badge variant="secondary">{CREDIT_COST_PIC2VID} credits</Badge>
                  </div>

                  <div className="space-y-4">
                    <Button
                      onClick={handleGenerateVideo}
                      disabled={isProcessing || !image || credits < CREDIT_COST_PIC2VID}
                      className="w-full"
                      size="lg"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Animating...
                        </>
                      ) : (
                        <>
                          <Film className="mr-2 h-4 w-4" />
                          Create Pic2Vid ({CREDIT_COST_PIC2VID} credits)
                        </>
                      )}
                    </Button>
                    {credits < CREDIT_COST_PIC2VID && (
                      <p className="text-xs text-destructive text-center">
                        Insufficient credits. You need {CREDIT_COST_PIC2VID} credits.
                      </p>
                    )}
                  </div>

                  <div className="space-y-3">
                    <Progress value={progress} className="h-2" />
                    {isProcessing && remainingSeconds !== null && (
                      <p className="text-xs text-muted-foreground">
                        Est. {remainingSeconds} second{remainingSeconds === 1 ? "" : "s"} remaining
                      </p>
                    )}
                  </div>

                  <div className="border border-dashed border-border rounded-md p-4 bg-muted/30">
                    {videoUrl ? (
                      <div className="space-y-3">
                        <div className="relative w-full overflow-hidden rounded-md bg-black">
                          <video src={videoUrl} controls playsInline className="w-full" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={downloadVideo} size="sm">
                            <Download className="mr-2 h-4 w-4" />
                            Download MP4
                          </Button>
                          <Button asChild variant="outline" size="sm">
                            <a href={videoUrl} target="_blank" rel="noreferrer">
                              Open in new tab
                            </a>
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground text-center py-10">
                        Your generated video will appear here.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Pic2VidPage() {
  return (
    <ProtectedRoute>
      <Pic2VidContent />
    </ProtectedRoute>
  )
}
