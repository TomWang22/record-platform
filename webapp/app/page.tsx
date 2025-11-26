'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getClientSessionToken } from '@/lib/session'
import config from '@/lib/config'

const features = [
  {
    title: 'Manage Your Collection',
    description: 'Catalog your vinyl records with detailed metadata, condition tracking, and custom notes.',
    icon: '📀',
  },
  {
    title: 'AI Price Predictions',
    description: 'Get intelligent price estimates and market insights powered by machine learning.',
    icon: '🤖',
  },
  {
    title: 'Auction Monitoring',
    description: 'Track active auctions and get alerts when items you want are up for bid.',
    icon: '🔔',
  },
  {
    title: 'Marketplace Integration',
    description: 'Search listings, manage your watchlist, and track trending items across platforms.',
    icon: '🛒',
  },
  {
    title: 'Social Features',
    description: 'Connect with other collectors, share your collection, and join discussions.',
    icon: '👥',
  },
  {
    title: 'Analytics & Insights',
    description: 'View detailed statistics about your collection, spending, and market trends.',
    icon: '📊',
  },
]

export default function Home() {
  const router = useRouter()
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    // Check if user is authenticated
    const checkAuth = () => {
      const token = getClientSessionToken()
      setIsAuthenticated(!!token)
    }
    checkAuth()
    // Listen for storage changes (when user logs in/out in another tab)
    window.addEventListener('storage', checkAuth)
    // Also check on focus (in case user logged in in another tab)
    window.addEventListener('focus', checkAuth)
    return () => {
      window.removeEventListener('storage', checkAuth)
      window.removeEventListener('focus', checkAuth)
    }
  }, [])

  return (
    <main className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="mx-auto max-w-6xl text-center">
          <h1 className="text-5xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-6xl lg:text-7xl">
            Your Vinyl Collection,
            <br />
            <span className="text-brand">Elevated</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600 dark:text-slate-300 sm:text-xl">
            {config.appName} helps collectors manage, track, and discover vinyl records with AI-powered insights,
            auction monitoring, and marketplace integration.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            {isAuthenticated ? (
              <>
                <Button asChild size="lg">
                  <Link href="/dashboard">Go to Dashboard</Link>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/records">Browse Collection</Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link href="/register">Get Started</Link>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/login">Sign In</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-white px-4 py-20 dark:bg-slate-900">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
              Everything you need to manage your collection
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
              Powerful tools designed for serious collectors
            </p>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title} className="text-center">
                <div className="mb-4 text-4xl">{feature.icon}</div>
                <h3 className="text-xl font-semibold text-slate-900 dark:text-white">{feature.title}</h3>
                <p className="mt-2 text-slate-600 dark:text-slate-400">{feature.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-br from-brand/10 to-brand/5 px-4 py-20 dark:from-brand/20 dark:to-brand/10">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
            Ready to organize your collection?
          </h2>
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
            Join collectors who are already using {config.appName} to manage their vinyl records.
          </p>
          <div className="mt-8">
            {isAuthenticated ? (
              <Button asChild size="lg">
                <Link href="/dashboard">Open Dashboard</Link>
              </Button>
            ) : (
              <Button asChild size="lg">
                <Link href="/register">Create Free Account</Link>
              </Button>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
