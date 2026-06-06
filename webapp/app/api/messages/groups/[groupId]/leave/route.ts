import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { groupId: string } },
) {
  try {
    const { groupId } = params

    const response = await fetch(`${messagingMessagesBaseUrl()}/groups/${groupId}/leave`, {
      method: 'DELETE',
      headers: messagingProxyHeaders(request),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to leave group' }))
      return NextResponse.json(error, { status: response.status })
    }

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('Failed to leave group:', error)
    return NextResponse.json({ error: 'Failed to leave group' }, { status: 500 })
  }
}
