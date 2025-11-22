import { NextRequest, NextResponse } from 'next/server'

// TODO: Connect to backend service
// This is a placeholder API route for forum post voting
// Will be connected to a forum service/backend later

export async function POST(
  request: NextRequest,
  { params }: { params: { postId: string } }
) {
  try {
    const { postId } = params
    const body = await request.json()
    const { vote } = body

    if (!vote || !['up', 'down'].includes(vote)) {
      return NextResponse.json({ error: 'Invalid vote' }, { status: 400 })
    }

    // TODO: Submit vote via backend
    // const response = await fetch(`${process.env.API_GATEWAY_URL}/forum/posts/${postId}/vote`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ vote }),
    // })
    // const data = await response.json()
    // return NextResponse.json(data)

    // Placeholder response
    return NextResponse.json({ success: true, vote })
  } catch (error) {
    console.error('Failed to vote:', error)
    return NextResponse.json({ error: 'Failed to vote' }, { status: 500 })
  }
}

