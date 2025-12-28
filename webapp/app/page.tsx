'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getClientSessionToken } from '@/lib/session'
import config from '@/lib/config'

const buyerFeatures = [
  {
    title: 'Never Overpay Again',
    description: 'Get real-time price intelligence before you buy. See exactly where a record sits in the market (top 1%, 25%, 50%, etc.) so you know if it\'s a great deal or overpriced.',
    icon: '💰',
  },
  {
    title: 'Automated Auction Tracking',
    description: 'Stop manually checking eBay and Discogs. Our system tracks auctions 24/7 and alerts you when items you want are listed or prices drop.',
    icon: '🔔',
  },
  {
    title: 'AI-Powered Negotiation Help',
    description: 'Not sure what to offer? Our AI analyzes market data and tells you the perfect price to propose—whether you\'re buying or selling.',
    icon: '🤝',
  },
  {
    title: 'Smart Collection Management',
    description: 'Catalog your entire collection in one place. Track condition, value, and market trends automatically—no spreadsheets needed.',
    icon: '📀',
  },
  {
    title: 'Deal Detection',
    description: 'Instantly identify undervalued records. Get notified when prices drop into your target range based on historical sales data.',
    icon: '🎯',
  },
  {
    title: 'Community & Connections',
    description: 'Connect with other collectors, share finds, get advice, and join discussions. It\'s like Reddit, but just for record collectors.',
    icon: '👥',
  },
]

const sellerFeatures = [
  {
    title: 'Optimal Pricing Every Time',
    description: 'Know exactly where to price your records for maximum profit and fastest sales. Get recommendations based on real market data, not guesswork.',
    icon: '💵',
  },
  {
    title: 'Smart Starting Bid Guidance',
    description: 'Struggling with auction starting prices? Our AI analyzes successful auctions and recommends the perfect starting bid to maximize interest.',
    icon: '📊',
  },
  {
    title: 'OBO (Or Best Offer) Intelligence',
    description: 'Show buyers you\'re flexible without giving away too much. Get guidance on how much room to leave for negotiation based on market trends.',
    icon: '💡',
  },
  {
    title: 'Inventory Movement Optimization',
    description: 'Move inventory quickly without desperation pricing. Our system finds the sweet spot between speed and profit for fixed-price listings.',
    icon: '⚡',
  },
  {
    title: 'Market Trend Analysis',
    description: 'See which genres, artists, and pressings are trending up or down. Adjust your inventory strategy based on real data.',
    icon: '📈',
  },
  {
    title: 'Competitive Intelligence',
    description: 'Track what similar shops are doing. See successful listing strategies, pricing patterns, and market positioning that works.',
    icon: '🔍',
  },
]

