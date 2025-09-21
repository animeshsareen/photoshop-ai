import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const isValidExternalLink = (raw?: unknown) => {
  if (typeof raw !== 'string') return false
  const trimmed = raw.trim()
  if (!trimmed) return false
  try {
    const url = new URL(trimmed)
    if (!/^https?:$/i.test(url.protocol)) return false
    const host = url.hostname.toLowerCase()
    if (host === 'google.com' || host.endsWith('.google.com')) return false
    return true
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')?.trim()
  if (!query) {
    return NextResponse.json({ error: 'Missing q param' }, { status: 400 })
  }

  const apiKey = process.env.SERPAPI_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'SERPAPI_KEY not configured' }, { status: 500 })
  }

  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google')
  url.searchParams.set('q', query)
  url.searchParams.set('num', '10')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('source', 'try-my-clothes-first-organic')

  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'virtual-try-on/1.0' }
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: 'SerpApi request failed', status: response.status },
        { status: 502 }
      )
    }

    const data: any = await response.json()

    const organicResults: Array<Record<string, unknown>> = Array.isArray(data?.organic_results)
      ? data.organic_results
      : []

    const primary = organicResults.find((result: any) => isValidExternalLink(result?.link))

    if (primary?.link) {
      const payload = {
        url: primary.link as string,
        title: typeof primary.title === 'string' ? primary.title : undefined,
        position: typeof primary.position === 'number' ? primary.position : undefined
      }
      return NextResponse.json(payload)
    }

    return NextResponse.json({ error: 'No organic result found' }, { status: 404 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
