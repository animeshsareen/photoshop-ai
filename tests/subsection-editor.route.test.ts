import { describe, it, expect } from 'vitest'
import { POST, GET } from '../app/api/image/subsection/route'
import { NextRequest } from 'next/server'

function buildPost(body: any) {
  return new NextRequest('http://localhost/api/image/subsection', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  })
}

describe('subsection API', () => {
  it('rejects invalid payload', async () => {
    const req = buildPost({})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
  it('saves and retrieves mask metadata', async () => {
    // Tiny transparent PNG 1x1
    const mask = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+/PfQAIuAN4y5Av8gAAAABJRU5ErkJggg=='
    const req = buildPost({ maskDataUrl: mask, shapes: [{ id: '1', type: 'rect', x: 0, y:0, width:10, height:10 }] })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.id).toBeDefined()

    const getRes = await GET()
    const list: any = await getRes.json()
    expect(Array.isArray(list.items)).toBe(true)
    expect(list.items.length).toBeGreaterThan(0)
  })
})