const problems = [
  {
    title: 'Price Data is Incomplete or Hidden',
    description: 'Discogs relies on user submissions—data is often missing or outdated. eBay hides final sale prices. Popsike and Gripsweat have gaps. You\'re flying blind.',
    icon: '❌',
    audience: 'Everyone',
  },
  {
    title: 'Manual Price Tracking is Exhausting',
    description: 'Unless you work at a record store full-time, keeping up with price trends means hours of manual research and database entry. It\'s tedious busy work that takes you away from collecting.',
    icon: '⏰',
    audience: 'Collectors',
  },
  {
    title: 'Pricing Without Data is Expensive',
    description: 'Price too high and items sit unsold. Price too low and you leave money on the table. Most shops price by gut feeling because comprehensive market data is too hard to get.',
    icon: '💸',
    audience: 'Sellers',
  },
  {
    title: 'Tools Don\'t Scale with Your Collection',
    description: 'Spreadsheets work for 50 records, but fall apart at 500. Existing platforms can\'t handle serious collectors who need speed, automation, and intelligence.',
    icon: '📈',
    audience: 'Collectors',
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
            Record Collecting,
            <br />
            <span className="text-brand">Made Intelligent</span>
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg text-slate-600 dark:text-slate-300 sm:text-xl">
            Stop guessing prices. Stop manual tracking. Start making smarter decisions with real-time market data, 
            AI-powered insights, and automated auction monitoring—whether you're building your collection or running a record shop.
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
                  <Link href="/register">Get Started Free</Link>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/login">Sign In</Link>
                </Button>
              </>
            )}
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <span>✓</span>
              <span>For Collectors</span>
            </div>
            <div className="flex items-center gap-2">
              <span>✓</span>
              <span>For Record Shops</span>
            </div>
            <div className="flex items-center gap-2">
              <span>✓</span>
              <span>For Physical Media Sellers</span>
            </div>
          </div>
        </div>
      </section>

      {/* Why Section - The Problem */}
      <section className="bg-slate-50 px-4 py-20 dark:bg-slate-900">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
              Why This Exists: The Problem
            </h2>
            <p className="mt-4 max-w-3xl mx-auto text-lg text-slate-600 dark:text-slate-400">
              Record collecting is harder than it should be. Whether you're a serious collector or running a shop, 
              you're dealing with incomplete data, manual tracking, and guesswork. Here's what's broken:
            </p>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-2">
            {problems.map((problem) => (
              <Card key={problem.title} className="p-6">
                <div className="flex items-start gap-4">
                  <div className="text-4xl flex-shrink-0">{problem.icon}</div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-xl font-semibold text-slate-900 dark:text-white">{problem.title}</h3>
                      <span className="text-xs px-2 py-1 bg-slate-200 dark:bg-slate-700 rounded text-slate-600 dark:text-slate-400">
                        {problem.audience}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">{problem.description}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Card className="p-8 bg-gradient-to-br from-brand/10 to-brand/5 dark:from-brand/20 dark:to-brand/10 max-w-4xl mx-auto">
              <p className="text-lg text-slate-800 dark:text-slate-200 leading-relaxed">
                <strong className="text-slate-900 dark:text-white">The Realization:</strong> If someone with a 
                computer science background finds price tracking to be mostly "busy work," what chance do traditional 
                record shops have? Or collectors who just want to build their collection without becoming data entry 
                specialists?<br /><br />
                <strong className="text-slate-900 dark:text-white">This was our motivation:</strong> Build a system 
                that automates the tedious parts—price tracking, auction monitoring, market analysis—so collectors can 
                collect, and shops can focus on selling, not spreadsheets.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* For Buyers Section */}
      <section className="bg-white px-4 py-20 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
              For Collectors & Record Shoppers
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400 max-w-3xl mx-auto">
              Build your collection intelligently. Know when to buy, what to pay, and when to wait—all backed by real market data.
            </p>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {buyerFeatures.map((feature) => (
              <Card key={feature.title} className="p-6 hover:shadow-lg transition-shadow">
                <div className="mb-4 text-4xl">{feature.icon}</div>
                <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">{feature.title}</h3>
                <p className="text-slate-600 dark:text-slate-400">{feature.description}</p>
              </Card>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Button asChild size="lg" variant="outline">
              <Link href="/register">Start Collecting Smarter →</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* For Sellers Section */}
      <section className="bg-slate-50 px-4 py-20 dark:bg-slate-900">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
              For Record Shops & Physical Media Sellers
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400 max-w-3xl mx-auto">
              Price with confidence. Move inventory faster. Maximize margins. Use real market data instead of guesswork.
            </p>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {sellerFeatures.map((feature) => (
              <Card key={feature.title} className="p-6 hover:shadow-lg transition-shadow">
                <div className="mb-4 text-4xl">{feature.icon}</div>
                <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">{feature.title}</h3>
                <p className="text-slate-600 dark:text-slate-400">{feature.description}</p>
              </Card>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Button asChild size="lg" variant="outline">
              <Link href="/register">Optimize Your Pricing →</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How It Works - Simple Explanation */}
      <section className="bg-white px-4 py-20 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
              How It Works
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400 max-w-3xl mx-auto">
              Simple, automated, intelligent. Here's what happens behind the scenes (you don't need to understand the tech—just know it works):
            </p>
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            <Card className="p-8 text-center">
              <div className="mb-4 text-5xl">🔍</div>
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">1. We Track Everything</h3>
              <p className="text-slate-600 dark:text-slate-400">
                Our system monitors auctions 24/7 across eBay, Discogs, and other marketplaces. Every sale, every price, 
                every listing—automatically captured and analyzed.
              </p>
            </Card>
            <Card className="p-8 text-center">
              <div className="mb-4 text-5xl">🧠</div>
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">2. AI Analyzes Data</h3>
              <p className="text-slate-600 dark:text-slate-400">
                Our AI processes millions of data points to calculate precise market positions. Is this record in the 
                top 1%? Bottom 25%? Perfect for negotiation? We know.
              </p>
            </Card>
            <Card className="p-8 text-center">
              <div className="mb-4 text-5xl">⚡</div>
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">3. You Make Better Decisions</h3>
              <p className="text-slate-600 dark:text-slate-400">
                Get instant recommendations, price alerts, and negotiation help—all in one place. No more guessing, 
                no more spreadsheets, no more missed deals.
              </p>
            </Card>
          </div>
          <div className="mt-12 text-center">
            <Card className="p-6 bg-slate-50 dark:bg-slate-900 max-w-3xl mx-auto">
              <p className="text-slate-600 dark:text-slate-400">
                <strong className="text-slate-900 dark:text-white">Built for scale:</strong> Our platform handles 
                millions of records and thousands of concurrent users. Whether you're tracking 10 records or 10,000, 
                performance stays fast. <Link href="/about" className="text-brand hover:underline ml-1">Learn about our architecture →</Link>
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* Key Questions FAQ */}
      <section className="bg-slate-50 px-4 py-20 dark:bg-slate-900">
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
              Common Questions
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
              Quick answers to help you understand what Record Platform is and why it exists
            </p>
          </div>
          <div className="space-y-6">
            <Card className="p-6">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">
                Why does this platform exist?
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                Record collecting shouldn't require hours of manual price tracking and data entry. Existing tools like 
                Discogs have incomplete data, eBay hides final prices, and there's no unified system that combines 
                automated tracking with intelligent pricing. We built this to eliminate the busy work so collectors can 
                collect and shops can sell—not manage spreadsheets.
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">
                Is this just for serious collectors?
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                No! While serious collectors love the automation and intelligence, casual collectors benefit too. 
                Want to know if that $50 record is a good deal? We'll tell you. Want to track a few wishlist items? 
                We'll alert you when prices drop. You don't need a massive collection to benefit.
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">
                How is this different from Discogs or eBay?
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                Discogs is a marketplace and database—great for cataloging, but price data is incomplete and manually 
                entered. eBay is a marketplace—great for buying, but final prices are often hidden. Record Platform 
                automatically tracks prices across ALL platforms, calculates precise market positions (not just averages), 
                and gives you AI-powered recommendations you won't find anywhere else.
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">
                Do I need technical knowledge to use this?
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                Absolutely not. If you can use eBay or Discogs, you can use Record Platform. The complex stuff—data 
                collection, AI analysis, automated monitoring—happens behind the scenes. You just see clear, actionable 
                insights when you need them.
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">
                Can record shops really use this?
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                Yes! In fact, shops might benefit the most. Instead of pricing by gut feeling or manual research, 
                you get data-driven recommendations for starting bids, fixed prices, and OBO flexibility. Move inventory 
                faster, maximize margins, and compete with big shops using the same intelligence tools.
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">
                What about physical media sellers (CDs, cassettes, etc.)?
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                While our focus started with vinyl, the same principles apply to all physical media. Price tracking, 
                market analysis, and intelligent recommendations work for CDs, cassettes, and other formats too. 
                We're building toward full multi-format support.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-br from-brand/10 to-brand/5 px-4 py-20 dark:from-brand/20 dark:to-brand/10">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
            Ready to Collect (or Sell) Smarter?
          </h2>
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
            Stop guessing. Stop manual tracking. Start making data-driven decisions with automated price intelligence 
            and AI-powered insights. Whether you're building a collection or running a shop, Record Platform gives you 
            the tools to succeed.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            {isAuthenticated ? (
              <Button asChild size="lg">
                <Link href="/dashboard">Open Dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link href="/register">Get Started Free</Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/about">See How It Works</Link>
                </Button>
              </>
            )}
          </div>
          <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
            Free to start • No credit card required • Works for collectors and shops
          </p>
        </div>
      </section>
    </main>
  )
}
