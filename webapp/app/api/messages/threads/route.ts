import { NextRequest, NextResponse } from 'next/server'

import { messagingProxyHeaders, messagingThreadsBaseUrl } from '@/lib/messaging-bff'

export async function GET(request: NextRequest) {
  try {
    const response = await fetch(messagingThreadsBaseUrl(), {
      headers: messagingProxyHeaders(request),
      cache: 'no-store',
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return NextResponse.json(
        { error: 'Failed to fetch threads', detail: body.slice(0, 300) },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch messaging threads:', error)
    return NextResponse.json({ error: 'Failed to fetch threads' }, { status: 500 })
  }
}
