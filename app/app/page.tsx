"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
// Textarea removed for virtual try-on flow
import { Upload, Wand2, Download, Loader2, X, AlertCircle, CheckCircle } from "lucide-react"
import Image from "next/image"
import { CreditDisplay } from "@/components/credit-display"
import UserProfile from "@/components/user-profile"
import ProtectedRoute from "@/components/protected-route"
import { useAuth } from "@/hooks/use-auth"
import { getCredits, deductCredits, addCredits, CREDIT_COST_PER_EDIT, CREDITS_PER_DOLLAR } from "@/lib/credits"
import { 
  validateMultipleImages, 
  formatFileSize,
  compressAndValidateImage,
  MAX_IMAGE_SIZE,
  MAX_TOTAL_SIZE 
} from "@/lib/image-utils"

interface SelectedImage {
  id: string
  data: string
  file: File
  originalSize: number
  compressedSize?: number
  isCompressed: boolean
}

interface EditedImage {
  id: string
  data: string
}

function PhotoEditorContent() {
  const { user } = useAuth()
  // Separate single-image slots for virtual try-on
  const [youImage, setYouImage] = useState<SelectedImage | null>(null)
  const [clothingImage, setClothingImage] = useState<SelectedImage | null>(null)
  const [editedImage, setEditedImage] = useState<string | null>(null)
  // prompt removed for virtual try-on flow
  const [isProcessing, setIsProcessing] = useState(false)
  const [credits, setCredits] = useState(0)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isCompressing, setIsCompressing] = useState(false)
  // Progress / ETA tracking for generation
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null)
  const [estimatedDuration, setEstimatedDuration] = useState<number>(0) // seconds
  const [progress, setProgress] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const fileInputYouRef = useRef<HTMLInputElement>(null)
  const fileInputClothingRef = useRef<HTMLInputElement>(null)
  // Clothing search
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [results, setResults] = useState<Array<{ title: string; image: string; url: string; brand?: string }>>([])
  const [importingIndex, setImportingIndex] = useState<number | null>(null)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return
    setIsSearching(true)
    setSearchError(null)
    try {
      const res = await fetch(`/api/search-clothing?q=${encodeURIComponent(searchQuery)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`)
      setResults(data.items || [])
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setIsSearching(false)
    }
  }

  const selectRemoteImage = async (imgUrl: string, title: string, index: number) => {
    try {
      setImportingIndex(index)
      const r = await fetch(`/api/fetch-image?url=${encodeURIComponent(imgUrl)}`)
      if (!r.ok) throw new Error('Proxy fetch failed')
      const b = await r.blob()
      const mime = b.type && b.type.startsWith('image/') ? b.type : 'image/jpeg'
      const file = new File([b], (title || 'clothing').replace(/[^a-z0-9]+/gi,'_').slice(0,40)+'.jpg', { type: mime })
      await processSingleFile(file, 'clothing')
      document.getElementById('clothing-upload-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch {
      // Fallback: attempt direct image load -> canvas -> blob
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const img = document.createElement('img') as HTMLImageElement
          img.crossOrigin = 'anonymous'
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas')
              canvas.width = img.naturalWidth
              canvas.height = img.naturalHeight
              const ctx = canvas.getContext('2d')
              if (!ctx) return reject(new Error('no ctx'))
              ctx.drawImage(img, 0, 0)
              resolve(canvas.toDataURL('image/jpeg', 0.92))
            } catch (e) {
              reject(e)
            }
          }
            
          img.onerror = () => reject(new Error('img load error'))
          img.src = imgUrl
        })
        const res = await fetch(dataUrl)
        const blob = await res.blob()
        const file = new File([blob], (title || 'clothing').replace(/[^a-z0-9]+/gi,'_').slice(0,40)+'.jpg', { type: 'image/jpeg' })
        await processSingleFile(file, 'clothing')
        document.getElementById('clothing-upload-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch {
        setUploadError('Failed to import remote image. Try another result or upload manually.')
      }
    } finally {
      setImportingIndex(null)
    }
  }

  useEffect(() => {
    setCredits(getCredits())
  }, [])

  const processSingleFile = async (file: File, slot: 'you' | 'clothing') => {
    setUploadError(null)
    setIsCompressing(true)
    try {
      const validation = validateMultipleImages([file])
      if (!validation.isValid || validation.validFiles.length === 0) {
        setUploadError(validation.error || 'Validation failed')
        return
      }
      const theFile = validation.validFiles[0]
      const result = await compressAndValidateImage(theFile)
      if (!result.isValid) {
        setUploadError(`Failed to process ${theFile.name}: ${result.error}`)
        return
      }
      await new Promise<void>((resolve) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          const newImage: SelectedImage = {
            id: Math.random().toString(36).substr(2, 9),
            data: e.target?.result as string,
            file: result.compressedFile || theFile,
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            isCompressed: result.isCompressed
          }
          if (slot === 'you') setYouImage(newImage)
          else setClothingImage(newImage)
          setEditedImage(null)
          resolve()
        }
        reader.readAsDataURL(result.compressedFile || theFile)
      })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to process image')
    } finally {
      setIsCompressing(false)
    }
  }

  const handleImageUpload = (slot: 'you' | 'clothing') => async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return
    await processSingleFile(files[0], slot)
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }
  const handleDrop = (slot: 'you' | 'clothing') => async (e: React.DragEvent) => {
    e.preventDefault()
    const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'))
    if (f) await processSingleFile(f, slot)
  }

  const removeImage = (slot: 'you' | 'clothing') => { if (slot === 'you') setYouImage(null); else setClothingImage(null); setEditedImage(null) }
  const clearAllImages = () => { setYouImage(null); setClothingImage(null); setEditedImage(null); setUploadError(null) }

  const handlePurchaseCredits = async () => {
    setIsProcessingPayment(true)
    try {
      const res = await fetch("/api/checkout", { method: "POST" })
      let data: any = null
      try { data = await res.json() } catch { /* ignore parse error */ }
      if (!res.ok) {
        console.error("Checkout start failed", { status: res.status, data })
        const msg = data?.error || data?.code || `HTTP ${res.status}`
        throw new Error(`Failed to start checkout: ${msg}`)
      }
      if (data?.url) { window.location.href = data.url as string; return }
      throw new Error(`No checkout URL returned${data?.id ? ` (session id: ${data.id})` : ""}`)
    } catch (e) {
  console.error(e)
  alert(e instanceof Error ? e.message : "Unable to start checkout. Please try again.")
    } finally { setIsProcessingPayment(false) }
  }

  const handleEditImages = async () => {
    if (!youImage || !clothingImage) return
    const totalCost = CREDIT_COST_PER_EDIT
    const currentCredits = getCredits()
    if (currentCredits < totalCost) { alert(`Insufficient credits! You need ${totalCost} credit to generate.`); return }
    // Estimate duration before starting call
    const totalSize = getTotalSize()
    const est = estimateGenerationDuration(totalSize)
    setEstimatedDuration(est)
    setGenerationStartTime(Date.now())
    setProgress(0)
    setRemainingSeconds(est)
    setIsProcessing(true)
    try {
      const formData = new FormData()
      formData.append('you_image', youImage.file)
      formData.append('clothing_image', clothingImage.file)
      formData.append('prompt', "")
      const apiResponse = await fetch("/api/edit-image", { method: "POST", body: formData })
      if (!apiResponse.ok) { const errorData = await apiResponse.json(); throw new Error(errorData.error || `Failed: ${apiResponse.status}`) }
      const result = await apiResponse.json(); setEditedImage(result.editedImageUrl)
      if (deductCredits(totalCost)) { setCredits(getCredits()); window.dispatchEvent(new Event("creditsUpdated")) }
      // Force completion state
      setProgress(100)
      setRemainingSeconds(0)
    } catch (error) { 
      console.error("Error editing images:", error); 
      alert(error instanceof Error ? error.message : 'Failed to edit images.') 
    }
    finally { 
      setIsProcessing(false) 
    }
  }

  const downloadEditedImage = () => { if (!editedImage) return; const link = document.createElement('a'); link.href = editedImage; link.download = 'ai-edited-image.png'; document.body.appendChild(link); link.click(); document.body.removeChild(link) }
  const getTotalSize = () => { const sizes = [youImage, clothingImage].filter(Boolean).map(img => (img as SelectedImage).compressedSize || (img as SelectedImage).originalSize); return sizes.reduce((a,b)=>a+b,0) }

  // Estimate generation duration (seconds) based on combined input size.
  // Previous heuristic was conservative (8s + 3s/MB, min 6, max 60) which made the timer feel slow.
  // New heuristic assumes higher effective throughput so the countdown starts lower & feels snappier:
  //   base 5s + 1.6s per MB, clamped to [4s, 45s].
  // For very tiny inputs (<0.5 MB) we just return the base. Adjust here if real timings shift.
  const estimateGenerationDuration = (totalBytes: number) => {
    if (!totalBytes) return 5
    const mb = totalBytes / (1024 * 1024)
    const base = 5
    const perMb = 1.6
    let est = base + mb * perMb
    if (mb < 0.5) est = base
    return Math.min(45, Math.max(4, est))
  }

  // Interval to update progress + remaining seconds
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    if (isProcessing && generationStartTime) {
      interval = setInterval(() => {
        const elapsed = (Date.now() - generationStartTime) / 1000
        if (estimatedDuration > 0) {
          const pct = Math.min(99, (elapsed / estimatedDuration) * 100) // keep at <100 until completion
          setProgress(pct)
          const remaining = Math.max(0, Math.ceil(estimatedDuration - elapsed))
          setRemainingSeconds(remaining)
        }
      }, 500)
    } else {
      // reset when not processing
      if (!isProcessing) {
        setProgress(0)
        setRemainingSeconds(null)
        setGenerationStartTime(null)
      }
    }
    return () => { if (interval) clearInterval(interval) }
  }, [isProcessing, generationStartTime, estimatedDuration])

  return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div className="text-center flex-1">
              <h1 className="text-4xl font-bold text-foreground mb-2 text-balance">TryMyClothes</h1>
              <p className="text-muted-foreground text-lg text-pretty">
                Welcome back, {user?.name}!
              </p>
              <p className="text-muted-foreground text-lg text-pretty">
                Upload your photo and a clothing item to try it on.
              </p>
            </div>
            <UserProfile />
          </div>
          <div className="space-y-8">
            <CreditDisplay onPurchaseCredits={handlePurchaseCredits} />
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
                <div className="flex flex-col lg:flex-row gap-4">
                  <Card className="border-border/70 bg-background/50 backdrop-blur-sm lg:w-60 shrink-0">
                    <CardContent className="p-4">
                      <h4 className="text-md font-semibold mb-2">Upload tips</h4>
                      <ul className="list-disc pl-4 space-y-1 text-xs text-muted-foreground">
                        <li>Find a frontal photo of you</li>
                        <li>Good lighting, neutral background</li>
                        <li>One person only (no group shots)</li>
                        <li>Lay-flat image of the garment</li>
                      </ul>
                    </CardContent>
                  </Card>
                  <div className="flex-1 space-y-4">
                  <Card id="clothing-upload-card" className="border-border hover:border-primary/50 transition-colors">
                    <CardContent className="p-5">
                      <div className="text-center cursor-pointer" onDragOver={handleDragOver} onDrop={handleDrop('you')} onClick={() => fileInputYouRef.current?.click()}>
                        <h4 className="text-md font-semibold text-foreground mb-3">You</h4>
                        {!youImage ? (
                          <>
                            <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                            <p className="text-sm text-muted-foreground mb-2">Upload your photo</p>
                            <div className="text-xs text-muted-foreground space-y-1"><p>Max size: {formatFileSize(MAX_IMAGE_SIZE)}</p></div>
                            <div className="mt-3">
                              <Button variant="outline" disabled={isCompressing}>{isCompressing ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>) : 'Choose File'}</Button>
                              <input ref={fileInputYouRef} type="file" accept="image/*" onChange={handleImageUpload('you')} className="hidden" />
                            </div>
                          </>
                        ) : (
                          <div className="relative">
                            <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                              <Image src={youImage.data} alt="You" fill className="object-cover" />
                              <button onClick={(e) => { e.stopPropagation(); removeImage('you') }} className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1"><X className="h-3 w-3" /></button>
                              {youImage.isCompressed && (<div className="absolute bottom-2 left-2 bg-primary/80 text-primary-foreground rounded-full px-2 py-1 text-xs">Compressed</div>)}
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1 justify-center">
                              {youImage.isCompressed ? (<><CheckCircle className="h-3 w-3 text-sky-500" /><span>{formatFileSize(youImage.compressedSize || 0)}</span><span className="text-muted-foreground">from {formatFileSize(youImage.originalSize)}</span></>) : (<span>{formatFileSize(youImage.originalSize)}</span>)}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border hover:border-primary/50 transition-colors">
                    <CardContent className="p-5">
                      <div className="text-center cursor-pointer" onDragOver={handleDragOver} onDrop={handleDrop('clothing')} onClick={() => fileInputClothingRef.current?.click()}>
                        <h4 className="text-md font-semibold text-foreground mb-3">Clothing</h4>
                        {!clothingImage ? (
                          <>
                            <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                            <p className="text-sm text-muted-foreground mb-2">Upload clothing image</p>
                            <div className="text-xs text-muted-foreground space-y-1"><p>Max size: {formatFileSize(MAX_IMAGE_SIZE)}</p></div>
                            <div className="mt-3">
                              <Button variant="outline" disabled={isCompressing}>{isCompressing ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>) : 'Choose File'}</Button>
                              <input ref={fileInputClothingRef} type="file" accept="image/*" onChange={handleImageUpload('clothing')} className="hidden" />
                            </div>
                          </>
                        ) : (
                          <div className="relative">
                            <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                              <Image src={clothingImage.data} alt="Clothing" fill className="object-cover" />
                              <button onClick={(e) => { e.stopPropagation(); removeImage('clothing') }} className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1"><X className="h-3 w-3" /></button>
                              {clothingImage.isCompressed && (<div className="absolute bottom-2 left-2 bg-primary/80 text-primary-foreground rounded-full px-2 py-1 text-xs">Compressed</div>)}
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1 justify-center">
                              {clothingImage.isCompressed ? (<><CheckCircle className="h-3 w-3 text-sky-500" /><span>{formatFileSize(clothingImage.compressedSize || 0)}</span><span className="text-muted-foreground">from {formatFileSize(clothingImage.originalSize)}</span></>) : (<span>{formatFileSize(clothingImage.originalSize)}</span>)}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                  </div>
                </div>
                <Card className="border-border">
                  <CardContent className="p-5 space-y-4">
                    <h4 className="text-md font-semibold">Find Clothing</h4>
                    <form onSubmit={handleSearch} className="flex gap-2">
                      <input type="text" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="slim-fit black turtleneck sweater" className="flex-1 px-3 py-2 rounded-md border bg-background text-sm" />
                      <Button type="submit" disabled={!searchQuery.trim() || isSearching} variant="secondary">{isSearching ? (<><Loader2 className="h-4 w-4 animate-spin mr-2"/>Searching</>) : 'Search'}</Button>
                    </form>
                    {searchError && <p className="text-xs text-destructive">{searchError}</p>}
                    {results.length > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        {results.map((r,i)=>(
                          <button key={i} type="button" onClick={()=>selectRemoteImage((r as any).highResImage || r.image, r.title, i)} disabled={importingIndex !== null} className="group relative border rounded-lg overflow-hidden bg-muted focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={r.image} alt={r.title} className="w-full h-28 object-cover group-hover:scale-105 transition-transform" />
                            <div className={`absolute inset-0 flex items-center justify-center text-white text-xs transition-opacity ${importingIndex===i ? 'bg-black/60 opacity-100' : 'bg-black/40 opacity-0 group-hover:opacity-100'}`}>{importingIndex===i ? 'Importing...' : 'Use'}</div>
                          </button>
                        ))}
                      </div>
                    )}
                    {!isSearching && results.length === 0 && (searchQuery.trim() ? <p className="text-xs text-muted-foreground">No matches. Refine with a color & category.</p> : <p className="text-xs text-muted-foreground">Describe a garment to search real product photos.</p>)}
                    {isSearching && <p className="text-xs text-muted-foreground">Searching...</p>}
                  </CardContent>
                </Card>
                {(youImage && clothingImage) && (
                  <Card>
                    <CardContent className="p-6 space-y-4">
                      <div className="space-y-3">
                        <Button onClick={handleEditImages} disabled={isProcessing || credits < CREDIT_COST_PER_EDIT} className="w-full" size="lg">
                          {isProcessing ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating image...</>) : (<><Wand2 className="mr-2 h-4 w-4" />Try On Outfit ({CREDIT_COST_PER_EDIT} credit)</>)}
                        </Button>
                        {isProcessing && (
                          <div className="space-y-1" aria-live="polite">
                            <Progress value={progress} className="h-2" />
                            <p className="text-xs text-muted-foreground text-center">
                              {progress.toFixed(0)}% {remainingSeconds !== null && remainingSeconds > 0 ? `• ~${remainingSeconds}s left` : remainingSeconds === 0 ? '• Finalizing...' : ''}
                            </p>
                          </div>
                        )}
                      </div>
                      {credits < CREDIT_COST_PER_EDIT && (<p className="text-sm text-destructive text-center">Insufficient credits. You need {CREDIT_COST_PER_EDIT} credit.</p>)}
                    </CardContent>
                  </Card>
                )}
              </div>
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
                            Generating... {progress.toFixed(0)}%{remainingSeconds !== null && remainingSeconds > 0 ? ` • ~${remainingSeconds}s remaining` : remainingSeconds === 0 ? ' • Finalizing...' : ''}
                          </p>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground text-center px-4">{youImage && clothingImage ? 'Click "Try On Outfit" to generate the result.' : 'Upload both images to see the virtual try-on result here.'}</div>
                      )}
                    </div>
                    {editedImage && (
                      <div className="mt-4 flex justify-center">
                        <Button onClick={downloadEditedImage} variant="outline" size="sm"><Download className="mr-2 h-4 w-4" />Download</Button>
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

export default function PhotoEditor() {
  return (
    <ProtectedRoute>
      <PhotoEditorContent />
    </ProtectedRoute>
  )
}
