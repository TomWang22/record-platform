import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q') ?? ''
    const url = `${messagingMessagesBaseUrl()}/users/search?q=${encodeURIComponent(q)}`
    const response = await fetch(url, {
      headers: messagingProxyHeaders(request),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to search users' }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to search messaging users:', error)
    return NextResponse.json({ error: 'Failed to search users' }, { status: 500 })
  }
}
