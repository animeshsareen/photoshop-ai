import { NextRequest, NextResponse } from 'next/server'

// Ensure Node.js runtime so optional future sharp usage works
export const runtime = 'nodejs'

// Lightweight regex-ish parsing (MVP) – replace with LLM if needed
function parseQuery(raw: string) {
	const lower = raw.toLowerCase()
	const colors = ['black','white','red','blue','green','yellow','purple','pink','gray','grey','beige','brown','navy','orange']
	const fits = ['slim-fit','slim fit','oversized','regular','loose','tapered','relaxed']
	const categories = ['tshirt','t-shirt','shirt','sweater','hoodie','jacket','coat','jeans','pants','trousers','dress','skirt','blouse','top','shorts','cardigan']
	const foundColor = colors.find(c => lower.includes(c))
	const foundFitRaw = fits.find(f => lower.includes(f))
	const foundFit = foundFitRaw?.replace(' ', '-')
	const foundCategoryRaw = categories.find(c => lower.includes(c))
	const foundCategory = foundCategoryRaw?.replace('t-shirt','tshirt')
	return { color: foundColor, fit: foundFit, category: foundCategory }
}

// Guardrail configuration (lightweight, deterministic – extend / externalize later)
const ALLOWED_KEYWORDS = [
	'tshirt','t-shirt','tee','shirt','sweater','jumper','hoodie','sweatshirt','jacket','coat','jeans','denim','pants','trousers','chinos','dress','skirt','blouse','top','tank','tank top','camisole','cami','shorts','cardigan','pullover','crewneck','long sleeve','long-sleeve','crop top','cropped','polo','henley'
]

// Items we explicitly want to exclude to keep results apparel-focused
const BLOCKED_KEYWORDS = [
	'logo','icon','vector','clip art','illustration','cartoon','template','mockup','bundle','pack','poster','art print','sticker','mug','cup','bottle','hat','cap','shoe','sneaker','boot','sandals','bag','purse','backpack','watch','ring','necklace','bracelet','earring','jewelry','phone case','case','brooch','pin','helmet','glove','scarf','socks','underwear','lingerie'
]

function isClothingTitle(title?: string): boolean {
	if (!title) return false
	const t = title.toLowerCase()
	if (BLOCKED_KEYWORDS.some(b => t.includes(b))) return false
	return ALLOWED_KEYWORDS.some(k => t.includes(k))
}

interface GuardrailMetrics {
	originalCount: number
	afterDedup: number
	clothingOnly: number
	blockedRemoved: number
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
	// Enrich query by reinforcing clothing intent to bias API towards garments only.
	const queryParts = [parsed.color, parsed.fit, parsed.category, q, 'apparel clothing garment']
	const enriched = queryParts.filter(Boolean).join(' ') + ' lay-flat flat-lay'

	const apiKey = process.env.SERPAPI_KEY
	if (!apiKey) return NextResponse.json({ error: 'SERPAPI_KEY not configured' }, { status: 500 })

	const url = new URL('https://serpapi.com/search.json')
	url.searchParams.set('engine','google_images')
	url.searchParams.set('q', enriched)
	url.searchParams.set('api_key', apiKey)

	try {
		const resp = await fetch(url.toString(), { headers: { 'User-Agent': 'virtual-try-on/1.0' } })
		if (!resp.ok) {
			return NextResponse.json({ error: 'SerpApi request failed', status: resp.status }, { status: 502 })
		}
		const json: any = await resp.json()
		let results: SerpShoppingResult[] = json.shopping_results || []
		let sourceUsed: 'shopping_results' | 'images_results' | 'none' = 'none'
		if (results.length > 0) {
			sourceUsed = 'shopping_results'
		} else if (Array.isArray(json.images_results)) {
			sourceUsed = 'images_results'
			results = (json.images_results as any[]).map((r: any, idx: number) => ({
				title: r.title || r.alt || r.source || 'Image',
				thumbnail: r.thumbnail || r.original || r.image,
				link: r.link || r.original || r.image,
				source: r.source,
				position: r.position || idx + 1,
				extensions: r.extensions
			}))
		}

		// Deduplicate by link or title hash to reduce near duplicates before clothing filtering
		const seen = new Set<string>()
		const deduped: SerpShoppingResult[] = []
		for (const r of results) {
			const key = (r.link || '') + '|' + (r.title || '')
			if (seen.has(key)) continue
			seen.add(key)
			deduped.push(r)
		}

		// Apply guardrail clothing filter
		const clothingOnly = deduped.filter(r => isClothingTitle(r.title))
		// Fallback: if guardrail removes everything (overly strict) relax to previous heuristic but still block obvious non-clothing
		const baselineFiltered = deduped.filter(r => r.thumbnail && r.title && !BLOCKED_KEYWORDS.some(b => (r.title||'').toLowerCase().includes(b)))
		const finalSet = (clothingOnly.length >= 4 ? clothingOnly : baselineFiltered).slice(0, 10)

		const metrics: GuardrailMetrics = {
			originalCount: results.length,
			afterDedup: deduped.length,
			clothingOnly: clothingOnly.length,
			blockedRemoved: deduped.length - baselineFiltered.length
		}

		// Attempt to upgrade thumbnail URL to a higher resolution version heuristically
		const upgradeUrl = (url?: string | null) => {
			if (!url) return null
			// Google image thumbs often embed size directives like =w200-h200 or -w200-h200-; try bumping
			return url.replace(/=w(\d+)-h(\d+)[^&]*/i, '=w800-h800').replace(/w\d+-h\d+/i, 'w800-h800')
		}
		return NextResponse.json({
			query: q,
			enrichedQuery: enriched,
			parsed,
			sourceUsed,
			guardrail: metrics,
			rawShoppingCount: json.shopping_results ? json.shopping_results.length : 0,
			rawImagesCount: Array.isArray(json.images_results) ? json.images_results.length : 0,
			count: finalSet.length,
			items: finalSet.map(r => {
				const highResFromOriginal = (r as any).original || (r as any).original_image || null
				const highResHeuristic = upgradeUrl(highResFromOriginal || r.thumbnail)
				return {
					title: r.title,
					image: r.thumbnail, // thumbnail (display in grid)
					highResImage: highResFromOriginal || highResHeuristic || r.thumbnail, // better candidate for import
					url: r.link,
					brand: r.source,
					position: r.position,
					price: r.price ?? r.extracted_price,
					extensions: r.extensions
				}
			})
		})
	} catch (e: any) {
		return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 })
	}
}
