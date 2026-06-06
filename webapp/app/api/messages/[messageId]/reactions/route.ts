import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

export async function POST(
  request: NextRequest,
  { params }: { params: { messageId: string } },
) {
  try {
    const body = await request.json()
    const response = await fetch(
      `${messagingMessagesBaseUrl()}/${encodeURIComponent(params.messageId)}/reactions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...messagingProxyHeaders(request),
        },
        body: JSON.stringify(body),
      },
    )
    const data = await response.json().catch(() => ({}))
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Failed to add reaction:', error)
    return NextResponse.json({ error: 'Failed to add reaction' }, { status: 500 })
  }
}
