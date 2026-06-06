import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

export async function POST(
  request: NextRequest,
  { params }: { params: { messageId: string } },
) {
  try {
    const body = await request.json()
    const response = await fetch(
      `${messagingMessagesBaseUrl()}/${encodeURIComponent(params.messageId)}/reply`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...messagingProxyHeaders(request),
        },
        body: JSON.stringify({
          message_type: 'question',
          subject: 'Message',
          content: String((body as { content?: string }).content ?? ''),
        }),
      },
    )
    const data = await response.json().catch(() => ({}))
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Failed to reply to message:', error)
    return NextResponse.json({ error: 'Failed to reply' }, { status: 500 })
  }
}
