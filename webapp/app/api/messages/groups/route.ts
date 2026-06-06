import { NextRequest, NextResponse } from 'next/server'

import { messagingMessagesBaseUrl, messagingProxyHeaders } from '@/lib/messaging-bff'

const groupsUrl = () => `${messagingMessagesBaseUrl()}/groups`

export async function GET(request: NextRequest) {
  try {
    const response = await fetch(groupsUrl(), {
      headers: messagingProxyHeaders(request),
      cache: 'no-store',
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch groups' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch groups:', error)
    return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, description } = body

    if (!name) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 })
    }

    const response = await fetch(groupsUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...messagingProxyHeaders(request),
      },
      body: JSON.stringify({ name, description }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create group' }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Failed to create group:', error)
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 })
  }
}
