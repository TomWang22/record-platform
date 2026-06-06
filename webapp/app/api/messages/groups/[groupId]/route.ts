import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string } },
) {
  try {
    const { groupId } = params

    const response = await fetch(`${messagingMessagesBaseUrl()}/groups/${groupId}`, {
      headers: messagingProxyHeaders(request),
      cache: 'no-store',
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch group' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch group:', error)
    return NextResponse.json({ error: 'Failed to fetch group' }, { status: 500 })
  }
}
