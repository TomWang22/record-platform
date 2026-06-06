import { NextRequest, NextResponse } from 'next/server'

import {
  messagingMessagesBaseUrl,
  messagingProxyHeaders,
  userIdFromAuthHeader,
} from '@/lib/messaging-bff'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { listing_id, initial_message } = body as { listing_id?: string; initial_message?: string }

    if (!listing_id || !String(initial_message ?? '').trim()) {
      return NextResponse.json(
        { error: 'listing_id and initial_message are required' },
        { status: 400 },
      )
    }

    const auth = request.headers.get('Authorization') || ''
    const renterId = userIdFromAuthHeader(auth)
    const response = await fetch(`${messagingMessagesBaseUrl()}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...messagingProxyHeaders(request),
      },
      body: JSON.stringify({
        listing_id,
        renter_id: renterId,
        initial_message: String(initial_message).trim(),
      }),
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
