import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

type Params = { params: { threadId: string } }

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const response = await fetch(
      `${messagingMessagesBaseUrl()}/thread/${encodeURIComponent(params.threadId)}/delete`,
      { method: 'POST', headers: messagingProxyHeaders(request) },
    )
    const body = await response.text().catch(() => '')
    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to delete thread', detail: body.slice(0, 300) },
        { status: response.status },
      )
    }
    try {
      return NextResponse.json(body ? JSON.parse(body) : { deleted_for_me: true })
    } catch {
      return NextResponse.json({ deleted_for_me: true })
    }
  } catch (error) {
    console.error('Failed to delete thread:', error)
    return NextResponse.json({ error: 'Failed to delete thread' }, { status: 500 })
  }
}
