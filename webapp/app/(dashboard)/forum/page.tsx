'use client'

import { useState, useEffect } from 'react'
import type { ReactElement, ChangeEvent, MouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowUp, ArrowDown, MessageCircle, Share2, Bookmark, MoreHorizontal, Image as ImageIcon } from 'lucide-react'
import { AttachmentUpload, type AttachmentFile } from '@/components/ui/attachment-upload'

type PostFlair = 'discussion' | 'question' | 'showcase' | 'trade' | 'wanted' | 'sale' | 'news'

type Attachment = {
  id: string
  file_url: string
  thumbnail_url?: string
  file_name?: string
  file_type: 'image' | 'video' | 'audio' | 'document' | 'other'
  width?: number
  height?: number
}

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
  attachments?: Attachment[]
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
  attachments?: Attachment[]
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

export default function ForumPage(): ReactElement {
  const [posts, setPosts] = useState<ForumPost[]>([])
  const [selectedPost, setSelectedPost] = useState<ForumPost | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [showCreatePost, setShowCreatePost] = useState(false)
  const [newPost, setNewPost] = useState({ title: '', content: '', flair: 'discussion' as PostFlair })
  const [newComment, setNewComment] = useState({ content: '', parentId: '' })
  const [loading, setLoading] = useState(false)
  const [postAttachments, setPostAttachments] = useState<AttachmentFile[]>([])
  const [commentAttachments, setCommentAttachments] = useState<AttachmentFile[]>([])

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
      const response = await fetch('/api/forum/posts')
      if (response.ok) {
        const data = await response.json()
        const postsData = data.posts || Array.isArray(data) ? (data.posts || data) : []
        // Fetch attachments for each post
        const postsWithAttachments = await Promise.all(
          postsData.map(async (post: ForumPost) => {
            try {
              const attResponse = await fetch(`/api/forum/posts/${post.id}/attachments`)
              if (attResponse.ok) {
                const attData = await attResponse.json()
                return { ...post, attachments: attData.attachments || [] }
              }
            } catch (err) {
              console.error(`Failed to fetch attachments for post ${post.id}:`, err)
            }
            return { ...post, attachments: [] }
          })
        )
        setPosts(postsWithAttachments)
      } else {
        setPosts([])
      }
    } catch (error) {
      console.error('Failed to fetch posts:', error)
      setPosts([])
    }
  }

  async function fetchComments(postId: string) {
    try {
      const response = await fetch(`/api/forum/posts/${postId}/comments`)
      if (response.ok) {
        const data = await response.json()
        const commentsData = data.comments || Array.isArray(data) ? (data.comments || data) : []
        // Fetch attachments for each comment
        const commentsWithAttachments = await Promise.all(
          commentsData.map(async (comment: Comment) => {
            try {
              const attResponse = await fetch(`/api/forum/comments/${comment.id}/attachments`)
              if (attResponse.ok) {
                const attData = await attResponse.json()
                return { ...comment, attachments: attData.attachments || [] }
              }
            } catch (err) {
              console.error(`Failed to fetch attachments for comment ${comment.id}:`, err)
            }
            return { ...comment, attachments: [] }
          })
        )
        setComments(commentsWithAttachments)
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
        const postData = await response.json()
        // Upload attachments if any
        if (postAttachments.length > 0) {
          for (const attachment of postAttachments) {
            try {
              await fetch(`/api/forum/posts/${postData.id}/attachments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  file_url: attachment.file_url || URL.createObjectURL(attachment.file),
                  file_type: attachment.file_type,
                  file_name: attachment.file_name,
                  file_size: attachment.file_size,
                  mime_type: attachment.mime_type,
                  thumbnail_url: attachment.thumbnail_url,
                }),
              })
            } catch (err) {
              console.error('Failed to upload attachment:', err)
            }
          }
        }
        setNewPost({ title: '', content: '', flair: 'discussion' })
        setPostAttachments([])
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
        body: JSON.stringify({ content: newComment.content, parent_id: parentId }),
      })
      if (response.ok) {
        const commentData = await response.json()
        // Upload attachments if any
        if (commentAttachments.length > 0) {
          for (const attachment of commentAttachments) {
            try {
              await fetch(`/api/forum/comments/${commentData.id}/attachments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  file_url: attachment.file_url || URL.createObjectURL(attachment.file),
                  file_type: attachment.file_type,
                  file_name: attachment.file_name,
                  file_size: attachment.file_size,
                  mime_type: attachment.mime_type,
                  thumbnail_url: attachment.thumbnail_url,
                }),
              })
            } catch (err) {
              console.error('Failed to upload comment attachment:', err)
            }
          }
        }
        setNewComment({ content: '', parentId: '' })
        setCommentAttachments([])
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
        void fetchPosts().then(async () => {
          const updated = posts.find((p: ForumPost) => p.id === postId)
          if (updated) {
            // Fetch attachments for the updated post
            try {
              const attResponse = await fetch(`/api/forum/posts/${postId}/attachments`)
              if (attResponse.ok) {
                const attData = await attResponse.json()
                setSelectedPost({ ...updated, attachments: attData.attachments || [] })
              } else {
                setSelectedPost(updated)
              }
            } catch (err) {
              setSelectedPost(updated)
            }
          }
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
          {comment.attachments && comment.attachments.length > 0 && (
            <div className="grid grid-cols-2 gap-2 my-2">
              {comment.attachments.map((att) => (
                <div key={att.id} className="rounded-lg overflow-hidden border border-slate-200 dark:border-white/10">
                  {att.file_type === 'image' && (
                    <img
                      src={att.thumbnail_url || att.file_url}
                      alt={att.file_name || 'Attachment'}
                      className="w-full h-32 object-cover"
                    />
                  )}
                  {att.file_type === 'video' && (
                    <video
                      src={att.file_url}
                      controls
                      className="w-full h-32 object-cover"
                    />
                  )}
                  {att.file_type !== 'image' && att.file_type !== 'video' && (
                    <div className="p-4 bg-slate-100 dark:bg-slate-800 flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      <span className="text-xs truncate">{att.file_name || 'Attachment'}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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
                <Badge variant={flairColors[selectedPost.flair as PostFlair]}>
                  {flairLabels[selectedPost.flair as PostFlair]}
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
              {selectedPost.attachments && selectedPost.attachments.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                  {selectedPost.attachments.map((att: Attachment) => (
                    <div key={att.id} className="rounded-lg overflow-hidden border border-slate-200 dark:border-white/10">
                      {att.file_type === 'image' && (
                        <img
                          src={att.thumbnail_url || att.file_url}
                          alt={att.file_name || 'Attachment'}
                          className="w-full h-48 object-cover cursor-pointer hover:opacity-80"
                          onClick={() => window.open(att.file_url, '_blank')}
                        />
                      )}
                      {att.file_type === 'video' && (
                        <video
                          src={att.file_url}
                          controls
                          className="w-full h-48 object-cover"
                        />
                      )}
                      {att.file_type !== 'image' && att.file_type !== 'video' && (
                        <div className="p-4 bg-slate-100 dark:bg-slate-800">
                          <a
                            href={att.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm hover:text-brand"
                          >
                            <ImageIcon className="h-4 w-4" />
                            <span className="truncate">{att.file_name || 'Attachment'}</span>
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNewComment((prev: { content: string; parentId: string }) => ({ ...prev, content: e.target.value }))}
              placeholder="Add a comment..."
              rows={4}
              className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
            />
            <AttachmentUpload
              onAttachmentsChange={setCommentAttachments}
              maxAttachments={5}
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
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewPost((prev: { title: string; content: string; flair: PostFlair }) => ({ ...prev, title: e.target.value }))}
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
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setNewPost((prev: { title: string; content: string; flair: PostFlair }) => ({ ...prev, flair: e.target.value as PostFlair }))}
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
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNewPost((prev: { title: string; content: string; flair: PostFlair }) => ({ ...prev, content: e.target.value }))}
                placeholder="What's on your mind?"
                rows={8}
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Attachments (optional)
              </label>
              <AttachmentUpload
                onAttachmentsChange={setPostAttachments}
                maxAttachments={10}
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
          posts.map((post: ForumPost) => (
            <div key={post.id} onClick={() => setSelectedPost(post)}>
              <Card className="cursor-pointer hover:shadow-lg transition-shadow">
              <div className="flex items-start gap-4">
                <div className="flex flex-col items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); votePost(post.id, 'up') }}>
                    <ArrowUp className="h-5 w-5" />
                  </Button>
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    {post.upvotes - post.downvotes}
                  </span>
                  <Button variant="ghost" size="sm" onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); votePost(post.id, 'down') }}>
                    <ArrowDown className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={flairColors[post.flair as PostFlair]}>
                      {flairLabels[post.flair as PostFlair]}
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
            </div>
          ))
        )}
      </div>
    </div>
  )
}

