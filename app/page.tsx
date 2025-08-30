"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Upload, Wand2, Download, Loader2, X, AlertCircle, CheckCircle } from "lucide-react"
import Image from "next/image"
import { CreditDisplay } from "@/components/credit-display"
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

export default function PhotoEditor() {
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([])
  const [editedImage, setEditedImage] = useState<string | null>(null)
  const [editPrompt, setEditPrompt] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [credits, setCredits] = useState(0)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isCompressing, setIsCompressing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCredits(getCredits())
  }, [])

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return

    setUploadError(null)
    setIsCompressing(true)

    try {
      const fileArray = Array.from(files)
      
      // First validate all files
      const validation = validateMultipleImages(fileArray)
      if (!validation.isValid) {
        setUploadError(validation.error || 'Validation failed')
        return
      }

      const processedImages: SelectedImage[] = []

      for (const file of validation.validFiles) {
        const result = await compressAndValidateImage(file)
        
        if (!result.isValid) {
          setUploadError(`Failed to process ${file.name}: ${result.error}`)
          return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
          const newImage: SelectedImage = {
            id: Math.random().toString(36).substr(2, 9),
            data: e.target?.result as string,
            file: result.compressedFile || file,
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            isCompressed: result.isCompressed
          }
          processedImages.push(newImage)
          
          // Update state when all images are processed
          if (processedImages.length === validation.validFiles.length) {
            setSelectedImages((prev) => [...prev, ...processedImages])
            setEditedImage(null)
          }
        }
        reader.readAsDataURL(result.compressedFile || file)
      }

    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to process images')
    } finally {
      setIsCompressing(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter((file) => file.type.startsWith("image/"))

    if (files.length === 0) return

    setUploadError(null)
    setIsCompressing(true)

    try {
      // Validate all dropped files
      const validation = validateMultipleImages(files)
      if (!validation.isValid) {
        setUploadError(validation.error || 'Validation failed')
        return
      }

      const processedImages: SelectedImage[] = []

      for (const file of validation.validFiles) {
        const result = await compressAndValidateImage(file)
        
        if (!result.isValid) {
          setUploadError(`Failed to process ${file.name}: ${result.error}`)
          return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
          const newImage: SelectedImage = {
            id: Math.random().toString(36).substr(2, 9),
            data: e.target?.result as string,
            file: result.compressedFile || file,
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            isCompressed: result.compressedFile !== undefined
          }
          processedImages.push(newImage)
          
          // Update state when all images are processed
          if (processedImages.length === validation.validFiles.length) {
            setSelectedImages((prev) => [...prev, ...processedImages])
            setEditedImage(null)
          }
        }
        reader.readAsDataURL(result.compressedFile || file)
      }

    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to process images')
    } finally {
      setIsCompressing(false)
    }
  }

  const removeImage = (id: string) => {
    setSelectedImages((prev) => prev.filter((img) => img.id !== id))
    setEditedImage(null)
  }

  const clearAllImages = () => {
    setSelectedImages([])
    setEditedImage(null)
    setUploadError(null)
  }

  const handlePurchaseCredits = async () => {
    setIsProcessingPayment(true)
    try {
      const response = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 100 }), // $1.00 in cents
      })

      const result = await response.json()

      if (result.success) {
        // In a real app, you'd handle Stripe payment confirmation here
        addCredits(CREDITS_PER_DOLLAR)
        setCredits(getCredits())
        // Dispatch custom event to update credit display
        window.dispatchEvent(new Event("creditsUpdated"))
        alert(`Successfully purchased ${CREDITS_PER_DOLLAR} credits!`)
      } else {
        alert("Payment failed. Please try again.")
      }
    } catch (error) {
      console.error("Payment error:", error)
      alert("Payment failed. Please try again.")
    } finally {
      setIsProcessingPayment(false)
    }
  }

  const handleEditImages = async () => {
    if (selectedImages.length === 0 || !editPrompt.trim()) return

    const totalCost = CREDIT_COST_PER_EDIT
    const currentCredits = getCredits()
    if (currentCredits < totalCost) {
      alert(
        `Insufficient credits! You need ${totalCost} credit to generate an edited image. Purchase more credits to continue.`,
      )
      return
    }

    setIsProcessing(true)
    try {
      const formData = new FormData()

      selectedImages.forEach((image, index) => {
        formData.append(`image_${index}`, image.file)
      })
      formData.append("prompt", editPrompt)

      const apiResponse = await fetch("/api/edit-image", {
        method: "POST",
        body: formData,
      })

      if (!apiResponse.ok) {
        const errorData = await apiResponse.json()
        throw new Error(errorData.error || `Failed to edit images: ${apiResponse.status}`)
      }

      const result = await apiResponse.json()
      setEditedImage(result.editedImageUrl)

      if (deductCredits(totalCost)) {
        setCredits(getCredits())
        window.dispatchEvent(new Event("creditsUpdated"))
      }
    } catch (error) {
      console.error("Error editing images:", error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to edit images. Please try again.'
      alert(errorMessage)
    } finally {
      setIsProcessing(false)
    }
  }

  const downloadEditedImage = () => {
    if (!editedImage) return
    const link = document.createElement("a")
    link.href = editedImage
    link.download = `ai-edited-image.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const getTotalSize = () => {
    return selectedImages.reduce((total, img) => total + (img.compressedSize || img.originalSize), 0)
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2 text-balance">AI Photoshop</h1>
          <p className="text-muted-foreground text-lg text-pretty">
            Upload multiple photos and describe your edit - get one AI-generated result
          </p>
        </div>

        <div className="space-y-8">
          <CreditDisplay onPurchaseCredits={handlePurchaseCredits} />

          {/* Upload Area */}
          <Card className="border-2 border-dashed border-border hover:border-primary/50 transition-colors">
            <CardContent className="p-8">
              <div
                className="text-center cursor-pointer"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Upload your photos</h3>
                <p className="text-muted-foreground mb-4">
                  Drag and drop multiple images - AI will create one edited result
                </p>
                <div className="text-xs text-muted-foreground mb-4 space-y-1">
                  <p>Max size per image: {formatFileSize(MAX_IMAGE_SIZE)}</p>
                  <p>Max total size: {formatFileSize(MAX_TOTAL_SIZE)}</p>
                  <p>Large images will be automatically compressed</p>
                </div>
                <Button variant="outline" className="mx-auto bg-transparent" disabled={isCompressing}>
                  {isCompressing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    'Choose Files'
                  )}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
            </CardContent>
          </Card>

          {/* Error Display */}
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

          {selectedImages.length > 0 && (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">Input Images ({selectedImages.length})</h3>
                    <p className="text-sm text-muted-foreground">
                      Total size: {formatFileSize(getTotalSize())}
                    </p>
                  </div>
                  <Button onClick={clearAllImages} variant="outline" size="sm">
                    Clear All
                  </Button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {selectedImages.map((image) => (
                    <div key={image.id} className="relative group">
                      <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                        <Image
                          src={image.data || "/placeholder.svg"}
                          alt="Selected image"
                          fill
                          className="object-cover"
                        />
                        <button
                          onClick={() => removeImage(image.id)}
                          className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        {image.isCompressed && (
                          <div className="absolute bottom-2 left-2 bg-primary/80 text-primary-foreground rounded-full px-2 py-1 text-xs">
                            Compressed
                          </div>
                        )}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          {image.isCompressed ? (
                            <>
                              <CheckCircle className="h-3 w-3 text-green-500" />
                              <span>{formatFileSize(image.compressedSize || 0)}</span>
                            </>
                          ) : (
                            <span>{formatFileSize(image.originalSize)}</span>
                          )}
                        </div>
                        {image.isCompressed && (
                          <div className="text-xs text-muted-foreground">
                            from {formatFileSize(image.originalSize)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Edit Controls */}
          {selectedImages.length > 0 && (
            <Card>
              <CardContent className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">Describe your edit</label>
                  <Textarea
                    placeholder="e.g., Combine these images into a collage, merge the subjects into one scene, create a panorama..."
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    className="min-h-[100px] resize-none"
                  />
                </div>
                <Button
                  onClick={handleEditImages}
                  disabled={!editPrompt.trim() || isProcessing || credits < CREDIT_COST_PER_EDIT}
                  className="w-full"
                  size="lg"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating edited image...
                    </>
                  ) : (
                    <>
                      <Wand2 className="mr-2 h-4 w-4" />
                      Generate Edited Image ({CREDIT_COST_PER_EDIT} credit)
                    </>
                  )}
                </Button>
                {credits < CREDIT_COST_PER_EDIT && (
                  <p className="text-sm text-destructive text-center">
                    Insufficient credits. You need {CREDIT_COST_PER_EDIT} credit to generate an edited image.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {selectedImages.length > 0 && editedImage && (
            <div className="space-y-6">
              <div className="flex justify-center">
                <Button onClick={downloadEditedImage} variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  Download Edited Image
                </Button>
              </div>

              <Card>
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-4 text-center">AI Generated Result</h3>
                  <div className="relative aspect-square max-w-2xl mx-auto rounded-lg overflow-hidden bg-muted">
                    <Image
                      src={editedImage || "/placeholder.svg"}
                      alt="AI edited image"
                      fill
                      className="object-cover"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
