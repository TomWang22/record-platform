import { Router, type Request, type Response } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth'
import { cached, makePostKey, makePostsListKey, makeCommentsKey } from '../lib/cache'

export default function forumRouter(redis: Redis | null, cpuCores: number) {
  const router = Router()

// GET /forum/posts - List posts (paginated, filterable by flair)
router.get('/posts', async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1
  const limit = parseInt(req.query.limit as string) || 20
  const flair = req.query.flair as string | undefined

  const cacheKey = makePostsListKey(page, limit, flair)
  const result = await cached(
    redis,
    cacheKey,
    60_000, // 1 minute cache
    async () => {
      // Placeholder response - matches frontend expectations
      return {
        posts: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      }
    }
  )

  res.json(result)
})

// POST /forum/posts - Create post
router.post('/posts', (req: AuthedRequest, res: Response) => {
  const { title, content, flair } = req.body
  const userId = req.userId

  if (!title || !content || !flair) {
    return res.status(400).json({ error: 'title, content, and flair required' })
  }

  // Placeholder response
  res.status(201).json({
    id: 'placeholder-post-id',
    user_id: userId,
    title,
    content,
    flair,
    upvotes: 0,
    downvotes: 0,
    comment_count: 0,
    is_pinned: false,
    is_locked: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
})

// GET /forum/posts/:postId - Get post details
router.get('/posts/:postId', async (req: Request, res: Response) => {
  const { postId } = req.params

  const cacheKey = makePostKey(postId)
  const result = await cached(
    redis,
    cacheKey,
    120_000, // 2 minute cache
    async () => {
      // Placeholder response
      return {
        id: postId,
        user_id: 'placeholder-user-id',
        title: 'Placeholder Post',
        content: 'Placeholder content',
        flair: 'Discussion',
        upvotes: 0,
        downvotes: 0,
        comment_count: 0,
        is_pinned: false,
        is_locked: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }
  )

  res.json(result)
})

// PUT /forum/posts/:postId - Update post (author only)
router.put('/posts/:postId', (req: AuthedRequest, res: Response) => {
  const { postId } = req.params
  const { title, content, flair } = req.body

  // Placeholder response
  res.json({
    id: postId,
    user_id: req.userId,
    title: title || 'Updated Post',
    content: content || 'Updated content',
    flair: flair || 'Discussion',
    upvotes: 0,
    downvotes: 0,
    comment_count: 0,
    is_pinned: false,
    is_locked: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
})

// DELETE /forum/posts/:postId - Delete post (author or admin)
router.delete('/posts/:postId', (req: AuthedRequest, res: Response) => {
  res.status(204).end()
})

// POST /forum/posts/:postId/vote - Upvote/downvote post
router.post('/posts/:postId/vote', (req: AuthedRequest, res: Response) => {
  const { postId } = req.params
  const { vote } = req.body // 'up' or 'down'

  if (!vote || !['up', 'down'].includes(vote)) {
    return res.status(400).json({ error: 'vote must be "up" or "down"' })
  }

  // Placeholder response
  res.json({
    post_id: postId,
    user_id: req.userId,
    vote,
    upvotes: vote === 'up' ? 1 : 0,
    downvotes: vote === 'down' ? 1 : 0,
  })
})

// GET /forum/posts/:postId/comments - Get comments for post
router.get('/posts/:postId/comments', async (req: Request, res: Response) => {
  const { postId } = req.params

  const cacheKey = makeCommentsKey(postId)
  const result = await cached(
    redis,
    cacheKey,
    30_000, // 30 second cache (comments change frequently)
    async () => {
      // Placeholder response - nested comments structure
      return {
        post_id: postId,
        comments: [],
      }
    }
  )

  res.json(result)
})

// POST /forum/posts/:postId/comments - Add comment
router.post('/posts/:postId/comments', (req: AuthedRequest, res: Response) => {
  const { postId } = req.params
  const { content, parent_id } = req.body

  if (!content) {
    return res.status(400).json({ error: 'content required' })
  }

  // Placeholder response
  res.status(201).json({
    id: 'placeholder-comment-id',
    post_id: postId,
    user_id: req.userId,
    parent_id: parent_id || null,
    content,
    upvotes: 0,
    downvotes: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
})

// PUT /forum/comments/:commentId - Update comment (author only)
router.put('/comments/:commentId', (req: AuthedRequest, res: Response) => {
  const { commentId } = req.params
  const { content } = req.body

  if (!content) {
    return res.status(400).json({ error: 'content required' })
  }

  // Placeholder response
  res.json({
    id: commentId,
    user_id: req.userId,
    content,
    upvotes: 0,
    downvotes: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
})

// DELETE /forum/comments/:commentId - Delete comment (author or admin)
router.delete('/comments/:commentId', (req: AuthedRequest, res: Response) => {
  res.status(204).end()
})

// POST /forum/comments/:commentId/vote - Vote on comment
router.post('/comments/:commentId/vote', (req: AuthedRequest, res: Response) => {
  const { commentId } = req.params
  const { vote } = req.body

  if (!vote || !['up', 'down'].includes(vote)) {
    return res.status(400).json({ error: 'vote must be "up" or "down"' })
  }

  // Placeholder response
  res.json({
    comment_id: commentId,
    user_id: req.userId,
    vote,
    upvotes: vote === 'up' ? 1 : 0,
    downvotes: vote === 'down' ? 1 : 0,
  })
})

  return router
}

