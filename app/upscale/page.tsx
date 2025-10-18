"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { Upload, Maximize2, Download, Loader2, X, AlertCircle } from "lucide-react"

import ProtectedRoute from "@/components/protected-route"
import UserProfile from "@/components/user-profile"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useAuth } from "@/hooks/use-auth"
import { CREDIT_COST_PER_EDIT } from "@/lib/credits"
import { compressAndValidateImage, formatFileSize, MAX_IMAGE_SIZE } from "@/lib/image-utils"
import { BeforeAfterSlider } from "@/components/before-after-slider"

interface SelectedImage {
  id: string
  data: string
  file: File
  originalSize: number
  compressedSize?: number
  isCompressed: boolean
}

const SCALE_OPTIONS = [
  { value: 2, label: "2× (Fast)" },
  { value: 3, label: "3× (Balanced)" },
  { value: 4, label: "4× (Max Detail)" },
]

function UpscaleContent() {
  const { user } = useAuth()
  const [image, setImage] = useState<SelectedImage | null>(null)
  const [upscaledUrl, setUpscaledUrl] = useState<string | null>(null)
  const [desiredIncrease, setDesiredIncrease] = useState<number>(SCALE_OPTIONS[0]?.value ?? 2)
  const [isProcessing, setIsProcessing] = useState(false)
  const [credits, setCredits] = useState(0)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isCompressing, setIsCompressing] = useState(false)
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null)
  const [estimatedDuration, setEstimatedDuration] = useState<number>(0)
  const [progress, setProgress] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
          setUpscaledUrl(null)
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
    setUpscaledUrl(null)
  }

  const estimateGenerationDuration = (bytes: number) => {
    if (!bytes) return 5
    const mb = bytes / (1024 * 1024)
    const base = 5
    const perMb = 1.2
    const est = base + mb * perMb
    return Math.min(35, Math.max(4, est))
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

  const handleGenerateUpscale = async () => {
    if (!image) return
    try {
      const res = await fetch("/api/credits", { cache: "no-store" })
      if (res.ok) {
        const j = await res.json()
        if (typeof j.credits === "number") {
          setCredits(j.credits)
          if ((j.credits ?? 0) < CREDIT_COST_PER_EDIT) {
            alert(`Insufficient credits! Need ${CREDIT_COST_PER_EDIT}.`)
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
      formData.append("image", image.file)
      formData.append("desired_increase", String(desiredIncrease))

      const resp = await fetch("/api/upscale", {
        method: "POST",
        body: formData,
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error || `Failed: ${resp.status}`)
      }
      const json = await resp.json()
      setUpscaledUrl(json.upscaledUrl || json.imageUrl || json.url || null)
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
      alert(error instanceof Error ? error.message : "Sharpen failed")
    } finally {
      setIsProcessing(false)
    }
  }

  const downloadUpscaled = () => {
    if (!upscaledUrl) return
    const a = document.createElement("a")
    a.href = upscaledUrl
    a.download = "sharpened.png"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="text-center flex-1">
            <h1 className="text-4xl font-bold text-foreground mb-2 text-balance">Sharpen</h1>
            <p className="text-muted-foreground text-lg text-pretty">Welcome back, {user?.name}</p>
            <p className="text-muted-foreground text-lg text-pretty">
              Increase resolution and recover fine detail from any image in a single click.
            </p>
          </div>
          <UserProfile />
        </div>

        <div className="space-y-8">
          <div className="grid lg:grid-cols-2 gap-8 items-start">
            <div className="space-y-6">
              {uploadError && (
                <Card className="border-destructive/20 bg-destructive/5">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm font-medium">{uploadError}</span>
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
                    <h4 className="text-md font-semibold text-foreground mb-3">Source Image</h4>
                    {!image ? (
                      <>
                        <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground mb-2">Upload 1 image to sharpen.</p>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p>Max size: {formatFileSize(MAX_IMAGE_SIZE)}</p>
                          <p>Supports JPEG and PNG formats.</p>
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
                          <Image src={image.data} alt="upload" fill className="object-cover" unoptimized />
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              removeImage()
                            }}
                            className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
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
                          Total size: {formatFileSize(image.compressedSize || image.originalSize)}
                        </div>
                      </div>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border hover:border-primary/50 transition-colors">
                <CardContent className="p-5 space-y-4">
                  <div>
                    <h4 className="text-md font-semibold text-foreground mb-3">Sharpen Settings</h4>
                    <div className="space-y-3">
                      <div>
                        <Label className="text-sm mb-2 block">Scale</Label>
                        <RadioGroup
                          value={String(desiredIncrease)}
                          onValueChange={(value) => setDesiredIncrease(Number.parseInt(value, 10) || SCALE_OPTIONS[0].value)}
                          className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                        >
                          {SCALE_OPTIONS.map((option) => (
                            <Label
                              key={option.value}
                              htmlFor={`scale-${option.value}`}
                              className={`border rounded-md py-2 px-3 text-sm font-medium cursor-pointer transition-colors ${
                                desiredIncrease === option.value
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border text-foreground hover:border-primary/50"
                              }`}
                            >
                              <RadioGroupItem value={String(option.value)} id={`scale-${option.value}`} className="sr-only" />
                              {option.label}
                            </Label>
                          ))}
                        </RadioGroup>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    Tip: Higher scales recover more detail but may take a little longer to process.
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Credits available</p>
                      <p className="text-2xl font-semibold text-primary">{credits}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Cost per sharpen</p>
                      <p className="text-sm font-semibold text-foreground">{CREDIT_COST_PER_EDIT} credit</p>
                    </div>
                  </div>

                  {isProcessing && (
                    <div>
                      <Progress value={progress} className="h-2" />
                      <p className="text-xs text-muted-foreground mt-2">
                        {remainingSeconds !== null ? `${remainingSeconds}s remaining` : "Generating..."}
                      </p>
                    </div>
                  )}

                  <Button
                    size="lg"
                    className="w-full"
                    onClick={handleGenerateUpscale}
                    disabled={!image || isProcessing || isProcessingPayment}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sharpening...
                      </>
                    ) : (
                      <>
                        <Maximize2 className="mr-2 h-4 w-4" />
                        Sharpen Image
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    {image ? "Ready when you are. Choose a scale and sharpen your image." : "Upload an image to get started."}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="border-border">
                <CardContent className="p-5 space-y-4">
                  <h4 className="text-md font-semibold text-foreground">Preview</h4>
                  {image ? (
                    upscaledUrl ? (
                      <BeforeAfterSlider
                        beforeSrc={image.data}
                        afterSrc={upscaledUrl}
                        beforeAlt="Original image"
                        afterAlt="Sharpened image"
                        beforeLabel="Original"
                        afterLabel="Sharpened"
                        className="w-full aspect-square"
                      />
                    ) : (
                      <div className="relative aspect-square rounded-lg border border-dashed border-border bg-muted overflow-hidden">
                        <Image src={image.data} alt="Original image" fill className="object-cover" sizes="320px" unoptimized />
                        <div className="absolute top-3 left-3 rounded-full bg-background/80 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground shadow-sm">
                          Original
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="relative aspect-square rounded-lg border border-dashed border-border bg-muted overflow-hidden">
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
                        <Upload className="h-8 w-8 mb-2" />
                        Upload to preview
                      </div>
                    </div>
                  )}
                  {upscaledUrl ? (
                    <Button variant="outline" onClick={downloadUpscaled} className="w-full">
                      <Download className="mr-2 h-4 w-4" />
                      Download PNG
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center">
                      {image ? "Sharpen your image to compare results." : "Upload an image to get started."}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border">
                <CardContent className="p-5 space-y-3 text-sm text-muted-foreground">
                  <h4 className="text-md font-semibold text-foreground">For best results</h4>
                  <ul className="space-y-2">
                    <li>• Start with the highest quality original you have.</li>
                    <li>• Avoid heavily compressed sources with visible artifacts.</li>
                    <li>• Try 3× or 4× scale for print-ready output.</li>
                    <li>• Use the download button to save the full-resolution result.</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function UpscalePage() {
  return (
    <ProtectedRoute>
      <UpscaleContent />
    </ProtectedRoute>
  )
}
