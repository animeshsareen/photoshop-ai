import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
	try {
		const target = request.nextUrl.searchParams.get('url')
		if (!target) {
			return NextResponse.json({ error: 'Missing url param' }, { status: 400 })
		}
		const upstream = await fetch(target, {
			headers: { 'User-Agent': 'virtual-try-on/1.0' },
			cache: 'no-store'
		})
		if (!upstream.ok) {
			return NextResponse.json({ error: 'Upstream fetch failed', status: upstream.status }, { status: 502 })
		}
		const contentType = upstream.headers.get('content-type') || 'image/jpeg'
		const arrayBuffer = await upstream.arrayBuffer()
		return new NextResponse(Buffer.from(arrayBuffer), {
			status: 200,
			headers: {
				'Content-Type': contentType,
				'Cache-Control': 'public, max-age=300'
			}
		})
	} catch (err: any) {
		return NextResponse.json({ error: err?.message || 'Fetch error' }, { status: 500 })
	}
}
