'use client'

import { useParams } from 'next/navigation'

import { FeedbackPageContent } from '@/components/feedback/feedback-page-content'

export default function PublicFeedbackPage() {
  const params = useParams()
  const username = params.username as string

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Feedback for @{username}</h1>
      <FeedbackPageContent username={username} />
    </div>
  )
}
