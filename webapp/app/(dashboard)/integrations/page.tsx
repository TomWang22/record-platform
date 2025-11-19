'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import config from '@/lib/config'

export default function IntegrationsPage() {
  const router = useRouter()
  const [linking, setLinking] = useState(false)

  function startDiscogsOAuth() {
    setLinking(true)
    // Redirect to the gateway's OAuth start endpoint
    const gatewayUrl = config.gatewayUrl.replace(/\/$/, '')
    window.location.href = `${gatewayUrl}/listings/oauth/discogs/start`
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Integrations</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Connect external services to sync your catalog and import listings.
        </p>
      </header>

      <Card
        title="Discogs"
        description="Link your Discogs account to import collection data and sync marketplace listings."
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Connect your Discogs account to enable automatic collection syncing and marketplace price tracking.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              OAuth 1.0 flow — you'll be redirected to Discogs to authorize access.
            </p>
          </div>
          <Button onClick={startDiscogsOAuth} disabled={linking}>
            {linking ? 'Connecting…' : 'Link Discogs account'}
          </Button>
        </div>
      </Card>

      <Card
        title="eBay"
        description="eBay marketplace search is available without authentication. OAuth integration coming soon."
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Search eBay listings directly from the Marketplace page. Full OAuth integration for watchlists and saved
              searches is planned.
            </p>
          </div>
          <Button variant="secondary" disabled>
            Coming soon
          </Button>
        </div>
      </Card>
    </div>
  )
}











