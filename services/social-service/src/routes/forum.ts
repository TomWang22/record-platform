import { Router, type Request, type Response } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { cached, makePostKey, makePostsListKey, makeCommentsKey } from '../lib/cache.js'
import { pool } from '../lib/db.js'
import { kafka } from '@common/utils/kafka'

// Kafka producer for real-time forum updates (optional - fails gracefully if Kafka is unavailable)
let kafkaProducer: any = null
let kafkaConnectionFailed = false
async function getKafkaProducer() {
  if (kafkaConnectionFailed) {
    return null // Don't retry if we've already failed
  }
  if (!kafkaProducer) {
    try {
      kafkaProducer = kafka.producer()
      // Add connection timeout
      await Promise.race([
        kafkaProducer.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Kafka connection timeout')), 2000)
        )
      ])
    } catch (err) {
      console.warn('[social] Kafka producer connection failed (non-fatal):', (err as Error)?.message || err)
      kafkaConnectionFailed = true
      kafkaProducer = null
      return null
    }
  }
  return kafkaProducer
}

export default function forumRouter(redis: Redis | null, cpuCores: number) {
  const router: Router = Router()

  // GET /forum/posts - List posts (paginated, filterable by flair)
  router.get('/posts', async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const flair = req.query.flair as string | undefined
    const offset = (page - 1) * limit

    const cacheKey = makePostsListKey(page, limit, flair)
    const result = await cached(
      redis,
      cacheKey,
      60_000, // 1 minute cache
      async () => {
        try {
          const query = `
            SELECT 
              id, user_id, title, content, flair, upvotes, downvotes,
              comment_count, is_pinned, is_locked, created_at, updated_at
            FROM forum.posts
            WHERE ($1::VARCHAR IS NULL OR flair = $1)
            ORDER BY is_pinned DESC, created_at DESC
            LIMIT $2 OFFSET $3
          `
          const { rows } = await pool.query(query, [flair || null, limit, offset])

          // Get total count
          const countQuery = `
            SELECT COUNT(*) as total
            FROM forum.posts
            WHERE ($1::VARCHAR IS NULL OR flair = $1)
          `
          const { rows: countRows } = await pool.query(countQuery, [flair || null])
          const total = parseInt(countRows[0].total, 10)

          return {
            posts: rows,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.ceil(total / limit),
            },
          }
        } catch (err) {
          console.error('[social] Error fetching posts:', err)
          throw err
        }
      }
    )

    res.json(result)
  })

  // POST /forum/posts - Create post
  router.post('/posts', async (req: AuthedRequest, res: Response) => {
    const { title, content, flair } = req.body
    const userId = req.userId

    if (!title || !content || !flair) {
      return res.status(400).json({ error: 'title, content, and flair required' })
    }

    try {
      // Insert post into database
      const insertQuery = `
        INSERT INTO forum.posts (user_id, title, content, flair)
        VALUES ($1, $2, $3, $4)
        RETURNING id, user_id, title, content, flair, upvotes, downvotes,
                  comment_count, is_pinned, is_locked, created_at, updated_at
      `
      const { rows } = await pool.query(insertQuery, [userId, title, content, flair])
      const post = rows[0]

      // Publish to Kafka for real-time notifications
      try {
        const producer = await getKafkaProducer()
        if (producer) {
          await producer.send({
            topic: 'forum-posts',
            messages: [
              {
                key: post.id,
                value: JSON.stringify({
                  post_id: post.id,
                  user_id: userId,
                  title,
                  content,
                  flair,
                  created_at: post.created_at,
                  event_type: 'post_created',
                }),
              },
            ],
          })
        }
      } catch (err) {
        console.warn('[social] Kafka publish failed (non-fatal):', err)
      }

      res.status(201).json(post)
    } catch (err: any) {
      console.error('[social] Error creating post:', err)
      res.status(500).json({ error: 'Failed to create post' })
    }
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
        try {
          const query = `
            SELECT 
              id, user_id, title, content, flair, upvotes, downvotes,
              comment_count, is_pinned, is_locked, created_at, updated_at
            FROM forum.posts
            WHERE id = $1
          `
          const { rows } = await pool.query(query, [postId])

          if (rows.length === 0) {
            throw new Error('Post not found')
          }

          return rows[0]
        } catch (err) {
          console.error('[social] Error fetching post:', err)
          throw err
        }
      }
    )

    res.json(result)
  })

  // PUT /forum/posts/:postId - Update post (author only)
  router.put('/posts/:postId', async (req: AuthedRequest, res: Response) => {
    const { postId } = req.params
    const { title, content, flair } = req.body
    const userId = req.userId

    try {
      // Verify author owns the post
      const checkQuery = await pool.query(
        'SELECT user_id FROM forum.posts WHERE id = $1',
        [postId]
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Post not found' })
      }
      if (checkQuery.rows[0].user_id !== userId) {
        return res.status(403).json({ error: 'You can only edit your own posts' })
      }

      const updateQuery = `
        UPDATE forum.posts
        SET title = COALESCE($1, title),
            content = COALESCE($2, content),
            flair = COALESCE($3, flair),
            updated_at = now()
        WHERE id = $4
        RETURNING id, user_id, title, content, flair, upvotes, downvotes,
                  comment_count, is_pinned, is_locked, created_at, updated_at
      `
      const { rows } = await pool.query(updateQuery, [title, content, flair, postId])

      res.json(rows[0])
    } catch (err) {
      console.error('[social] Error updating post:', err)
      res.status(500).json({ error: 'Failed to update post' })
    }
  })

  // DELETE /forum/posts/:postId - Delete post (author or admin)
  router.delete('/posts/:postId', async (req: AuthedRequest, res: Response) => {
    const { postId } = req.params
    const userId = req.userId

    try {
      // Verify author owns the post (or is admin - implement admin check if needed)
      const checkQuery = await pool.query(
        'SELECT user_id FROM forum.posts WHERE id = $1',
        [postId]
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Post not found' })
      }
      if (checkQuery.rows[0].user_id !== userId) {
        return res.status(403).json({ error: 'You can only delete your own posts' })
      }

      await pool.query('DELETE FROM forum.posts WHERE id = $1', [postId])
      res.status(204).end()
    } catch (err) {
      console.error('[social] Error deleting post:', err)
      res.status(500).json({ error: 'Failed to delete post' })
    }
  })

  // POST /forum/posts/:postId/vote - Upvote/downvote post
  router.post('/posts/:postId/vote', async (req: AuthedRequest, res: Response) => {
    const { postId } = req.params
    const { vote } = req.body // 'up' or 'down'
    const userId = req.userId

    if (!vote || !['up', 'down'].includes(vote)) {
      return res.status(400).json({ error: 'vote must be "up" or "down"' })
    }

    try {
      // Upsert vote (ON CONFLICT updates existing vote)
      await pool.query(
        `INSERT INTO forum.post_votes (post_id, user_id, vote_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (post_id, user_id) 
         DO UPDATE SET vote_type = $3, created_at = now()`,
        [postId, userId, vote]
      )

      // Get updated vote counts
      const { rows } = await pool.query(
        'SELECT upvotes, downvotes FROM forum.posts WHERE id = $1',
        [postId]
      )

      res.json({
        post_id: postId,
        user_id: userId,
        vote,
        upvotes: rows[0]?.upvotes || 0,
        downvotes: rows[0]?.downvotes || 0,
      })
    } catch (err) {
      console.error('[social] Error voting on post:', err)
      res.status(500).json({ error: 'Failed to vote on post' })
    }
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
        try {
          // Get all comments for this post (nested structure via parent_id)
          const query = `
            SELECT 
              id, post_id, user_id, parent_id, content, upvotes, downvotes,
              created_at, updated_at
            FROM forum.comments
            WHERE post_id = $1
            ORDER BY created_at ASC
          `
          const { rows } = await pool.query(query, [postId])

          // Build nested structure
          const commentMap = new Map()
          const rootComments: any[] = []

          // First pass: create map of all comments
          rows.forEach((comment: any) => {
            commentMap.set(comment.id, { ...comment, replies: [] })
          })

          // Second pass: build tree
          rows.forEach((comment: any) => {
            const commentNode = commentMap.get(comment.id)
            if (comment.parent_id) {
              const parent = commentMap.get(comment.parent_id)
              if (parent) {
                parent.replies.push(commentNode)
              } else {
                // Orphan comment (parent deleted), treat as root
                rootComments.push(commentNode)
              }
            } else {
              rootComments.push(commentNode)
            }
          })

          return {
            post_id: postId,
            comments: rootComments,
          }
        } catch (err) {
          console.error('[social] Error fetching comments:', err)
          throw err
        }
      }
    )

    res.json(result)
  })

  // POST /forum/posts/:postId/comments - Add comment
  router.post('/posts/:postId/comments', async (req: AuthedRequest, res: Response) => {
    const { postId } = req.params
    const { content, parent_id } = req.body
    const userId = req.userId

    if (!content) {
      return res.status(400).json({ error: 'content required' })
    }

    try {
      // Insert comment
      const insertQuery = `
        INSERT INTO forum.comments (post_id, user_id, parent_id, content)
        VALUES ($1, $2, $3, $4)
        RETURNING id, post_id, user_id, parent_id, content, upvotes, downvotes,
                  created_at, updated_at
      `
      const { rows } = await pool.query(insertQuery, [postId, userId, parent_id || null, content])
      const comment = rows[0]

      // Publish to Kafka for real-time notifications
      try {
        const producer = await getKafkaProducer()
        if (producer) {
          await producer.send({
            topic: 'forum-comments',
            messages: [
              {
                key: postId,
                value: JSON.stringify({
                  comment_id: comment.id,
                  post_id: postId,
                  user_id: userId,
                  parent_id: parent_id || null,
                  content,
                  created_at: comment.created_at,
                  event_type: 'comment_created',
                }),
              },
            ],
          })
        }
      } catch (err) {
        console.warn('[social] Kafka publish failed (non-fatal):', err)
      }

      res.status(201).json(comment)
    } catch (err: any) {
      console.error('[social] Error creating comment:', err)
      res.status(500).json({ error: 'Failed to create comment' })
    }
  })

  // PUT /forum/comments/:commentId - Update comment (author only)
  router.put('/comments/:commentId', async (req: AuthedRequest, res: Response) => {
    const { commentId } = req.params
    const { content } = req.body
    const userId = req.userId

    if (!content) {
      return res.status(400).json({ error: 'content required' })
    }

    try {
      // Verify author owns the comment
      const checkQuery = await pool.query(
        'SELECT user_id FROM forum.comments WHERE id = $1',
        [commentId]
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Comment not found' })
      }
      if (checkQuery.rows[0].user_id !== userId) {
        return res.status(403).json({ error: 'You can only edit your own comments' })
      }

      const updateQuery = `
        UPDATE forum.comments
        SET content = $1, updated_at = now()
        WHERE id = $2
        RETURNING id, post_id, user_id, parent_id, content, upvotes, downvotes,
                  created_at, updated_at
      `
      const { rows } = await pool.query(updateQuery, [content, commentId])

      res.json(rows[0])
    } catch (err) {
      console.error('[social] Error updating comment:', err)
      res.status(500).json({ error: 'Failed to update comment' })
    }
  })

  // DELETE /forum/comments/:commentId - Delete comment (author or admin)
  router.delete('/comments/:commentId', async (req: AuthedRequest, res: Response) => {
    const { commentId } = req.params
    const userId = req.userId

    try {
      // Verify author owns the comment
      const checkQuery = await pool.query(
        'SELECT user_id FROM forum.comments WHERE id = $1',
        [commentId]
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Comment not found' })
      }
      if (checkQuery.rows[0].user_id !== userId) {
        return res.status(403).json({ error: 'You can only delete your own comments' })
      }

      await pool.query('DELETE FROM forum.comments WHERE id = $1', [commentId])
      res.status(204).end()
    } catch (err) {
      console.error('[social] Error deleting comment:', err)
      res.status(500).json({ error: 'Failed to delete comment' })
    }
  })

  // POST /forum/comments/:commentId/vote - Vote on comment
  router.post('/comments/:commentId/vote', async (req: AuthedRequest, res: Response) => {
    const { commentId } = req.params
    const { vote } = req.body
    const userId = req.userId

    if (!vote || !['up', 'down'].includes(vote)) {
      return res.status(400).json({ error: 'vote must be "up" or "down"' })
    }

    try {
      // Upsert vote
      await pool.query(
        `INSERT INTO forum.comment_votes (comment_id, user_id, vote_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (comment_id, user_id) 
         DO UPDATE SET vote_type = $3, created_at = now()`,
        [commentId, userId, vote]
      )

      // Get updated vote counts
      const { rows } = await pool.query(
        'SELECT upvotes, downvotes FROM forum.comments WHERE id = $1',
        [commentId]
      )

      res.json({
        comment_id: commentId,
        user_id: userId,
        vote,
        upvotes: rows[0]?.upvotes || 0,
        downvotes: rows[0]?.downvotes || 0,
      })
    } catch (err) {
      console.error('[social] Error voting on comment:', err)
      res.status(500).json({ error: 'Failed to vote on comment' })
    }
  })

  return router
}
