import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

export async function POST(
  request: NextRequest,
  { params }: { params: { groupId: string } },
) {
  try {
    const body = await request.json()
    const { groupId } = params
    const { user_id } = body

    if (!user_id) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
    }

    const response = await fetch(`${messagingMessagesBaseUrl()}/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...messagingProxyHeaders(request),
      },
      body: JSON.stringify({ user_id }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to add member' }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Failed to add group member:', error)
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
  }
}
