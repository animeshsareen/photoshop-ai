import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Set environment variables before importing the module
process.env.GEMINI_API_KEY = 'test_gemini_key'

// Mock the auth function
vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { email: 'test@example.com' }
  })
}))

// Mock Supabase
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({
    data: { credits: 10 },
    error: null
  }),
  update: vi.fn().mockReturnThis(),
  mockResolvedValue: vi.fn().mockResolvedValue({ error: null })
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: vi.fn(() => mockSupabase)
}))

// Mock GoogleGenerativeAI
const mockGenerateContent = vi.fn().mockResolvedValue({
  response: {
    candidates: [{
      content: {
        parts: [{
          inlineData: {
            data: 'base64encodedimage',
            mimeType: 'image/png'
          }
        }]
      }
    }]
  }
})

const mockModel = {
  generateContent: mockGenerateContent
}

const mockGenAI = {
  getGenerativeModel: vi.fn().mockReturnValue(mockModel)
}

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => mockGenAI)
}))

// Mock fs and path
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(Buffer.from('mock image data')),
  unlinkSync: vi.fn()
}))

vi.mock('path', () => ({
  parse: vi.fn().mockReturnValue({ name: 'test', ext: '.jpg' }),
  join: vi.fn().mockReturnValue('/tmp/test.jpg')
}))

// Mock sharp
vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(undefined),
    rotate: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('compressed image'))
  })
}))

// Set environment variables
process.env.GEMINI_API_KEY = 'test_gemini_key'

describe('ThumbnailStudio API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset Supabase mocks
    mockSupabase.from.mockReturnThis()
    mockSupabase.select.mockReturnThis()
    mockSupabase.eq.mockReturnThis()
    mockSupabase.single.mockResolvedValue({
      data: { credits: 10 },
      error: null
    })
    mockSupabase.update.mockReturnThis()
    mockSupabase.mockResolvedValue.mockResolvedValue({ error: null })
  })

  it('should return error when no prompt is provided', async () => {
    const formData = new FormData()
    formData.append('image_0', new File(['test'], 'test.jpg', { type: 'image/jpeg' }))
    
    const request = new NextRequest('http://localhost/api/thumbnail-studio', {
      method: 'POST',
      body: formData
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Prompt is required')
  })

  it('should return error when no images are provided', async () => {
    const formData = new FormData()
    formData.append('prompt', 'Create a thumbnail')
    
    const request = new NextRequest('http://localhost/api/thumbnail-studio', {
      method: 'POST',
      body: formData
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('At least one image is required')
  })

  it('should return error when user has insufficient credits', async () => {
    // Mock user with no credits
    mockSupabase.single.mockResolvedValue({
      data: { credits: 0 },
      error: null
    })

    const formData = new FormData()
    formData.append('prompt', 'Create a thumbnail')
    formData.append('image_0', new File(['test'], 'test.jpg', { type: 'image/jpeg' }))
    
    const request = new NextRequest('http://localhost/api/thumbnail-studio', {
      method: 'POST',
      body: formData
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(402)
    expect(data.error).toBe('Insufficient credits')
  })

  it('should successfully generate thumbnail with valid inputs', async () => {
    const formData = new FormData()
    formData.append('prompt', 'Create a bold YouTube thumbnail')
    formData.append('mainTitle', 'How to Make Money Online')
    formData.append('image_0', new File(['test'], 'test.jpg', { type: 'image/jpeg' }))
    
    const request = new NextRequest('http://localhost/api/thumbnail-studio', {
      method: 'POST',
      body: formData
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.thumbnailUrl).toContain('data:image/png;base64,')
    expect(data.creditsUsed).toBe(1)
    expect(data.remainingCredits).toBe(9)
    expect(mockGenerateContent).toHaveBeenCalled()
  })

  it('should handle main title in the prompt', async () => {
    const formData = new FormData()
    formData.append('prompt', 'Create a thumbnail')
    formData.append('mainTitle', 'Test Title')
    formData.append('image_0', new File(['test'], 'test.jpg', { type: 'image/jpeg' }))
    
    const request = new NextRequest('http://localhost/api/thumbnail-studio', {
      method: 'POST',
      body: formData
    })

    await POST(request)

    // Check that the generateContent was called with a prompt that includes the main title
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining('Test Title')
      ])
    )
  })

  it('should return error when Gemini API key is not configured', async () => {
    // Temporarily remove the API key
    const originalKey = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY

    const formData = new FormData()
    formData.append('prompt', 'Create a thumbnail')
    formData.append('image_0', new File(['test'], 'test.jpg', { type: 'image/jpeg' }))
    
    const request = new NextRequest('http://localhost/api/thumbnail-studio', {
      method: 'POST',
      body: formData
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('GEMINI_API_KEY environment variable is not configured')

    // Restore the API key
    process.env.GEMINI_API_KEY = originalKey
  })
})
