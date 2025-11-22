'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowUp, ArrowDown, MessageCircle, Share2, Bookmark, MoreHorizontal } from 'lucide-react'

type PostFlair = 'discussion' | 'question' | 'showcase' | 'trade' | 'wanted' | 'sale' | 'news'

type ForumPost = {
  id: string
  title: string
  content: string
  author: {
    id: string
    email: string
    username?: string
  }
  flair: PostFlair
  upvotes: number
  downvotes: number
  commentCount: number
  createdAt: string
  updatedAt?: string
  recordId?: string
  isPinned?: boolean
  isLocked?: boolean
}

type Comment = {
  id: string
  postId: string
  parentId?: string
  content: string
  author: {
    id: string
    email: string
    username?: string
  }
  upvotes: number
  downvotes: number
  createdAt: string
  replies?: Comment[]
}

const flairColors: Record<PostFlair, 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
  discussion: 'default',
  question: 'info',
  showcase: 'primary',
  trade: 'success',
  wanted: 'warning',
  sale: 'danger',
  news: 'info',
}

const flairLabels: Record<PostFlair, string> = {
  discussion: 'Discussion',
  question: 'Question',
  showcase: 'Showcase',
  trade: 'Trade',
  wanted: 'Wanted',
  sale: 'For Sale',
  news: 'News',
}

