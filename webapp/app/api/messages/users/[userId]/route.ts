import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId } = await context.params
    const url = `${messagingMessagesBaseUrl()}/users/${encodeURIComponent(userId)}`
    const response = await fetch(url, {
      headers: messagingProxyHeaders(request),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to load user' }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to load messaging user:', error)
    return NextResponse.json({ error: 'Failed to load user' }, { status: 500 })
  }
}
