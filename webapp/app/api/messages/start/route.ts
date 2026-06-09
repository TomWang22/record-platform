import { NextRequest, NextResponse } from 'next/server'

import {
  messagingMessagesBaseUrl,
  messagingProxyHeaders,
  userIdFromAuthHeader,
} from '@/lib/messaging-bff'
import { normalizeMessagingStartBody } from '@/lib/messaging-start-body'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const { listingId, recipientId, initialMessage } = normalizeMessagingStartBody(body)

    if (!listingId && !recipientId) {
      return NextResponse.json(
        { error: 'recipient_id or listing_id is required' },
        { status: 400 },
      )
    }

    const auth = request.headers.get('Authorization') || ''
    const renterId = userIdFromAuthHeader(auth)
    if (!renterId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const upstreamBody: Record<string, unknown> = {
      renter_id: renterId,
    }
    if (listingId) upstreamBody.listing_id = listingId
    if (recipientId) upstreamBody.recipient_id = recipientId
    if (initialMessage) upstreamBody.initial_message = initialMessage

    const response = await fetch(`${messagingMessagesBaseUrl()}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...messagingProxyHeaders(request),
      },
      body: JSON.stringify(upstreamBody),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to start conversation' }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Failed to start marketplace conversation:', error)
    return NextResponse.json({ error: 'Failed to start conversation' }, { status: 500 })
  }
}
