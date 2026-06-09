import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'
import { pickMessagingField } from '@/lib/messaging-start-body'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const recipient_id = pickMessagingField(body, 'recipient_id', 'recipientId')
    const group_id = pickMessagingField(body, 'group_id', 'groupId')
    const message_type = pickMessagingField(body, 'message_type', 'messageType')
    const subject = pickMessagingField(body, 'subject', 'subject')
    const content = pickMessagingField(body, 'content', 'content')
    const parent_message_id = pickMessagingField(body, 'parent_message_id', 'parentMessageId')
    const thread_id = pickMessagingField(body, 'thread_id', 'threadId')

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
        thread_id: thread_id || null,
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
