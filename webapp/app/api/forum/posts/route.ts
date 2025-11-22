import { NextRequest, NextResponse } from 'next/server'

// TODO: Connect to backend service
// This is a placeholder API route for forum posts
// Will be connected to a forum service/backend later

export async function GET(request: NextRequest) {
  try {
    // TODO: Fetch posts from backend
    // const response = await fetch(`${process.env.API_GATEWAY_URL}/forum/posts`)
    // const data = await response.json()
    // return NextResponse.json(data)

    // Placeholder response
    return NextResponse.json([])
  } catch (error) {
    console.error('Failed to fetch forum posts:', error)
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { title, content, flair } = body

    if (!title || !content) {
      return NextResponse.json({ error: 'Title and content are required' }, { status: 400 })
    }

    // TODO: Create post via backend
    // const response = await fetch(`${process.env.API_GATEWAY_URL}/forum/posts`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ title, content, flair }),
    // })
    // const data = await response.json()
    // return NextResponse.json(data)

    // Placeholder response
    return NextResponse.json({
      id: `post-${Date.now()}`,
      title,
      content,
      flair: flair || 'discussion',
      author: { id: 'current-user', email: 'user@example.com' },
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
      createdAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Failed to create forum post:', error)
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 })
  }
}

