import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

export async function POST(
  request: NextRequest,
  { params }: { params: { messageId: string } },
) {
  try {
    const body = await request.json()
    const { messageId } = params

    const response = await fetch(`${messagingMessagesBaseUrl()}/${messageId}/attachments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...messagingProxyHeaders(request),
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to add attachment' }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Failed to add message attachment:', error)
    return NextResponse.json({ error: 'Failed to add attachment' }, { status: 500 })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { messageId: string } },
) {
  try {
    const { messageId } = params

    const response = await fetch(`${messagingMessagesBaseUrl()}/${messageId}/attachments`, {
      headers: messagingProxyHeaders(request),
      cache: 'no-store',
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch message attachments:', error)
    return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 })
  }
}
