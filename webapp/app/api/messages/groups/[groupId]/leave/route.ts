import { NextRequest, NextResponse } from 'next/server'

const API_GATEWAY_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL || 'http://localhost:8081'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const { groupId } = params

    const response = await fetch(`${API_GATEWAY_URL}/messages/groups/${groupId}/leave`, {
      method: 'DELETE',
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
      },
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

