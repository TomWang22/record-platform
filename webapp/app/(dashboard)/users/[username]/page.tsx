'use client'

import { useParams } from 'next/navigation'

import { Card } from '@/components/ui/card'

export default function PublicProfilePage() {
  const params = useParams()
  const username = params.username as string

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">@{username}</h1>
      <Card>
        <p className="text-sm text-slate-500">Public seller profile shell. Feedback score and active listings — Phase H.</p>
      </Card>
    </div>
  )
}
