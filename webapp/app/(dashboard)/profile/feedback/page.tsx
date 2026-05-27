'use client'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { Card } from '@/components/ui/card'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function ProfileFeedbackPage() {
  const { authRequired } = useRequireAuth()
  if (authRequired) return <AuthRequiredCard returnTo="/profile/feedback" title="Sign in" />
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Feedback</h1>
      <Card><p className="text-sm text-slate-500">Trust-service feedback summary — Phase H.</p></Card>
    </div>
  )
}
