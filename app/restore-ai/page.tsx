"use client"

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Upload, RefreshCw, Download, Loader2, X, AlertCircle } from 'lucide-react'
import Image from 'next/image'
import { CreditDisplay } from '@/components/credit-display'
import UserProfile from '@/components/user-profile'
import ProtectedRoute from '@/components/protected-route'
import { useAuth } from '@/hooks/use-auth'
import { CREDIT_COST_PER_EDIT } from '@/lib/credits'
import { formatFileSize, compressAndValidateImage, MAX_IMAGE_SIZE } from '@/lib/image-utils'
import SubsectionEditor, { SubsectionEditorValue } from '@/components/subsection-editor'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'

interface SelectedImage {
  id: string
  data: string
  file: File
  originalSize: number
  compressedSize?: number
  isCompressed: boolean
}

const RESTORATION_TYPES = [
  { value: "general", label: "General Restoration", description: "Standard restoration for typical old photos" },
  { value: "heavy_damage", label: "Heavy Damage", description: "For severely damaged photos with tears, stains, or major defects" },
  { value: "color_enhancement", label: "Color Enhancement", description: "Focus on restoring faded colors and improving color accuracy" },
  { value: "noise_reduction", label: "Noise Reduction", description: "Remove grain, noise, and artifacts from scanned or digital photos" }
]

