import { NextRequest, NextResponse } from 'next/server'

/** Server-side BFF: in-cluster gateway, not public edge URL (avoids /messages without /api prefix). */
const API_GATEWAY_URL =
  process.env.API_GATEWAY_URL ||
  process.env.NEXT_PUBLIC_API_GATEWAY_URL ||
  'http://api-gateway.record-platform.svc.cluster.local:4000'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const page = searchParams.get('page') || '1'
    const limit = searchParams.get('limit') || '20'
    const type = searchParams.get('type')

    const base = API_GATEWAY_URL.replace(/\/$/, '')
    const url = new URL(`${base}/api/messaging/threads`)
    url.searchParams.set('page', page)
    url.searchParams.set('limit', limit)
    if (type) url.searchParams.set('type', type)

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
      },
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch messages:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}
