import { NextRequest, NextResponse } from 'next/server'

// TODO: Connect to backend service
// This is a placeholder API route for forum post comments
// Will be connected to a forum service/backend later

export async function GET(
  request: NextRequest,
  { params }: { params: { postId: string } }
) {
  try {
    const { postId } = params

    // TODO: Fetch comments from backend
    // const response = await fetch(`${process.env.API_GATEWAY_URL}/forum/posts/${postId}/comments`)
    // const data = await response.json()
    // return NextResponse.json(data)

    // Placeholder response
    return NextResponse.json([])
  } catch (error) {
    console.error('Failed to fetch comments:', error)
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { postId: string } }
) {
  try {
    const { postId } = params
    const body = await request.json()
    const { content, parentId } = body

    if (!content) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    // TODO: Create comment via backend
    // const response = await fetch(`${process.env.API_GATEWAY_URL}/forum/posts/${postId}/comments`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ content, parentId }),
    // })
    // const data = await response.json()
    // return NextResponse.json(data)

    // Placeholder response
    return NextResponse.json({
      id: `comment-${Date.now()}`,
      postId,
      parentId,
      content,
      author: { id: 'current-user', email: 'user@example.com' },
      upvotes: 0,
      downvotes: 0,
      createdAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Failed to create comment:', error)
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 })
  }
}

