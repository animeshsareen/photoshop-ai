import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../app/api/search-clothing/route'
import { NextRequest } from 'next/server'

// Helper to build a NextRequest
function buildRequest(query: string) {
  const url = `http://localhost/api/search-clothing?q=${encodeURIComponent(query)}`
  return new NextRequest(url, { method: 'GET' })
}

declare const global: any

// Mock process.env
process.env.SERPAPI_KEY = 'test_key'

// Capture the last fetch URL for assertions
let lastFetchUrl: string | null = null

beforeEach(() => {
  lastFetchUrl = null
  vi.restoreAllMocks()
  vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
    const url = typeof input === 'string' ? input : input.toString()
    lastFetchUrl = url
    // Simulate a SerpApi response with shopping_results including price and one without
    const mockJson = {
      shopping_results: [
        {
          title: 'Black Slim-Fit T-Shirt',
          thumbnail: 'http://img.example.com/1.jpg',
          link: 'http://shop.example.com/item1',
          source: 'ExampleBrand',
          position: 1,
          price: '$19.99',
          extensions: ['In stock']
        },
        {
          title: 'Blue Hoodie',
          thumbnail: 'http://img.example.com/2.jpg',
          link: 'http://shop.example.com/item2',
          source: 'OtherBrand',
          position: 2,
          // no price field, but extensions contains a price-like token
          extensions: ['$49.50', 'Free returns']
        },
        {
          title: 'Duplicate Brand Tee',
          thumbnail: 'http://img.example.com/3.jpg',
          link: 'http://shop.example.com/item3',
          source: 'ExampleBrand',
          position: 3,
          price: '$25.00',
          extensions: []
        },
        {
          title: 'No Price Cardigan',
          thumbnail: 'http://img.example.com/4.jpg',
          link: 'http://shop.example.com/item4',
          source: 'CardiBrand',
          position: 4,
          // deliberately no price and no price-like extension to test filtering
          extensions: ['Soft wool']
        }
      ]
    }
    return {
      ok: true,
      json: async () => mockJson
    } as any
  })
})

describe('GET /api/search-clothing', () => {
  it('extracts price when available, enforces brand uniqueness (no price filtering)', async () => {
    const req = buildRequest('black slim fit tshirt')
    const res = await GET(req)
    const data: any = await res.json()

    expect(data.items.length).toBeGreaterThan(0)

    const first = data.items.find((i: any) => /t-shirt/i.test(i.title))
    expect(first.price).toBe('$19.99')

    const second = data.items.find((i: any) => /hoodie/i.test(i.title))
    expect(second.price).toBe('$49.50')

    // Duplicate brand item should have been removed (only first ExampleBrand retained)
    const exampleBrandItems = data.items.filter((i: any) => i.brand === 'ExampleBrand')
    expect(exampleBrandItems.length).toBe(1)

  // Item without any price should now remain (no price filtering)
  const noPrice = data.items.find((i: any) => /cardigan/i.test(i.title))
  expect(noPrice).toBeDefined()

  // Guardrail metrics reflect only brand duplicate drops
  expect(data.guardrail.droppedBrandDuplicates).toBeGreaterThanOrEqual(1)
  })

  it('constructs enriched query', async () => {
    const req = buildRequest('black slim fit tshirt')
    const res = await GET(req)
    const data: any = await res.json()
    expect(data.enrichedQuery).toMatch(/apparel clothing garment/)
  })

  it('falls back to images_results (keeps items even if lacking price)', async () => {
    // Override fetch just for this test
    vi.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      const mockJson = {
        shopping_results: [],
        images_results: [
          {
            title: 'Red Oversized Hoodie',
            thumbnail: 'http://img.example.com/hoodie_red_thumb.jpg',
            original: 'http://img.example.com/hoodie_red.jpg',
            link: 'http://shop.example.com/red-hoodie',
            source: 'BrandX',
            position: 1,
            extensions: ['BrandX', '$59.00', 'Free shipping']
          },
          {
            title: 'Green Slim-Fit T-Shirt',
            thumbnail: 'http://img.example.com/tee_green_thumb.jpg',
            original: 'http://img.example.com/tee_green.jpg',
            link: 'http://shop.example.com/green-tee',
            source: 'BrandY',
            position: 2,
            extensions: ['BrandY', 'Comfort cotton'] // no price-like token
          }
        ]
      }
      return { ok: true, json: async () => mockJson } as any
    })
    const req = buildRequest('red oversized hoodie')
    const res = await GET(req)
    const data: any = await res.json()

    expect(data.sourceUsed).toBe('images_results')
  expect(data.items.length).toBe(2) // both items kept (no price filtering)
    const hoodie = data.items.find((i: any) => /hoodie/i.test(i.title))
  expect(hoodie.price).toBe('$59.00')
  expect(data.guardrail.brandUnique).toBe(data.items.length)
  })

  it('caps final results to max 10 unique brands', async () => {
    // Override with >10 priced items across >10 brands plus dupes to test cap
    vi.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      const many = Array.from({ length: 15 }).map((_, i) => ({
        title: `Test Tee ${i}`,
        thumbnail: `http://img.example.com/many_${i}.jpg`,
        link: `http://shop.example.com/many_${i}`,
        source: `Brand${i % 12}`, // ensures some duplicates when i >=12
        position: i + 1,
        price: `$${10 + i}.00`,
        extensions: []
      }))
      return { ok: true, json: async () => ({ shopping_results: many }) } as any
    })
    const req = buildRequest('test tshirt bulk set')
    const res = await GET(req)
    const data: any = await res.json()
    expect(data.items.length).toBeLessThanOrEqual(10)
    const brandSet = new Set(data.items.map((i: any) => i.brand))
    expect(brandSet.size).toBe(data.items.length)
  })
})
