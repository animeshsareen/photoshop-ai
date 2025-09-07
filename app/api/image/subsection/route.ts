import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

// Simple in-memory index (ephemeral). Real implementation should use DB / object storage.
let cached: { id: string; maskPath: string; metaPath: string }[] = []

export async function GET() {
  try {
    const tempDir = '/tmp/subsections'
    if (!fs.existsSync(tempDir)) return NextResponse.json({ items: [] })
    const files = fs.readdirSync(tempDir)
    const masks = files.filter(f => f.endsWith('.json'))
    const items = masks.map(f => {
      const metaRaw = fs.readFileSync(path.join(tempDir, f), 'utf8')
      const meta = JSON.parse(metaRaw)
      const id = f.replace(/\.json$/, '')
      const png = path.join(tempDir, id + '.png')
      let maskDataUrl: string | undefined
      if (fs.existsSync(png)) {
        const b64 = fs.readFileSync(png).toString('base64')
        maskDataUrl = `data:image/png;base64,${b64}`
      }
      return { id, ...meta, maskDataUrl }
    })
    return NextResponse.json({ items })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load subsections' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { maskDataUrl, shapes } = body || {}
    if (!maskDataUrl || !Array.isArray(shapes)) return NextResponse.json({ error: 'maskDataUrl and shapes required' }, { status: 400 })
    const tempDir = '/tmp/subsections'
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
    const id = 'mask-' + Date.now()
    const maskPath = path.join(tempDir, `${id}.png`)
    const metaPath = path.join(tempDir, `${id}.json`)
    const base64 = maskDataUrl.split(',')[1]
    if (base64) fs.writeFileSync(maskPath, Buffer.from(base64, 'base64'))
    fs.writeFileSync(metaPath, JSON.stringify({ shapes, createdAt: Date.now() }))
    cached.push({ id, maskPath, metaPath })
    return NextResponse.json({ id })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to save subsection' }, { status: 500 })
  }
}
