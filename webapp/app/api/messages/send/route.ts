import { NextRequest, NextResponse } from 'next/server'
import { apiFetch } from '@/lib/api-client'

// This is a proxy to the backend messaging service
// In production, this would connect to Kafka for real-time messaging
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { toUserId, message, recordId, messageType, parentMessageId } = body

    if (!toUserId || !message) {
      return NextResponse.json({ error: 'toUserId and message are required' }, { status: 400 })
    }

    // TODO: Replace with actual messaging service endpoint
    // For now, this is a placeholder that will work once the messaging service is integrated
    // The backend should handle:
    // 1. Validating users exist
    // 2. Storing message in database with messageType and parentMessageId
    // 3. Publishing to Kafka topic for real-time delivery
    // 4. Returning message ID

    const result = await apiFetch('/messages/send', {
      method: 'POST',
      auth: true,
      data: {
        toUserId,
        message,
        recordId,
        messageType: messageType || 'general',
        parentMessageId,
        timestamp: new Date().toISOString(),
      },
    }).catch(() => {
      // Service not available yet - return mock response
      return {
        id: `msg-${Date.now()}`,
        fromUserId: 'current-user',
        toUserId,
        message,
        recordId,
        messageType: messageType || 'general',
        parentMessageId,
        timestamp: new Date().toISOString(),
        read: false,
        status: 'sent',
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to send message:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send message' },
      { status: 500 }
    )
  }
}

