import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { recipient_id, group_id, message_type, subject, content, parent_message_id } = body

    if ((!recipient_id && !group_id) || (recipient_id && group_id)) {
      return NextResponse.json(
        { error: 'Either recipient_id (direct message) or group_id (group message) required, but not both' },
        { status: 400 },
      )
    }

    if (!message_type || !content) {
      return NextResponse.json(
        { error: 'message_type and content are required' },
        { status: 400 },
      )
    }

    const response = await fetch(messagingMessagesBaseUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...messagingProxyHeaders(request),
      },
      body: JSON.stringify({
        recipient_id: recipient_id || null,
        group_id: group_id || null,
        message_type,
        subject,
        content,
        parent_message_id: parent_message_id || null,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to send message' }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Failed to send message:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
