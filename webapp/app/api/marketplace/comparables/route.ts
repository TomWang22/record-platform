import { NextRequest, NextResponse } from 'next/server'

import { getApiGatewayUrl } from '@/lib/server-api'

type ComparableItem = {
  title: string
  price?: number
  currency?: string
  url?: string
  source: string
}

/**
 * Aggregated comparables for sell/list research.
 * Platform listings come from listings-service; external sources may be unavailable.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (!q) {
    return NextResponse.json({ error: 'q is required' }, { status: 400 })
  }

  const base = getApiGatewayUrl()
  const platformUrl = new URL('/api/listings/search', base)
  platformUrl.searchParams.set('q', q)
  platformUrl.searchParams.set('limit', '20')

  const headers = new Headers({ Accept: 'application/json' })
  const auth = request.headers.get('authorization')
  if (auth) {
    headers.set('Authorization', auth)
  }

  const sources: Record<string, { items: ComparableItem[]; warning?: string; error?: string }> =
    {}

  try {
    const platformRes = await fetch(platformUrl.toString(), { headers, cache: 'no-store' })
    if (platformRes.ok) {
      const data = (await platformRes.json()) as {
        listings?: Array<{ title?: string; price?: number; currency?: string; id?: string }>
        items?: Array<{ title?: string; price?: number; currency?: string; id?: string }>
      }
      const rows = data.listings ?? data.items ?? []
      sources.platform = {
        items: rows.map((row) => ({
          title: row.title ?? 'Listing',
          price: row.price,
          currency: row.currency ?? 'USD',
          url: row.id ? `/listings?id=${encodeURIComponent(row.id)}` : undefined,
          source: 'platform',
        })),
      }
    } else {
      const text = await platformRes.text()
      sources.platform = {
        items: [],
        error: `platform search returned ${platformRes.status}`,
        warning: text.slice(0, 200),
      }
    }
  } catch (error) {
    sources.platform = {
      items: [],
      error: error instanceof Error ? error.message : 'platform search failed',
    }
  }

  sources.discogs = {
    items: [],
    warning: 'Discogs comparables not configured in this environment',
  }
  sources.ebay = {
    items: [],
    warning: 'eBay comparables not configured in this environment',
  }
  sources.ai = {
    items: [],
    warning: 'AI valuation not configured in this environment',
  }

  return NextResponse.json({
    query: q,
    sources,
  })
}
