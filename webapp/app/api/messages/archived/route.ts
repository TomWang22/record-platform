import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

export async function GET(request: NextRequest) {
  try {
    const response = await fetch(`${messagingMessagesBaseUrl()}/archived`, {
      headers: messagingProxyHeaders(request),
      cache: 'no-store',
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return NextResponse.json(
        { error: 'Failed to fetch archived threads', detail: body.slice(0, 300) },
        { status: response.status },
      )
    }
    return NextResponse.json(await response.json())
  } catch (error) {
    console.error('Failed to fetch archived threads:', error)
    return NextResponse.json({ error: 'Failed to fetch archived threads' }, { status: 500 })
  }
}