function RestoreAIContent() {
  const { user } = useAuth()
  const [image, setImage] = useState<SelectedImage | null>(null)
  const [restoredImage, setRestoredImage] = useState<string | null>(null)
  const [prompt, setPrompt] = useState("")
  const [restorationType, setRestorationType] = useState("general")
  const [isProcessing, setIsProcessing] = useState(false)
  const [credits, setCredits] = useState(0)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isCompressing, setIsCompressing] = useState(false)
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null)
  const [estimatedDuration, setEstimatedDuration] = useState<number>(0)
  const [progress, setProgress] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const [isSelectingSubsection, setIsSelectingSubsection] = useState(false)
  const [subsectionValue, setSubsectionValue] = useState<SubsectionEditorValue | null>(null)
  const [showBeforeAfter, setShowBeforeAfter] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const openFileDialog = (e?: React.MouseEvent) => { if (e) e.stopPropagation(); fileInputRef.current?.click() }

  useEffect(() => { (async () => { try { const res = await fetch('/api/credits', { cache: 'no-store' }); if (res.ok) { const j = await res.json(); if (typeof j.credits === 'number') setCredits(j.credits) } } catch {} })() }, [])

  const processFile = async (file: File) => {
    setUploadError(null)
    setIsCompressing(true)
    try {
      if (!file.type.startsWith('image/')) { setUploadError('Please upload an image.'); return }
      const result = await compressAndValidateImage(file)
      if (!result.isValid) { setUploadError(result.error || 'Failed to process image'); return }
      await new Promise<void>((resolve) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          setImage({
            id: Math.random().toString(36).substr(2,9),
            data: e.target?.result as string,
            file: result.compressedFile || file,
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            isCompressed: result.isCompressed,
          })
          setRestoredImage(null)
          resolve()
        }
        reader.readAsDataURL(result.compressedFile || file)
      })
    } catch (e) { setUploadError(e instanceof Error ? e.message : 'Failed to process image') }
    finally { setIsCompressing(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; await processFile(f) }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }
  const handleDrop = async (e: React.DragEvent) => { e.preventDefault(); const img = Array.from(e.dataTransfer.files).find(f=>f.type.startsWith('image/')); if (img) await processFile(img) }
  const removeImage = () => { setImage(null); setRestoredImage(null); setSubsectionValue(null) }

  const estimateGenerationDuration = (bytes: number) => { if (!bytes) return 5; const mb = bytes/(1024*1024); const base=4.5; const perMb=1.2; let est=base+mb*perMb; return Math.min(35, Math.max(4, est)) }

  useEffect(()=>{ let interval: any = null; if (isProcessing && generationStartTime) { interval = setInterval(()=>{ const elapsed=(Date.now()-generationStartTime)/1000; if (estimatedDuration>0) { const pct=Math.min(99,(elapsed/estimatedDuration)*100); setProgress(pct); const rem=Math.max(0, Math.ceil(estimatedDuration-elapsed)); setRemainingSeconds(rem) } }, 500) } else { if (!isProcessing) { setProgress(0); setRemainingSeconds(null); setGenerationStartTime(null) } } return ()=>{ if (interval) clearInterval(interval) } }, [isProcessing, generationStartTime, estimatedDuration])

  const handleRestore = async () => {
    if (!image) return
  // Re-check latest server credits before submitting
  try { const res = await fetch('/api/credits', { cache: 'no-store' }); if (res.ok) { const j = await res.json(); if (typeof j.credits === 'number') setCredits(j.credits); if ((j.credits ?? 0) < CREDIT_COST_PER_EDIT) { alert(`Insufficient credits! Need ${CREDIT_COST_PER_EDIT}.`); return } } } catch {}
    const est = estimateGenerationDuration(image.compressedSize || image.originalSize)
    setEstimatedDuration(est); setGenerationStartTime(Date.now()); setProgress(0); setRemainingSeconds(est); setIsProcessing(true)
    try {
      const formData = new FormData()
      // If subsection editor provided a composite for the first image, use that
      if (subsectionValue?.editedImageDataUrl) {
        try { const res = await fetch(subsectionValue.editedImageDataUrl); const blob = await res.blob(); const editedFile = new File([blob], `edited_${image.file.name.replace(/\.[^.]+$/, '')}.png`, { type: 'image/png' }); formData.append('image_0', editedFile) } catch { formData.append('image_0', image.file) }
      } else {
        formData.append('image_0', image.file)
      }
      formData.append('restorationType', restorationType)
      if (prompt.trim()) formData.append('prompt', prompt.trim())
      if (subsectionValue?.maskDataUrl) {
        formData.append('mask', subsectionValue.maskDataUrl)
        formData.append('shapes', JSON.stringify(subsectionValue.shapes))
        formData.append('imageNaturalWidth', subsectionValue.imageNaturalWidth.toString())
        formData.append('imageNaturalHeight', subsectionValue.imageNaturalHeight.toString())
      }
      const resp = await fetch('/api/restore-image', { method: 'POST', body: formData })
      if (!resp.ok) { const err = await resp.json().catch(()=>({})); throw new Error(err.error || `Failed: ${resp.status}`) }
  const json = await resp.json(); setRestoredImage(json.restoredImageUrl)
  // Refresh credits from server since deduction happens server-side
  try { const r = await fetch('/api/credits', { cache: 'no-store' }); if (r.ok) { const k = await r.json(); if (typeof k.credits === 'number') setCredits(k.credits) } } catch {}
  window.dispatchEvent(new Event('creditsUpdated'))
      setProgress(100); setRemainingSeconds(0)
    } catch (e) { alert(e instanceof Error ? e.message : 'Restoration failed') }
    finally { setIsProcessing(false) }
  }

  const downloadRestoredImage = () => { if (!restoredImage) return; const a = document.createElement('a'); a.href = restoredImage; a.download = 'restored-image.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a) }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="text-center flex-1">
            <h1 className="text-4xl font-bold text-foreground mb-2 text-balance">RestoreAI</h1>
            <p className="text-muted-foreground text-lg text-pretty">Welcome back, {user?.name}!</p>
            <p className="text-muted-foreground text-lg text-pretty">Restore old, damaged, or low-quality photos with AI-powered restoration.</p>
          </div>
          <UserProfile />
        </div>
        <div className="space-y-8">
          <CreditDisplay onPurchaseCredits={async ()=>{ setIsProcessingPayment(true); try { const res = await fetch('/api/checkout', { method: 'POST' }); const data = await res.json().catch(()=>null as any); if (!res.ok) throw new Error((data as any)?.error || (data as any)?.code || `HTTP ${res.status}`); if (data?.url) { window.location.href = data.url } else { throw new Error('No checkout URL returned') } } catch (e) { alert(e instanceof Error ? e.message : 'Unable to start checkout') } finally { setIsProcessingPayment(false) } }} />
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
                    onClick={(e) => { if (e.target === e.currentTarget) openFileDialog() }}
                  >
                    <h4 className="text-md font-semibold text-foreground mb-3">Image</h4>
                    {!image ? (
                      <>
                        <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground mb-2">Upload 1 image</p>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p>Max size: {formatFileSize(MAX_IMAGE_SIZE)}</p>
                          <p>Auto-compression enabled.</p>
                        </div>
                        <div className="mt-3">
                          <Button variant="outline" disabled={isCompressing} onClick={openFileDialog}>
                            {isCompressing ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>) : ('Choose File')}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
                          <div className="relative aspect-square rounded-lg overflow-hidden bg-muted group">
                            <Image src={image.data} alt="upload" fill className="object-cover" />
                            <button
                              onClick={(e) => { e.stopPropagation(); removeImage() }}
                              className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="h-3 w-3" />
                            </button>
                            {image.isCompressed && (
                              <div className="absolute bottom-1 left-1 bg-primary/80 text-primary-foreground rounded-full px-2 py-0.5 text-[10px]">Comp</div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 justify-center">
                          <Button size="sm" variant="outline" onClick={openFileDialog} disabled={isCompressing}>
                            {isCompressing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : 'Replace'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={removeImage}>Clear</Button>
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
                <CardContent className="p-5 space-y-3">
                  <h4 className="text-md font-semibold text-foreground">Restoration Type</h4>
                  <RadioGroup value={restorationType} onValueChange={setRestorationType} className="space-y-3">
                    {RESTORATION_TYPES.map((type) => (
                      <div key={type.value} className="flex items-start space-x-3">
                        <RadioGroupItem value={type.value} id={type.value} className="mt-1" />
                        <div className="flex-1">
                          <Label htmlFor={type.value} className="text-sm font-medium cursor-pointer">
                            {type.label}
                          </Label>
                          <p className="text-xs text-muted-foreground mt-1">{type.description}</p>
                        </div>
                      </div>
                    ))}
                  </RadioGroup>
                </CardContent>
              </Card>

              <Card className="border-border hover:border-primary/50 transition-colors">
                <CardContent className="p-5 space-y-3">
                  <h4 className="text-md font-semibold text-foreground">Optional instructions</h4>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g. focus on restoring the facial features, remove the yellowing, enhance the colors"
                    className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm resize-vertical focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-muted-foreground">Optional: Select a sub-section to restrict restoration to that area.</p>
                  {image && !isSelectingSubsection && (
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={()=> setIsSelectingSubsection(true)}>Select Area</Button>
                      {subsectionValue && (
                        <Button type="button" size="sm" variant="secondary" onClick={()=> setSubsectionValue(null)}>Clear Selection</Button>
                      )}
                    </div>
                  )}
                  {isSelectingSubsection && image && (
                    <div className="mt-4 space-y-2">
                      <SubsectionEditor
                        imageUrl={image.data}
                        initialValue={subsectionValue || undefined}
                        onCancel={()=> setIsSelectingSubsection(false)}
                        onConfirm={(val)=> { setSubsectionValue(val); setIsSelectingSubsection(false) }}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              {image && (
                <Card>
                  <CardContent className="p-6 space-y-4">
                    <div className="space-y-3">
                      <Button
                        onClick={handleRestore}
                        disabled={isProcessing || credits < CREDIT_COST_PER_EDIT || !image}
                        className="w-full"
                        size="lg"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />Restoring image...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4" />Restore Photo ({CREDIT_COST_PER_EDIT} credit)
                          </>
                        )}
                      </Button>
                    </div>
                    {credits < CREDIT_COST_PER_EDIT && (
                      <p className="text-sm text-destructive text-center">Insufficient credits. You need {CREDIT_COST_PER_EDIT} credit.</p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-6 sticky top-8 self-start">
              <Card className="min-h-[400px] flex flex-col">
                <CardContent className="p-6 flex-1 flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-foreground">Result</h3>
                    {restoredImage && image && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowBeforeAfter(!showBeforeAfter)}
                      >
                        {showBeforeAfter ? 'Show After' : 'Show Before'}
                      </Button>
                    )}
                  </div>
                  <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                    {restoredImage ? (
                      <Image 
                        src={showBeforeAfter && image ? image.data : restoredImage} 
                        alt={showBeforeAfter ? "Original image" : "Restored image"} 
                        fill 
                        className="object-cover" 
                      />
                    ) : isProcessing ? (
                      <div className="flex flex-col items-center gap-3 w-full px-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <Progress value={progress} className="w-full h-2" />
                        <p className="text-xs text-muted-foreground">
                          Restoring... {progress.toFixed(0)}%
                          {remainingSeconds !== null && remainingSeconds > 0
                            ? ` • ~${remainingSeconds}s remaining`
                            : remainingSeconds === 0
                            ? ' • Finalizing...'
                            : ''}
                        </p>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground text-center px-4">
                        {image ? 'Click Restore Photo to restore your image.' : 'Upload an image to begin.'}
                      </div>
                    )}
                  </div>
                  {restoredImage && (
                    <div className="mt-4 flex justify-center">
                      <Button onClick={downloadRestoredImage} variant="outline" size="sm">
                        <Download className="mr-2 h-4 w-4" />Download
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RestoreAIPage() {
  return (
    <ProtectedRoute>
      <RestoreAIContent />
    </ProtectedRoute>
  )
}
