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

const services = [
  {
    name: 'Auth Service',
    description: 'Secure authentication with Google OAuth, SMS verification, Passkey/WebAuthn, and MFA/TOTP support.',
    icon: '🔐',
  },
  {
    name: 'Records Service',
    description: 'Core collection management with full CRUD operations, search, and Redis-backed caching.',
    icon: '📚',
  },
  {
    name: 'Listings Service',
    description: 'eBay integration, marketplace search, watchlists, and auction tracking.',
    icon: '📋',
  },
  {
    name: 'Social Service',
    description: 'Reddit-style forum, P2P messaging, group chats, and community features.',
    icon: '💬',
  },
  {
    name: 'Analytics Service',
    description: 'Price snapshots, market trends, and business intelligence with granular percentiles (p1-p99).',
    icon: '📈',
  },
  {
    name: 'Shopping Service',
    description: 'Shopping cart, checkout, order management, and purchase history.',
    icon: '🛍️',
  },
  {
    name: 'Auction Monitor',
    description: 'Real-time auction tracking, price alerts, and Discogs price history integration.',
    icon: '🔍',
  },
  {
    name: 'Python AI Service',
    description: 'AI-powered grade predictions, price recommendations, and negotiation assistance.',
    icon: '🧠',
  },
]

const problems = [
  {
    title: 'Incomplete Price Data',
    description: 'Discogs is crowdsourced with incomplete data. eBay listings often hide final prices. Popsike and Gripsweat lack comprehensive information.',
    icon: '❌',
  },
  {
    title: 'Manual Data Entry',
    description: 'Unless you work at a record store, pricing history requires constant manual monitoring and database entry—tedious busy work.',
    icon: '⏰',
  },
  {
    title: 'Speedrunning Collections',
    description: 'Building a comprehensive collection quickly reveals fundamental gaps in existing tools. The overhead becomes prohibitive.',
    icon: '🏃',
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
            {config.appName} automates the tedious aspects of collection management while providing the technical depth
            needed for serious collectors. AI-powered insights, automated auction monitoring, and comprehensive
            marketplace integration.
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

      {/* Why Section - The Problem */}
      <section className="bg-slate-50 px-4 py-20 dark:bg-slate-900">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
              Why Record Platform Exists
            </h2>
            <p className="mt-4 max-w-3xl mx-auto text-lg text-slate-600 dark:text-slate-400">
              Record collecting is harder than it should be. Existing tools and marketplaces have significant
              limitations that make intelligent collection management nearly impossible.
            </p>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {problems.map((problem) => (
              <Card key={problem.title} className="p-6">
                <div className="mb-4 text-4xl">{problem.icon}</div>
                <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">{problem.title}</h3>
                <p className="text-slate-600 dark:text-slate-400">{problem.description}</p>
              </Card>
            ))}
          </div>
          <div className="mt-12 text-center">
            <p className="text-lg text-slate-700 dark:text-slate-300 max-w-3xl mx-auto">
              <strong>The Realization:</strong> If someone with a computer science background finds this process to be
              mostly "busy work," what chance do traditional record shops have? Or collectors who are the majority of
              the audience? This was the core motivation for building Record Platform—a system that automates the
              tedious aspects while providing the technical depth needed for serious collectors.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works - Services Architecture */}
      <section className="bg-white px-4 py-20 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
              How It Works: Microservices Architecture
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
              Record Platform is built on a modern microservices architecture with 8+ dedicated services, each
              handling a specific domain. This ensures scalability, maintainability, and independent deployment.
            </p>
          </div>
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((service) => (
              <Card key={service.name} className="p-6 hover:shadow-lg transition-shadow">
                <div className="mb-3 text-3xl">{service.icon}</div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">{service.name}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">{service.description}</p>
              </Card>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Card className="p-8 bg-gradient-to-br from-brand/10 to-brand/5 dark:from-brand/20 dark:to-brand/10">
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                Powered by Modern Infrastructure
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-6 text-sm">
                <div>
                  <strong className="text-slate-900 dark:text-white">8 Dedicated Databases</strong>
                  <p className="text-slate-600 dark:text-slate-400 mt-1">Complete service isolation</p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">gRPC Communication</strong>
                  <p className="text-slate-600 dark:text-slate-400 mt-1">Type-safe inter-service calls</p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">Kafka Event Streaming</strong>
                  <p className="text-slate-600 dark:text-slate-400 mt-1">Real-time messaging & events</p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">HTTP/2 & HTTP/3</strong>
                  <p className="text-slate-600 dark:text-slate-400 mt-1">Modern protocol support</p>
                </div>
              </div>
              <div className="mt-6">
                <Button asChild variant="outline">
                  <Link href="/about">Learn More About Architecture</Link>
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-slate-50 px-4 py-20 dark:bg-slate-900">
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
              <Card key={feature.title} className="p-6 text-center">
                <div className="mb-4 text-4xl">{feature.icon}</div>
                <h3 className="text-xl font-semibold text-slate-900 dark:text-white">{feature.title}</h3>
                <p className="mt-2 text-slate-600 dark:text-slate-400">{feature.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Solution Section */}
      <section className="bg-white px-4 py-20 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">The Solution</h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
              Record Platform solves these problems by providing comprehensive automation and intelligent insights
            </p>
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-2">
            <Card className="p-8">
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">
                🎯 Comprehensive Price Tracking
              </h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Automated auction monitoring and price history collection. No more manual data entry—the platform tracks
                prices across multiple marketplaces automatically.
              </p>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 space-y-2">
                <li>Real-time auction monitoring</li>
                <li>Discogs price history integration</li>
                <li>Granular percentile analysis (p1-p99)</li>
                <li>Automated price alerts</li>
              </ul>
            </Card>
            <Card className="p-8">
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">
                🤖 Intelligent Recommendations
              </h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                AI-powered grade predictions and price recommendations. Get seller intelligence for optimal pricing and
                buyer intelligence for deal detection.
              </p>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 space-y-2">
                <li>AI-powered price predictions</li>
                <li>Grade recommendations</li>
                <li>Negotiation assistance</li>
                <li>Market trend analysis</li>
              </ul>
            </Card>
            <Card className="p-8">
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">
                📚 Complete Collection Management
              </h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Full CRUD with search, filtering, and categorization. Redis-backed caching ensures fast searches even
                with large collections.
              </p>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 space-y-2">
                <li>Fast search with caching</li>
                <li>Detailed metadata tracking</li>
                <li>Condition and grading</li>
                <li>Custom notes and tags</li>
              </ul>
            </Card>
            <Card className="p-8">
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">
                🌐 Marketplace & Community
              </h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                eBay integration, listings management, watchlists, and community features. Connect with other
                collectors, share your collection, and join discussions.
              </p>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 space-y-2">
                <li>eBay marketplace integration</li>
                <li>Reddit-style forum</li>
                <li>P2P messaging and group chats</li>
                <li>Real-time updates via Kafka</li>
              </ul>
            </Card>
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
            Join collectors who are already using {config.appName} to manage their vinyl records. Get started with
            automated price tracking, AI-powered insights, and comprehensive collection management.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            {isAuthenticated ? (
              <Button asChild size="lg">
                <Link href="/dashboard">Open Dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link href="/register">Create Free Account</Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/about">Learn More</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
