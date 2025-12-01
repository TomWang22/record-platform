import { NextRequest, NextResponse } from 'next/server'

const API_GATEWAY_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL || 'http://localhost:8081'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const page = searchParams.get('page') || '1'
    const limit = searchParams.get('limit') || '20'
    const flair = searchParams.get('flair')

    const url = new URL(`${API_GATEWAY_URL}/forum/posts`)
    url.searchParams.set('page', page)
    url.searchParams.set('limit', limit)
    if (flair) url.searchParams.set('flair', flair)

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch posts' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch forum posts:', error)
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { title, content, flair, upload_type } = body

    if (!title || !content || !flair) {
      return NextResponse.json({ error: 'Title, content, and flair are required' }, { status: 400 })
    }

    const response = await fetch(`${API_GATEWAY_URL}/forum/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': request.headers.get('Authorization') || '',
      },
      body: JSON.stringify({ title, content, flair, upload_type: upload_type || 'text' }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create post' }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Failed to create forum post:', error)
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 })
  }
}
