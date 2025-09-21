import { NextRequest, NextResponse } from 'next/server'

// --- Search Enhancement Layer (normalization, fuzzy filtering, diversity) ---
// The original implementation used simple includes() checks and basic brand uniqueness.
// We extend it with:
// 1. Token normalization & canonicalization (hyphen/space, plural/singular naive stemming)
// 2. Expanded apparel domain vocabulary & color/category synonym mapping
// 3. Precompiled regex-based clothing detection with word boundaries
// 4. Fuzzy title dedupe via normalized similarity (Levenshtein ratio)
// 5. Improved relevance scoring: (rating^2 * log(1+reviews))
// 6. Post-ranking diversity (round-robin across colors & categories)
// NOTE: Changes keep existing response shape & tests intact while improving internal filtering.

// Ensure Node.js runtime so optional future sharp usage works
export const runtime = 'nodejs'

// Lightweight regex-ish parsing (MVP) – replace with LLM if needed
// Canonical color synonyms
const COLOR_SYNONYMS: Record<string,string> = {
	grey: 'gray', charcoal: 'gray', silver: 'gray', ash: 'gray',
	navy: 'blue', indigo: 'blue', cobalt: 'blue',
	cream: 'beige', ivory: 'beige', oatmeal: 'beige', ecru: 'beige', sand: 'beige', tan: 'beige', khaki: 'beige',
	maroon: 'red', burgundy: 'red', wine: 'red',
	lime: 'green', olive: 'green', forest: 'green',
	violet: 'purple', lilac: 'purple', lavender: 'purple',
	fuchsia: 'pink', magenta: 'pink'
}

const BASE_COLORS = ['black','white','red','blue','green','yellow','purple','pink','gray','beige','brown','orange']
const COLOR_SET = new Set(BASE_COLORS)

// Category synonyms (map variants to canonical form)
const CATEGORY_SYNONYMS: Record<string,string> = {
	't-shirt': 'tshirt', tee: 'tshirt', 'graphic tee': 'tshirt',
	trousers: 'pants', slacks: 'pants', chinos: 'pants', denim: 'jeans',
	jumper: 'sweater', pullover: 'sweater', crewneck: 'sweater',
	sweatshirt: 'hoodie', 'sweat shirt': 'hoodie',
	camisole: 'top', cami: 'top', blouse: 'top', tank: 'top', 'tank top': 'top',
	cardigan: 'cardigan'
}

const BASE_CATEGORIES = ['tshirt','shirt','sweater','hoodie','jacket','coat','jeans','pants','dress','skirt','top','shorts','cardigan']
const CATEGORY_SET = new Set(BASE_CATEGORIES)

const FIT_TERMS = ['slim-fit','slim fit','slim','oversized','regular','loose','tapered','relaxed']

const STYLE_ADJECTIVES = [
	'v-neck','vneck','crew','crewneck','cropped','crop','ribbed','graphic','plain','striped','floral','linen','cotton','wool','knit'
]

const GENDER_TERMS = ['men','mens','women','womens','unisex','boys','girls']
const SIZE_TERMS = ['xxs','xs','s','m','l','xl','xxl','xxxl','2xl','3xl']

// Naive singularization (remove trailing 's' when >3 chars and not ending with 'ss')
function singularize(token: string) {
	if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0,-1)
	return token
}

function normalizeToken(tok: string): string {
	let t = tok.toLowerCase().trim()
	t = t.replace(/[_]+/g,'-')
	t = singularize(t)
	if (COLOR_SYNONYMS[t]) t = COLOR_SYNONYMS[t]
	if (CATEGORY_SYNONYMS[t]) t = CATEGORY_SYNONYMS[t]
	return t
}

function tokenize(raw: string): string[] {
	return raw
		.toLowerCase()
		.split(/[^a-z0-9+]+/i)
		.filter(Boolean)
		.map(normalizeToken)
}

function parseQuery(raw: string) {
	const tokens = tokenize(raw)
	const color = tokens.find(t => COLOR_SET.has(t)) || null
	// Fit: look for two-word forms first by scanning original raw
	const lower = raw.toLowerCase()
	let fit: string | null = null
	for (const f of FIT_TERMS) {
		if (lower.includes(f)) { fit = f.replace(' ', '-'); break }
	}
	const category = tokens.find(t => CATEGORY_SET.has(t)) || null
	return { color, fit, category }
}

// Guardrail configuration (lightweight, deterministic – extend / externalize later)
// Precompile allowed apparel patterns with word boundaries to avoid partial matches.
const ALLOWED_KEYWORDS = [
	'tshirt','t-shirt','tee','shirt','sweater','jumper','hoodie','sweatshirt','jacket','coat','jeans','denim','pants','trousers','chinos','dress','skirt','blouse','top','tank','tank top','camisole','cami','shorts','cardigan','pullover','crewneck','long sleeve','long-sleeve','crop top','cropped','polo','henley'
]
const ALLOWED_REGEXES = ALLOWED_KEYWORDS.map(k => new RegExp(`(^|\b)${k.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')}(\b|$)`,'i'))

// Items we explicitly want to exclude to keep results apparel-focused
const BLOCKED_KEYWORDS = [
	'logo','icon','vector','clip art','illustration','cartoon','template','mockup','bundle','pack','poster','art print','sticker','mug','cup','bottle','hat','cap','shoe','sneaker','boot','sandals','bag','purse','backpack','watch','ring','necklace','bracelet','earring','jewelry','phone case','case','brooch','pin','helmet','glove','scarf','socks','underwear','lingerie'
]