export default function ForumPage() {
  const [posts, setPosts] = useState<ForumPost[]>([])
  const [selectedPost, setSelectedPost] = useState<ForumPost | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [showCreatePost, setShowCreatePost] = useState(false)
  const [newPost, setNewPost] = useState({ title: '', content: '', flair: 'discussion' as PostFlair })
  const [newComment, setNewComment] = useState({ content: '', parentId: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void fetchPosts()
  }, [])

  useEffect(() => {
    if (selectedPost) {
      void fetchComments(selectedPost.id)
    }
  }, [selectedPost])

  async function fetchPosts() {
    try {
      // TODO: Replace with actual API call
      const response = await fetch('/api/forum/posts')
      if (response.ok) {
        const data = await response.json()
        setPosts(Array.isArray(data) ? data : [])
      } else {
        // Placeholder data for now
        setPosts([
          {
            id: '1',
            title: 'Welcome to the Record Collectors Forum!',
            content: 'This is a place for collectors to discuss records, share finds, ask questions, and connect with other vinyl enthusiasts.',
            author: { id: 'admin', email: 'admin@recordplatform.com', username: 'Admin' },
            flair: 'news',
            upvotes: 42,
            downvotes: 0,
            commentCount: 5,
            createdAt: new Date().toISOString(),
            isPinned: true,
          },
        ])
      }
    } catch (error) {
      console.error('Failed to fetch posts:', error)
      // Placeholder data on error
      setPosts([])
    }
  }

  async function fetchComments(postId: string) {
    try {
      // TODO: Replace with actual API call
      const response = await fetch(`/api/forum/posts/${postId}/comments`)
      if (response.ok) {
        const data = await response.json()
        setComments(Array.isArray(data) ? data : [])
      } else {
        setComments([])
      }
    } catch (error) {
      console.error('Failed to fetch comments:', error)
      setComments([])
    }
  }

  async function createPost() {
    if (!newPost.title || !newPost.content) return
    setLoading(true)
    try {
      const response = await fetch('/api/forum/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPost),
      })
      if (response.ok) {
        setNewPost({ title: '', content: '', flair: 'discussion' })
        setShowCreatePost(false)
        void fetchPosts()
      }
    } catch (error) {
      console.error('Failed to create post:', error)
    } finally {
      setLoading(false)
    }
  }

  async function createComment(postId: string, parentId?: string) {
    if (!newComment.content) return
    setLoading(true)
    try {
      const response = await fetch(`/api/forum/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newComment.content, parentId }),
      })
      if (response.ok) {
        setNewComment({ content: '', parentId: '' })
        void fetchComments(postId)
      }
    } catch (error) {
      console.error('Failed to create comment:', error)
    } finally {
      setLoading(false)
    }
  }

  async function votePost(postId: string, vote: 'up' | 'down') {
    try {
      await fetch(`/api/forum/posts/${postId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote }),
      })
      void fetchPosts()
      if (selectedPost?.id === postId) {
        void fetchPosts().then(() => {
          const updated = posts.find((p) => p.id === postId)
          if (updated) setSelectedPost(updated)
        })
      }
    } catch (error) {
      console.error('Failed to vote:', error)
    }
  }

  async function voteComment(commentId: string, vote: 'up' | 'down') {
    try {
      // TODO: Implement comment voting endpoint
      // await fetch(`/api/forum/comments/${commentId}/vote`, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ vote }),
      // })
      if (selectedPost) {
        void fetchComments(selectedPost.id)
      }
    } catch (error) {
      console.error('Failed to vote on comment:', error)
    }
  }

  function renderComments(commentList: Comment[], depth = 0) {
    return commentList.map((comment) => (
      <div key={comment.id} className={depth > 0 ? 'ml-8 mt-3 border-l-2 border-slate-200 dark:border-slate-700 pl-4' : ''}>
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-900 dark:text-white">
                {comment.author.username || comment.author.email}
              </span>
              <span className="text-xs text-slate-400">
                {new Date(comment.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => voteComment(comment.id, 'up')}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <span className="text-xs text-slate-600 dark:text-slate-400">
                {comment.upvotes - comment.downvotes}
              </span>
              <Button variant="ghost" size="sm" onClick={() => voteComment(comment.id, 'down')}>
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">{comment.content}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNewComment({ content: '', parentId: comment.id })
              // Scroll to comment input
              document.getElementById('comment-input')?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            Reply
          </Button>
          {comment.replies && comment.replies.length > 0 && (
            <div className="mt-3">{renderComments(comment.replies, depth + 1)}</div>
          )}
        </div>
      </div>
    ))
  }

  if (selectedPost) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setSelectedPost(null)}>
            ← Back to Forum
          </Button>
        </div>

        <Card>
          <div className="flex items-start gap-4 mb-4">
            <div className="flex flex-col items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => votePost(selectedPost.id, 'up')}>
                <ArrowUp className="h-5 w-5" />
              </Button>
              <span className="text-sm font-semibold text-slate-900 dark:text-white">
                {selectedPost.upvotes - selectedPost.downvotes}
              </span>
              <Button variant="ghost" size="sm" onClick={() => votePost(selectedPost.id, 'down')}>
                <ArrowDown className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={flairColors[selectedPost.flair]}>
                  {flairLabels[selectedPost.flair]}
                </Badge>
                {selectedPost.isPinned && <Badge variant="warning">Pinned</Badge>}
                {selectedPost.isLocked && <Badge variant="danger">Locked</Badge>}
              </div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                {selectedPost.title}
              </h1>
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-4">
                <span>by {selectedPost.author.username || selectedPost.author.email}</span>
                <span>•</span>
                <span>{new Date(selectedPost.createdAt).toLocaleString()}</span>
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{selectedPost.content}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card title={`${comments.length} Comments`}>
          <div className="space-y-4 mb-6">
            {comments.length === 0 ? (
              <p className="text-sm text-slate-400">No comments yet. Be the first to comment!</p>
            ) : (
              renderComments(comments)
            )}
          </div>

          <div id="comment-input" className="space-y-3">
            {newComment.parentId && (
              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-2 text-xs text-slate-600 dark:text-slate-400">
                Replying to comment...
              </div>
            )}
            <textarea
              value={newComment.content}
              onChange={(e) => setNewComment((prev) => ({ ...prev, content: e.target.value }))}
              placeholder="Add a comment..."
              rows={4}
              className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
            />
            <div className="flex gap-2">
              <Button
                onClick={() => createComment(selectedPost.id, newComment.parentId || undefined)}
                disabled={loading || !newComment.content}
              >
                {loading ? 'Posting...' : 'Post Comment'}
              </Button>
              {newComment.parentId && (
                <Button variant="ghost" onClick={() => setNewComment({ content: '', parentId: '' })}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Collectors Forum</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Discuss records, share finds, ask questions, and connect with other collectors.
          </p>
        </div>
        <Button onClick={() => setShowCreatePost(!showCreatePost)}>
          {showCreatePost ? 'Cancel' : 'Create Post'}
        </Button>
      </header>

      {showCreatePost && (
        <Card title="Create New Post">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Title <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                value={newPost.title}
                onChange={(e) => setNewPost((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Post title..."
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Flair
              </label>
              <select
                value={newPost.flair}
                onChange={(e) => setNewPost((prev) => ({ ...prev, flair: e.target.value as PostFlair }))}
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              >
                {Object.entries(flairLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Content <span className="text-rose-600">*</span>
              </label>
              <textarea
                value={newPost.content}
                onChange={(e) => setNewPost((prev) => ({ ...prev, content: e.target.value }))}
                placeholder="What's on your mind?"
                rows={8}
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={createPost} disabled={loading || !newPost.title || !newPost.content}>
                {loading ? 'Posting...' : 'Create Post'}
              </Button>
              <Button variant="ghost" onClick={() => setShowCreatePost(false)} disabled={loading}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {posts.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-400 text-center py-8">No posts yet. Be the first to post!</p>
          </Card>
        ) : (
          posts.map((post) => (
            <Card key={post.id} className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setSelectedPost(post)}>
              <div className="flex items-start gap-4">
                <div className="flex flex-col items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); votePost(post.id, 'up') }}>
                    <ArrowUp className="h-5 w-5" />
                  </Button>
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    {post.upvotes - post.downvotes}
                  </span>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); votePost(post.id, 'down') }}>
                    <ArrowDown className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={flairColors[post.flair]}>
                      {flairLabels[post.flair]}
                    </Badge>
                    {post.isPinned && <Badge variant="warning">Pinned</Badge>}
                    {post.isLocked && <Badge variant="danger">Locked</Badge>}
                  </div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2 hover:text-brand transition-colors">
                    {post.title}
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mb-3">
                    {post.content}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                    <span>by {post.author.username || post.author.email}</span>
                    <span>•</span>
                    <span>{new Date(post.createdAt).toLocaleString()}</span>
                    <span>•</span>
                    <div className="flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      <span>{post.commentCount} comments</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}

