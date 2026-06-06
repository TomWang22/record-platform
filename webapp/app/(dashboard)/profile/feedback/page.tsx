'use client'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { FeedbackPageContent } from '@/components/feedback/feedback-page-content'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function ProfileFeedbackPage() {
  const { authRequired } = useRequireAuth()
  if (authRequired) {
    return <AuthRequiredCard returnTo="/profile/feedback" title="Sign in to view feedback" />
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Feedback</h1>
      <FeedbackPageContent />
    </div>
  )
}
