// Client-safe image utility functions
import imageCompression from 'browser-image-compression';

export const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
export const MAX_TOTAL_SIZE = 10 * 1024 * 1024; // 10MB

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function validateImageFile(file: File): { isValid: boolean; error?: string } {
  if (!file.type.startsWith('image/')) {
    return { isValid: false, error: 'File must be an image' };
  }
  
  return { isValid: true };
}

export async function compressImageIfNeeded(file: File): Promise<{
  compressedFile: File | undefined;
  originalSize: number;
  compressedSize: number;
  isCompressed: boolean;
}> {
  const originalSize = file.size;
  
  // Only compress if image is larger than 4MB
  if (file.size <= MAX_IMAGE_SIZE) {
    return {
      compressedFile: undefined,
      originalSize,
      compressedSize: originalSize,
      isCompressed: false
    };
  }

  try {
    const options = {
      maxSizeMB: 4,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: file.type
    };

    const compressedFile = await imageCompression(file, options);
    
    return {
      compressedFile,
      originalSize,
      compressedSize: compressedFile.size,
      isCompressed: true
    };
  } catch (error) {
    console.error('Image compression failed:', error);
    // Return original file if compression fails
    return {
      compressedFile: undefined,
      originalSize,
      compressedSize: originalSize,
      isCompressed: false
    };
  }
}

export async function compressAndValidateImage(file: File): Promise<{
  isValid: boolean;
  error?: string;
  compressedFile?: File;
  originalSize: number;
  compressedSize: number;
  isCompressed: boolean;
}> {
  // First validate the file type
  const validation = validateImageFile(file);
  if (!validation.isValid) {
    return { ...validation, originalSize: file.size, compressedSize: file.size, isCompressed: false };
  }

  // Compress if needed
  const compressionResult = await compressImageIfNeeded(file);
  
  return {
    isValid: true,
    compressedFile: compressionResult.compressedFile,
    originalSize: compressionResult.originalSize,
    compressedSize: compressionResult.compressedSize,
    isCompressed: compressionResult.isCompressed
  };
}

export function validateMultipleImages(files: File[]): { 
  isValid: boolean; 
  error?: string; 
  validFiles: File[];
  totalSize: number;
} {
  if (files.length === 0) {
    return { isValid: false, error: 'No files selected', validFiles: [], totalSize: 0 };
  }
  
  let totalSize = 0;
  const validFiles: File[] = [];
  
  for (const file of files) {
    const validation = validateImageFile(file);
    if (!validation.isValid) {
      return { isValid: false, error: validation.error, validFiles: [], totalSize: 0 };
    }
    
    totalSize += file.size;
    validFiles.push(file);
  }
  
  // Note: We don't check total size here since compression will handle large files
  // The actual size check will happen after compression
  
  return { isValid: true, validFiles, totalSize };
}