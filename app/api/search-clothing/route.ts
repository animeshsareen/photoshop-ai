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
	brandUnique: number
	droppedBrandDuplicates: number
}

interface SerpShoppingResult {
	title?: string
	thumbnail?: string
	link?: string
	source?: string
	position?: number
	price?: string
	extracted_price?: number
	rating?: number
	reviews?: number
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
		const finalSet = (clothingOnly.length >= 4 ? clothingOnly : baselineFiltered).slice(0, 25) // allow a few more before brand/price guardrails

		// Brand/source blacklist (e.g., stock image providers we don't want to surface as apparel products)
		const blacklistBrands = new Set(['shutterstock'])
		const brandFilteredSet = finalSet.filter(r => !blacklistBrands.has((r.source || '').toLowerCase()))

		// We'll fill extended metrics after final transformations
		const baseMetrics: Omit<GuardrailMetrics, 'brandUnique' | 'droppedBrandDuplicates'> = {
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
		// First map raw -> enriched item objects with price inference
		const mapped = brandFilteredSet.map(r => {
			const highResFromOriginal = (r as any).original || (r as any).original_image || null
			const highResHeuristic = upgradeUrl(highResFromOriginal || r.thumbnail)
			let price: any = (r as any).price ?? (r as any).extracted_price
			// Extract rating / reviews if present (SerpApi often supplies rating & reviews fields)
			let rating: number | undefined = (r as any).rating
			let reviews: number | undefined = (r as any).reviews
			// Attempt lightweight parse from extensions if missing
			if ((rating == null || reviews == null) && Array.isArray(r.extensions)) {
				for (const ex of r.extensions) {
					// Match patterns like "4.5" or "4.5/5" possibly followed by reviews in another extension
					const ratingMatch = /([0-5](?:\.\d+)?)(?:\s*\/\s*5)?/.exec(ex)
					if (rating == null && ratingMatch) {
						const val = parseFloat(ratingMatch[1])
						if (!isNaN(val) && val <= 5) rating = val
					}
					// Match reviews like (1,234) or 1,234 reviews
					const reviewsMatch = /(\d{1,3}(?:,\d{3})+|\d+)\s*(?:reviews|ratings|rev\b|r\b)?/i.exec(ex)
					if (reviews == null && reviewsMatch) {
						const num = parseInt(reviewsMatch[1].replace(/,/g,''),10)
						if (!isNaN(num)) reviews = num
					}
					if (rating != null && reviews != null) break
				}
			}
			if (!price && Array.isArray(r.extensions)) {
				const priceLike = r.extensions.find(ex => /[$£€¥₹]|\bUSD\b|\bEUR\b|\bGBP\b|\bINR\b|\bCAD\b|\bAUD\b|\bNZD\b|Rs\.?/i.test(ex))
				if (priceLike) price = priceLike
			}
			return {
				title: r.title,
				image: r.thumbnail,
				highResImage: highResFromOriginal || highResHeuristic || r.thumbnail,
				url: r.link,
				brand: r.source,
				position: r.position,
				price,
				rating,
				reviews,
				_score: (reviews || 0) * (rating || 0),
				extensions: r.extensions
			}
		})

		// Brand uniqueness + relevance ranking:
		// 1. For each brand keep the highest scoring item (score = reviews * rating)
		// 2. Sort remaining items by score desc, then fallback to (reviews desc, rating desc, position asc)
		// 3. Take top 10
		const brandBest = new Map<string, typeof mapped[number]>()
		for (const item of mapped) {
			const key = (item.brand || '').toLowerCase()
			const existing = brandBest.get(key)
			if (!existing) {
				brandBest.set(key, item)
				continue
			}
			// Replace if new item has higher score; tie-breaker: higher reviews, higher rating, earlier position
			if (
				(item._score > existing._score) ||
				(item._score === existing._score && (item.reviews || 0) > (existing.reviews || 0)) ||
				(item._score === existing._score && (item.reviews || 0) === (existing.reviews || 0) && (item.rating || 0) > (existing.rating || 0)) ||
				(item._score === existing._score && (item.reviews || 0) === (existing.reviews || 0) && (item.rating || 0) === (existing.rating || 0) && (item.position || Infinity) < (existing.position || Infinity))
			) {
				brandBest.set(key, item)
			}
		}
		let brandUniqueItems = Array.from(brandBest.values())
		brandUniqueItems.sort((a,b) => {
			if (b._score !== a._score) return b._score - a._score
			const revDiff = (b.reviews||0) - (a.reviews||0)
			if (revDiff) return revDiff
			const ratingDiff = (b.rating||0) - (a.rating||0)
			if (ratingDiff) return ratingDiff
			return (a.position||0) - (b.position||0)
		})
		brandUniqueItems = brandUniqueItems.slice(0,10)

		const metrics: GuardrailMetrics = {
			...baseMetrics,
			brandUnique: brandUniqueItems.length,
			droppedBrandDuplicates: mapped.length - brandUniqueItems.length
		}

		return NextResponse.json({
			query: q,
			enrichedQuery: enriched,
			parsed,
			sourceUsed,
			guardrail: metrics,
			rawShoppingCount: json.shopping_results ? json.shopping_results.length : 0,
			rawImagesCount: Array.isArray(json.images_results) ? json.images_results.length : 0,
			count: brandUniqueItems.length,
			items: brandUniqueItems.map(({ _score, ...rest }) => rest) // strip internal _score
		})
	} catch (e: any) {
		return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 })
	}
}
