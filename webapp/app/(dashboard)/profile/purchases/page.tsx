'use client'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { Card } from '@/components/ui/card'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function ProfilePurchasesPage() {
  const { authRequired } = useRequireAuth()
  if (authRequired) return <AuthRequiredCard returnTo="/profile/purchases" title="Sign in" />
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Purchases</h1>
      <Card><p className="text-sm text-slate-500">Purchase history from acquisition fields — Phase H.</p></Card>
    </div>
  )
}