function isClothingTitle(title?: string): boolean {
	if (!title) return false
	const t = title.toLowerCase()
	if (BLOCKED_KEYWORDS.some(b => t.includes(b))) return false
	return ALLOWED_REGEXES.some(re => re.test(t))
}

// --- Fuzzy utilities ---
function normalizeTitleForKey(str: string): string {
	return str.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')
}

function levenshtein(a: string, b: string): number {
	if (a === b) return 0
	const m = a.length, n = b.length
	if (m === 0) return n
	if (n === 0) return m
	const dp = new Array(n + 1)
	for (let j=0;j<=n;j++) dp[j]=j
	for (let i=1;i<=m;i++) {
		let prev = dp[0]
		dp[0] = i
		for (let j=1;j<=n;j++) {
			const tmp = dp[j]
			if (a[i-1] === b[j-1]) dp[j] = prev
			else dp[j] = Math.min(prev + 1, dp[j] + 1, dp[j-1] + 1)
			prev = tmp
		}
	}
	return dp[n]
}

function similarityRatio(a: string, b: string): number {
	const dist = levenshtein(a,b)
	const maxLen = Math.max(a.length, b.length)
	if (maxLen === 0) return 1
	return 1 - dist / maxLen
}

function fuzzyDeduplicate(items: SerpShoppingResult[], threshold = 0.88): SerpShoppingResult[] {
	const out: SerpShoppingResult[] = []
	const normMap: string[] = []
	for (const r of items) {
		const t = r.title ? normalizeTitleForKey(r.title) : ''
		let isDup = false
		for (let i=0;i<normMap.length;i++) {
			if (similarityRatio(t, normMap[i]) >= threshold) { isDup = true; break }
		}
		if (!isDup) {
			normMap.push(t)
			out.push(r)
		}
	}
	return out
}

function computeScore(rating?: number, reviews?: number): number {
	if (!rating) return 0
	const rev = Math.max(0, reviews || 0)
	return Math.pow(rating, 2) * Math.log(1 + rev)
}

interface DiversityKey { color?: string|null; category?: string|null }

function extractColorCategory(title?: string): DiversityKey {
	if (!title) return {}
	const tokens = tokenize(title)
	const color = tokens.find(t => COLOR_SET.has(t)) || null
	const category = tokens.find(t => CATEGORY_SET.has(t)) || null
	return { color, category }
}

function applyDiversity<T extends { title?: string }>(items: T[], maxPerBucket = 3): T[] {
	if (items.length <= 3) return items
	const buckets = new Map<string, T[]>()
	for (const it of items) {
		const { color, category } = extractColorCategory(it.title)
		const key = `${color||'any'}|${category||'any'}`
		if (!buckets.has(key)) buckets.set(key, [])
		const arr = buckets.get(key)!
		if (arr.length < maxPerBucket) arr.push(it)
	}
	// Round-robin merge
	const orderedBuckets = Array.from(buckets.values())
	const result: T[] = []
	let added = true
	while (added && result.length < 50) { // safety cap
		added = false
		for (const b of orderedBuckets) {
			if (b.length === 0) continue
			result.push(b.shift() as T)
			added = true
			if (result.length >= 50) break
		}
	}
	return result
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
	product_link?: string
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
	// Enrich query by reinforcing clothing intent + detected style/gender/size tokens to bias API.
	const rawTokens = tokenize(q)
	const styleToken = rawTokens.find(t => STYLE_ADJECTIVES.includes(t))
	const genderToken = rawTokens.find(t => GENDER_TERMS.includes(t))
	const sizeToken = rawTokens.find(t => SIZE_TERMS.includes(t))
	const queryParts = [parsed.color, parsed.fit, parsed.category, styleToken, genderToken, sizeToken, q, 'apparel clothing garment']
	const enriched = queryParts.filter(Boolean).join(' ') + ' lay-flat flat-lay'

	const apiKey = process.env.SERPAPI_KEY
	if (!apiKey) return NextResponse.json({ error: 'SERPAPI_KEY not configured' }, { status: 500 })

	const url = new URL('https://serpapi.com/search.json')
	url.searchParams.set('engine','google')
	url.searchParams.set('tbm','shop')
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

		// First pass: exact dedupe by link+title
		const seen = new Set<string>()
		const exact: SerpShoppingResult[] = []
		for (const r of results) {
			const key = (r.link || '') + '|' + (r.title || '')
			if (seen.has(key)) continue
			seen.add(key)
			exact.push(r)
		}
		// Second pass: fuzzy dedupe by normalized title similarity
		const deduped = fuzzyDeduplicate(exact)

	// Apply guardrail clothing filter
	const clothingOnly = deduped.filter(r => isClothingTitle(r.title))
	// Fallback: if guardrail removes everything (overly strict) relax to previous heuristic but still block obvious non-clothing
	const baselineFiltered = deduped.filter(r => r.thumbnail && r.title && !BLOCKED_KEYWORDS.some(b => (r.title||'').toLowerCase().includes(b)))
	const finalSet = (clothingOnly.length >= 4 ? clothingOnly : baselineFiltered).slice(0, 40) // allow a few more before brand/price guardrails

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
				productLink: (r as any).product_link,
				brand: r.source,
				position: r.position,
				price,
				rating,
				reviews,
				_score: computeScore(rating, reviews),
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
		brandUniqueItems = brandUniqueItems.slice(0,20)

    // Diversity pass (round-robin across color/category buckets) then cap to 10
    brandUniqueItems = applyDiversity(brandUniqueItems).slice(0,10)

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
