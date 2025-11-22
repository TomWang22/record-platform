import { NextRequest, NextResponse } from 'next/server'
import { apiFetch } from '@/lib/api-client'

// Get all conversations for the current user
export async function GET(req: NextRequest) {
  try {
    // TODO: Replace with actual messaging service endpoint
    const conversations = await apiFetch('/messages/conversations', {
      method: 'GET',
      auth: true,
    }).catch(() => {
      // Service not available yet - return empty array
      return []
    })

    return NextResponse.json(conversations)
  } catch (error) {
    console.error('Failed to fetch conversations:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch conversations' },
      { status: 500 }
    )
  }
}

