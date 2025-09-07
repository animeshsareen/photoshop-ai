"use client"

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Upload, Wand2, Download, Loader2, X, AlertCircle, CheckCircle } from 'lucide-react'
import Image from 'next/image'
import { CreditDisplay } from '@/components/credit-display'
import UserProfile from '@/components/user-profile'
import ProtectedRoute from '@/components/protected-route'
import { useAuth } from '@/hooks/use-auth'
import { getCredits, deductCredits, CREDIT_COST_PER_EDIT } from '@/lib/credits'
import { validateMultipleImages, formatFileSize, compressAndValidateImage, MAX_IMAGE_SIZE } from '@/lib/image-utils'
import SubsectionEditor, { SubsectionEditorValue } from '@/components/subsection-editor'

interface SelectedImage {
  id: string
  data: string
  file: File
  originalSize: number
  compressedSize?: number
  isCompressed: boolean
}

function FreeEditContent() {
  const { user } = useAuth()
  // Support multiple images now
  const [images, setImages] = useState<SelectedImage[]>([])
  const [editedImage, setEditedImage] = useState<string | null>(null)
  const [prompt, setPrompt] = useState("")
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
  const fileInputYouRef = useRef<HTMLInputElement>(null)
  const MAX_IMAGES = 4

  // Ensure file dialog opens only once per user action
  const openFileDialog = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    fileInputYouRef.current?.click()
  }

  useEffect(() => { setCredits(getCredits()) }, [])

  const processFiles = async (fileList: File[] | FileList) => {
    setUploadError(null)
    setIsCompressing(true)
    try {
      const incoming = Array.from(fileList).filter(f => f.type.startsWith('image/'))
      // Deduplicate against already added images (by name + lastModified + size)
      const existingKeys = new Set(images.map(i => `${i.file.name}-${(i.file as any).lastModified}-${i.file.size}`))
      const uniqueIncoming = incoming.filter(f => !existingKeys.has(`${f.name}-${(f as any).lastModified}-${f.size}`))
      if (!uniqueIncoming.length) { setUploadError('No new images to add.'); return }
      const remainingSlots = MAX_IMAGES - images.length
      if (remainingSlots <= 0) { setUploadError(`Maximum ${MAX_IMAGES} images allowed.`); return }
      const sliced = uniqueIncoming.slice(0, remainingSlots)
      const validation = validateMultipleImages(sliced)
      if (!validation.isValid || validation.validFiles.length === 0) { setUploadError(validation.error || 'Validation failed'); return }
      const processed: SelectedImage[] = []
      for (const theFile of validation.validFiles) {
        const result = await compressAndValidateImage(theFile)
        if (!result.isValid) { setUploadError(`Failed to process ${theFile.name}: ${result.error}`); continue }
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
          const reader = new FileReader()
            reader.onload = (e) => {
              processed.push({
                id: Math.random().toString(36).substr(2,9),
                data: e.target?.result as string,
                file: result.compressedFile || theFile,
                originalSize: result.originalSize,
                compressedSize: result.compressedSize,
                isCompressed: result.isCompressed
              })
              resolve()
            }
          reader.readAsDataURL(result.compressedFile || theFile)
        })
      }
      if (processed.length) {
        setImages(prev => [...prev, ...processed])
        setEditedImage(null)
      }
    } catch (e) { setUploadError(e instanceof Error ? e.message : 'Failed to process images') } finally { setIsCompressing(false) }
    // Always reset the file input so selecting the same file again triggers onChange
    if (fileInputYouRef.current) fileInputYouRef.current.value = ''
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => { const files = e.target.files; if (!files || files.length === 0) return; await processFiles(files) }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }
  const handleDrop = async (e: React.DragEvent) => { e.preventDefault(); const imgs = Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith('image/')); if (imgs.length) await processFiles(imgs) }
  const removeImage = (id: string) => { setImages(prev => prev.filter(img=>img.id!==id)); setEditedImage(null) }
  const clearAll = () => { 
    setImages([])
    setEditedImage(null)
    setPrompt("") // also clear prompt when all images removed
  }

  const handlePurchaseCredits = async () => {
    setIsProcessingPayment(true)
    try {
      const res = await fetch('/api/checkout', { method: 'POST' })
      let data: any = null; try { data = await res.json() } catch {}
      if (!res.ok) { const msg = data?.error || data?.code || `HTTP ${res.status}`; throw new Error(msg) }
      if (data?.url) { window.location.href = data.url; return }
      throw new Error('No checkout URL returned')
    } catch (e) { alert(e instanceof Error ? e.message : 'Unable to start checkout') } finally { setIsProcessingPayment(false) }
  }

  const getTotalSize = () => images.reduce((acc, img) => acc + (img.compressedSize || img.originalSize), 0)
  const estimateGenerationDuration = (totalBytes: number) => { if (!totalBytes) return 5; const mb = totalBytes / (1024*1024); const base=5; const perMb=1.6; let est=base+mb*perMb; if (mb<0.5) est=base; return Math.min(45, Math.max(4, est)) }

  useEffect(()=>{ let interval: any = null; if (isProcessing && generationStartTime) { interval = setInterval(()=>{ const elapsed = (Date.now()-generationStartTime)/1000; if (estimatedDuration>0) { const pct = Math.min(99,(elapsed/estimatedDuration)*100); setProgress(pct); const rem = Math.max(0, Math.ceil(estimatedDuration - elapsed)); setRemainingSeconds(rem) } }, 500) } else { if (!isProcessing) { setProgress(0); setRemainingSeconds(null); setGenerationStartTime(null) } } return ()=>{ if (interval) clearInterval(interval) } }, [isProcessing, generationStartTime, estimatedDuration])

  const handleEditImages = async () => {
  if (images.length === 0) return
    const totalCost = CREDIT_COST_PER_EDIT
    if (getCredits() < totalCost) { alert(`Insufficient credits! Need ${totalCost}.`); return }
    const totalSize = getTotalSize()
    const est = estimateGenerationDuration(totalSize)
    setEstimatedDuration(est); setGenerationStartTime(Date.now()); setProgress(0); setRemainingSeconds(est); setIsProcessing(true)
    try {
  const formData = new FormData()
  // If subsection edited composite provided for first image, replace that image with edited version
  for (let i=0;i<images.length;i++) {
    const base = images[i];
    if (i===0 && subsectionValue?.editedImageDataUrl) {
      try {
        const res = await fetch(subsectionValue.editedImageDataUrl);
        const blob = await res.blob();
        const editedFile = new File([blob], `edited_${base.file.name.replace(/\.[^.]+$/, '')}.png`, { type: 'image/png' });
        formData.append(`image_${i}`, editedFile);
      } catch {
        formData.append(`image_${i}`, base.file);
      }
    } else {
      formData.append(`image_${i}`, base.file);
    }
  }
  formData.append('prompt', prompt)
  if (subsectionValue?.maskDataUrl) {
    formData.append('mask', subsectionValue.maskDataUrl)
    formData.append('shapes', JSON.stringify(subsectionValue.shapes))
    formData.append('imageNaturalWidth', subsectionValue.imageNaturalWidth.toString())
    formData.append('imageNaturalHeight', subsectionValue.imageNaturalHeight.toString())
  }
      const resp = await fetch('/api/edit-image', { method:'POST', body: formData })
      if (!resp.ok) { const err = await resp.json().catch(()=>({})); throw new Error(err.error || `Failed: ${resp.status}`) }
      const json = await resp.json(); setEditedImage(json.editedImageUrl); if (deductCredits(totalCost)) { setCredits(getCredits()); window.dispatchEvent(new Event('creditsUpdated')) }
      setProgress(100); setRemainingSeconds(0)
    } catch (e) { alert(e instanceof Error ? e.message : 'Edit failed') } finally { setIsProcessing(false) }
  }

  const downloadEditedImage = () => { if (!editedImage) return; const a = document.createElement('a'); a.href = editedImage; a.download = 'ai-edited-image.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a) }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="text-center flex-1">
            <h1 className="text-4xl font-bold text-foreground mb-2 text-balance">FreeEdit</h1>
            <p className="text-muted-foreground text-lg text-pretty">Welcome back, {user?.name}!</p>
            <p className="text-muted-forefround text-lg text-pretty">Upload images and describe your edits. </p>
          </div>
          <UserProfile />
        </div>
        <div className="space-y-8">
          <CreditDisplay onPurchaseCredits={handlePurchaseCredits} />
          <div className="grid lg:grid-cols-2 gap-8 items-start">
            {/* Left column: Inputs & generate button */}
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
              <Card id="you-upload-card" className="border-border hover:border-primary/50 transition-colors">
                <CardContent className="p-5">
                  <div
                    className="text-center cursor-pointer"
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    // Only trigger dialog when clicking bare background (not buttons)
                    onClick={(e) => { if (e.target === e.currentTarget) openFileDialog() }}
                  >
                    <h4 className="text-md font-semibold text-foreground mb-3">Images</h4>
                    {images.length === 0 ? (
                      <>
                        <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground mb-2">Upload up to {MAX_IMAGES} images</p>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p>Max size: {formatFileSize(MAX_IMAGE_SIZE)}/image</p>
                          <p>Auto-compression enabled.</p>
                        </div>
                        <div className="mt-3">
                          <Button variant="outline" disabled={isCompressing} onClick={openFileDialog}>
                            {isCompressing ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...
                              </>
                            ) : (
                              'Choose File'
                            )}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {images.map(img => (
                            <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden bg-muted group">
                              <Image src={img.data} alt="upload" fill className="object-cover" />
                              <button
                                onClick={(e) => { e.stopPropagation(); removeImage(img.id) }}
                                className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="h-3 w-3" />
                              </button>
                              {img.isCompressed && (
                                <div className="absolute bottom-1 left-1 bg-primary/80 text-primary-foreground rounded-full px-2 py-0.5 text-[10px]">
                                  Comp
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2 justify-center">
                          {images.length < MAX_IMAGES && (
                            <Button size="sm" variant="outline" onClick={openFileDialog} disabled={isCompressing}>
                              {isCompressing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : '+'} Add
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={clearAll}>Clear All</Button>
                        </div>
                        <div className="text-xs text-muted-foreground text-center">
                          Total size: {formatFileSize(getTotalSize())}
                        </div>
                      </div>
                    )}
                    {/* Single persistent hidden input */}
                    <input
                      ref={fileInputYouRef}
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border hover:border-primary/50 transition-colors">
                <CardContent className="p-5 space-y-3">
                  <h4 className="text-md font-semibold text-foreground">Describe your edit</h4>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g. change shirt to a red leather jacket with cinematic lighting"
                    className="w-full min-h-[140px] rounded-md border bg-background px-3 py-2 text-sm resize-vertical focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-muted-foreground">Optional: Select a sub-section of your image to focus edits.</p>
                  {images.length > 0 && !isSelectingSubsection && (
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={()=> setIsSelectingSubsection(true)}>Markdown</Button>
                      {subsectionValue && (
                        <Button type="button" size="sm" variant="secondary" onClick={()=> setSubsectionValue(null)}>Clear Selection</Button>
                      )}
                    </div>
                  )}
                  {isSelectingSubsection && images[0] && (
                    <div className="mt-4 space-y-2">
                      <SubsectionEditor
                        imageUrl={images[0].data}
                        initialValue={subsectionValue || undefined}
                        onCancel={()=> setIsSelectingSubsection(false)}
                        onConfirm={(val)=> { setSubsectionValue(val); setIsSelectingSubsection(false) }}
                      />
                    </div>
                  )}
                  {subsectionValue && !isSelectingSubsection && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">Edits confirmed.</p>
                  )}
                </CardContent>
              </Card>
              {images.length > 0 && (
                <Card>
                  <CardContent className="p-6 space-y-4">
                    <div className="space-y-3">
                      <Button
                        onClick={handleEditImages}
                        disabled={
                          isProcessing || credits < CREDIT_COST_PER_EDIT || !prompt.trim() || images.length === 0
                        }
                        className="w-full"
                        size="lg"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating image...
                          </>
                        ) : (
                          <>
                            <Wand2 className="mr-2 h-4 w-4" />Generate ({CREDIT_COST_PER_EDIT} credit)
                          </>
                        )}
                      </Button>
                      {/* Progress indicator removed here; only shown in Result card now */}
                    </div>
                    {credits < CREDIT_COST_PER_EDIT && (
                      <p className="text-sm text-destructive text-center">
                        Insufficient credits. You need {CREDIT_COST_PER_EDIT} credit.
                      </p>
                    )}
                    {!prompt.trim() && !isProcessing && (
                      <p className="text-xs text-muted-foreground text-center">
                        Enter a prompt to enable generation.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
            {/* Right column: Result */}
            <div className="space-y-6 sticky top-8 self-start">
              <Card className="min-h-[400px] flex flex-col">
                <CardContent className="p-6 flex-1 flex flex-col">
                  <h3 className="text-lg font-semibold text-foreground mb-4 text-center">Result</h3>
                  <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                    {editedImage ? (
                      <Image src={editedImage} alt="AI edited image" fill className="object-cover" />
                    ) : isProcessing ? (
                      <div className="flex flex-col items-center gap-3 w-full px-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <Progress value={progress} className="w-full h-2" />
                        <p className="text-xs text-muted-foreground">
                          Generating... {progress.toFixed(0)}%
                          {remainingSeconds !== null && remainingSeconds > 0
                            ? ` • ~${remainingSeconds}s remaining`
                            : remainingSeconds === 0
                            ? ' • Finalizing...'
                            : ''}
                        </p>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground text-center px-4">
                        {images.length > 0
                          ? 'Add a prompt and click Generate.'
                          : 'Upload images to begin.'}
                      </div>
                    )}
                  </div>
                  {editedImage && (
                    <div className="mt-4 flex justify-center">
                      <Button onClick={downloadEditedImage} variant="outline" size="sm">
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

export default function FreeEditPage() {
  return (
    <ProtectedRoute>
      <FreeEditContent />
    </ProtectedRoute>
  )
}
