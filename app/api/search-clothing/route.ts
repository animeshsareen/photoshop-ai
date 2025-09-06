import { NextRequest, NextResponse } from 'next/server'

// Simple attribute extraction using regex + heuristics as lightweight MVP (can be replaced with LLM call)
function parseQuery(raw: string) {
  const lower = raw.toLowerCase()
  const colors = ['black','white','red','blue','green','yellow','purple','pink','gray','grey','beige','brown','navy','orange']
  const fits = ['slim-fit','slim fit','oversized','regular','loose','tapered','relaxed']
  const categories = ['tshirt','t-shirt','shirt','sweater','hoodie','jacket','coat','jeans','pants','trousers','dress','skirt','blouse','top','shorts']

  const foundColor = colors.find(c => lower.includes(c))
  const foundFitRaw = fits.find(f => lower.includes(f))
  const foundFit = foundFitRaw?.replace(' ', '-')
  const foundCategoryRaw = categories.find(c => lower.includes(c))
  const foundCategory = foundCategoryRaw?.replace('t-shirt','tshirt')

  return { color: foundColor, fit: foundFit, category: foundCategory }
}

interface SerpShoppingResult {
  title?: string
  thumbnail?: string
  link?: string
  source?: string
  position?: number
  price?: string
  extracted_price?: number
  extensions?: string[]
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  if (!q) return NextResponse.json({ error: 'Missing q param' }, { status: 400 })

  const parsed = parseQuery(q)
  // Construct enriched query encouraging lay-flat
  const queryParts = [parsed.color, parsed.fit, parsed.category, q]
  const enriched = queryParts.filter(Boolean).join(' ') + ' lay-flat flat-lay'

  const apiKey = process.env.SERPAPI_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'SerpApi key not configured' }, { status: 500 })
  }

  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine','google_images')
  url.searchParams.set('q', enriched)
  url.searchParams.set('api_key', apiKey)

  try {
    const resp = await fetch(url.toString(), { headers: { 'User-Agent': 'virtual-try-on/1.0' } })
    if (!resp.ok) {
      const text = await resp.text()
      return NextResponse.json({ error: 'SerpApi request failed', status: resp.status, body: text.slice(0,500) }, { status: 502 })
    }
    const json: any = await resp.json()
    const results: SerpShoppingResult[] = json.shopping_results || []

    // Basic filtering: ensure thumbnail exists & attempt to keep realistic product images (exclude svg, icon, logo hints)
    const filtered = results.filter(r => r.thumbnail && r.title && !/(logo|icon|vector|clip art)/i.test(r.title || '')).slice(0,10)

    return NextResponse.json({
      query: q,
      enrichedQuery: enriched,
      parsed,
      count: filtered.length,
      items: filtered.map(r => ({
        title: r.title,
        image: r.thumbnail,
        url: r.link,
        brand: r.source,
        position: r.position,
        price: r.price ?? r.extracted_price,
        extensions: r.extensions
      }))
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 })
  }
}
