'use client'

import { Suspense } from 'react'

import { MessagingProductView } from '@/components/messages/messaging-product-view'

function MessagesLoading() {
  return (
    <p className="text-sm text-slate-500" data-testid="messages-loading">
      Loading messages…
    </p>
  )
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<MessagesLoading />}>
      <MessagingProductView />
    </Suspense>
  )
}
