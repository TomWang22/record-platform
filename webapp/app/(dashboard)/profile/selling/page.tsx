'use client'

import Link from 'next/link'
import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { Card } from '@/components/ui/card'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function ProfileSellingPage() {
  const { authRequired } = useRequireAuth()
  if (authRequired) return <AuthRequiredCard returnTo="/profile/selling" title="Sign in" />
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Selling</h1>
      <Card><p className="text-sm text-slate-500">Active and draft listings will appear here after listings API contract (Phase H).</p></Card>
      <Link href="/sell" className="text-sm text-brand">Create listing →</Link>
    </div>
  )
}
