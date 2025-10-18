import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// Ensure the token exists before the route module is imported
process.env.REPLICATE_API_TOKEN = "test_replicate_token"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { email: "test@example.com" },
  }),
}))

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({
    data: { credits: 10 },
    error: null,
  }),
  update: vi.fn().mockReturnThis(),
  mockResolvedValue: vi.fn().mockResolvedValue({ error: null }),
}

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => mockSupabase),
}))

const mockRun = vi.fn().mockResolvedValue("data:image/png;base64,base64encodedimage")
const mockReplicateInstance = { run: mockRun }
const mockReplicateConstructor = vi.fn().mockImplementation(() => mockReplicateInstance)

vi.mock("replicate", () => ({
  default: mockReplicateConstructor,
}))

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(Buffer.from("mock image data")),
  unlinkSync: vi.fn(),
}))

vi.mock("path", () => ({
  parse: vi.fn().mockReturnValue({ name: "test", ext: ".jpg" }),
  join: vi.fn().mockReturnValue("/tmp/test.jpg"),
}))

vi.mock("sharp", () => ({
  default: vi.fn().mockReturnValue({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(undefined),
    rotate: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("compressed image")),
  }),
}))

let POST: typeof import("../app/api/restore-image/route").POST

async function loadRoute() {
  vi.resetModules()
  const route = await import("../app/api/restore-image/route")
  POST = route.POST
}

beforeEach(async () => {
  vi.clearAllMocks()
  mockSupabase.from.mockReturnThis()
  mockSupabase.select.mockReturnThis()
  mockSupabase.eq.mockReturnThis()
  mockSupabase.single.mockResolvedValue({
    data: { credits: 10 },
    error: null,
  })
  mockSupabase.update.mockReturnThis()
  mockSupabase.mockResolvedValue.mockResolvedValue({ error: null })
  process.env.REPLICATE_API_TOKEN = "test_replicate_token"
  mockRun.mockResolvedValue("data:image/png;base64,base64encodedimage")
  await loadRoute()
})

describe("RestoreAI API", () => {
  it("should return error when no images are provided", async () => {
    const formData = new FormData()

    const request = new NextRequest("http://localhost/api/restore-image", {
      method: "POST",
      body: formData,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe("At least one image is required")
  })

  it("should return error when user has insufficient credits", async () => {
    mockSupabase.single.mockResolvedValue({
      data: { credits: 0 },
      error: null,
    })

    await loadRoute()

    const formData = new FormData()
    formData.append("image_0", new File(["test"], "test.jpg", { type: "image/jpeg" }))

    const request = new NextRequest("http://localhost/api/restore-image", {
      method: "POST",
      body: formData,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(402)
    expect(data.error).toBe("Insufficient credits")
  })

  it("should successfully restore image with valid inputs", async () => {
    const formData = new FormData()
    formData.append("image_0", new File(["test"], "test.jpg", { type: "image/jpeg" }))
    formData.append("restorationType", "general")

    const request = new NextRequest("http://localhost/api/restore-image", {
      method: "POST",
      body: formData,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.restoredImageUrl).toContain("data:image/png;base64,")
    expect(data.creditsUsed).toBe(1)
    expect(data.remainingCredits).toBe(9)
    expect(mockRun).toHaveBeenCalled()
  })

  it("should handle different restoration types", async () => {
    const restorationTypes = ["general", "heavy_damage", "color_enhancement", "noise_reduction"]

    for (const type of restorationTypes) {
      const formData = new FormData()
      formData.append("image_0", new File(["test"], "test.jpg", { type: "image/jpeg" }))
      formData.append("restorationType", type)

      const request = new NextRequest("http://localhost/api/restore-image", {
        method: "POST",
        body: formData,
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.restoredImageUrl).toContain("data:image/png;base64,")
    }
  })

  it("should handle user prompt in restoration", async () => {
    const formData = new FormData()
    formData.append("image_0", new File(["test"], "test.jpg", { type: "image/jpeg" }))
    formData.append("restorationType", "general")
    formData.append("prompt", "Focus on restoring the facial features and removing scratches")

    const request = new NextRequest("http://localhost/api/restore-image", {
      method: "POST",
      body: formData,
    })

    await POST(request)

    const runArgs = mockRun.mock.calls[0]
    expect(runArgs[0]).toBe("flux-kontext-apps/restore-image")
    expect(runArgs[1].input.prompt).toContain("Focus on restoring the facial features and removing scratches")
  })

  it("should use default restoration type when not provided", async () => {
    const formData = new FormData()
    formData.append("image_0", new File(["test"], "test.jpg", { type: "image/jpeg" }))

    const request = new NextRequest("http://localhost/api/restore-image", {
      method: "POST",
      body: formData,
    })

    await POST(request)

    const runArgs = mockRun.mock.calls[0]
    expect(runArgs[1].input.prompt).toContain("Restoration type: general")
  })

  it("should return error when Replicate API token is not configured", async () => {
    delete process.env.REPLICATE_API_TOKEN
    await loadRoute()

    const formData = new FormData()
    formData.append("image_0", new File(["test"], "test.jpg", { type: "image/jpeg" }))

    const request = new NextRequest("http://localhost/api/restore-image", {
      method: "POST",
      body: formData,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe("Replicate client not configured")
  })

  it("should refund credits when Replicate call fails", async () => {
    mockRun.mockRejectedValue(new Error("API Error"))
    await loadRoute()

    const formData = new FormData()
    formData.append("image_0", new File(["test"], "test.jpg", { type: "image/jpeg" }))

    const request = new NextRequest("http://localhost/api/restore-image", {
      method: "POST",
      body: formData,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe("Failed to restore image")
    expect(mockSupabase.update).toHaveBeenCalledWith({ credits: 10 })
  })

  it("should handle mobile optimization for PNG images", async () => {
    const formData = new FormData()
    formData.append("image_0", new File(["test"], "test.jpg", { type: "image/jpeg" }))

    const request = new NextRequest("http://localhost/api/restore-image?mobile=1", {
      method: "POST",
      body: formData,
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)",
      },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.restoredImageUrl).toContain("data:")
  })

  it("should handle multiple images by using the first one", async () => {
    const formData = new FormData()
    formData.append("image_0", new File(["test1"], "test1.jpg", { type: "image/jpeg" }))
    formData.append("image_1", new File(["test2"], "test2.jpg", { type: "image/jpeg" }))
    formData.append("restorationType", "general")

    const request = new NextRequest("http://localhost/api/restore-image", {
      method: "POST",
      body: formData,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.restoredImageUrl).toContain("data:image/png;base64,")
    expect(mockRun).toHaveBeenCalledTimes(1)
  })
})
