import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

type Params = { params: { threadId: string } }

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const response = await fetch(
      `${messagingMessagesBaseUrl()}/thread/${encodeURIComponent(params.threadId)}/archive`,
      { method: 'POST', headers: messagingProxyHeaders(request) },
    )
    if (response.status === 204) return new NextResponse(null, { status: 204 })
    const body = await response.text().catch(() => '')
    return NextResponse.json(
      { error: 'Failed to archive thread', detail: body.slice(0, 300) },
      { status: response.status },
    )
  } catch (error) {
    console.error('Failed to archive thread:', error)
    return NextResponse.json({ error: 'Failed to archive thread' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const response = await fetch(
      `${messagingMessagesBaseUrl()}/thread/${encodeURIComponent(params.threadId)}/archive`,
      { method: 'DELETE', headers: messagingProxyHeaders(request) },
    )
    if (response.status === 204) return new NextResponse(null, { status: 204 })
    const body = await response.text().catch(() => '')
    return NextResponse.json(
      { error: 'Failed to unarchive thread', detail: body.slice(0, 300) },
      { status: response.status },
    )
  } catch (error) {
    console.error('Failed to unarchive thread:', error)
    return NextResponse.json({ error: 'Failed to unarchive thread' }, { status: 500 })
  }
}
