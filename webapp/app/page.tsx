import { Card } from '@/components/ui/card'
import { AuthCta } from './_components/auth-cta'
import { LandingFooter, LandingHeader } from './_components/landing-header'

const collectorFeatures = [
  {
    title: 'Smart Catalog Management',
    description:
      'Catalog your entire collection in one place. Track condition, value, and market trends automatically.',
  },
  {
    title: 'Automated Auction Tracking',
    description:
      'Monitor eBay and Discogs listings 24/7. Get alerts when items you want are listed or prices drop.',
  },
  {
    title: 'AI-Powered Negotiation Help',
    description:
      'Not sure what to offer? Our AI analyzes market data and recommends the right price to propose.',
  },
  {
    title: 'Community and Connections',
    description:
      'Connect with other collectors, share finds, get advice, and join discussions around shared interests.',
  },
  {
    title: 'Gap Detection',
    description:
      'Identify missing pressings, variants, and releases in your collection. Surface what you should look for next.',
  },
]

const sellerFeatures = [
  {
    title: 'Optimal Pricing',
    description:
      'Price every record for maximum profit and fastest turnover using real market data, not guesswork.',
  },
  {
    title: 'Smart Listing Guidance',
    description:
      'Get starting-bid and fixed-price recommendations based on analysis of successful past auctions.',
  },
  {
    title: 'eBay and Discogs Offers Intelligence',
    description:
      'Understand how much negotiation room to leave for OBO listings based on current market dynamics.',
  },
  {
    title: 'Competitive Intelligence',
    description:
      'Track what similar shops are doing. See pricing patterns, listing strategies, and market positioning.',
  },
  {
    title: 'Inventory Movement Optimization',
    description:
      'Find the sweet spot between speed and profit. Move stock without resorting to desperation pricing.',
  },
  {
    title: 'Market Trend Analysis',
    description:
      'See which genres, artists, and pressings are trending up or down. Adjust strategy with real data.',
  },
]

const steps = [
  {
    step: 1,
    title: 'Track Everything',
    description:
      'Our system monitors auctions across eBay, Discogs, and other marketplaces around the clock. Every sale, every price, every listing is captured automatically.',
  },
  {
    step: 2,
    title: 'AI Analyzes Data',
    description:
      'Millions of data points are processed to calculate precise market positions. Top 1%? Bottom quartile? Good for negotiation? The system knows.',
  },
  {
    step: 3,
    title: 'You Make Better Decisions',
    description:
      'Get instant recommendations, price alerts, and negotiation guidance in one place. No more spreadsheets, no more guessing, no more missed deals.',
  },
]

const faqs = [
  {
    question: 'Why does this platform exist?',
    answer:
      'Existing tools have incomplete data, hidden prices, and no unified market intelligence. We built Record Platform to automate price tracking, auction monitoring, and market analysis so collectors can collect and shops can sell.',
  },
  {
    question: 'Is this only for serious collectors?',
    answer:
      'No. Casual collectors benefit just as much. Want to know if that record is a fair deal? We can tell you. Tracking a few wishlist items? We will alert you when prices drop.',
  },
  {
    question: 'How is this different from Discogs or eBay?',
    answer:
      'Discogs and eBay are marketplaces. Record Platform automatically tracks prices across all platforms, calculates precise market positions rather than simple averages, and delivers AI-powered recommendations you will not find elsewhere.',
  },
  {
    question: 'Do I need technical knowledge?',
    answer:
      'Not at all. If you can use eBay or Discogs, you can use Record Platform. Data collection, AI analysis, and automated monitoring all happen behind the scenes.',
  },
  {
    question: 'Can record shops use this?',
    answer:
      'Shops may benefit the most. Get data-driven recommendations for starting bids, fixed prices, and OBO flexibility. Move inventory faster and compete with bigger shops using the same intelligence tools.',
  },
  {
    question: 'What about CDs, cassettes, and other formats?',
    answer:
      'While our focus started with vinyl, the same principles apply to all physical media. Price tracking, market analysis, and intelligent recommendations work across formats.',
  },
]

const integrationSources = [
  {
    name: 'Platform listings',
    description: 'Your catalog and marketplace listings are the primary source for search and comparables.',
  },
  {
    name: 'Discogs',
    description: 'Enrich catalog entries and pricing research with Discogs marketplace data when configured.',
  },
  {
    name: 'eBay',
    description: 'Comparable sales and auction signals from eBay Browse — enrichment, not the default catalog.',
  },
  {
    name: 'AI valuation',
    description: 'Optional AI explanations and price suggestions layered on analytics and market history.',
  },
]

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <LandingHeader />
      <main className="flex flex-1 flex-col">
      {/* ── Hero ── */}
      <section
        id="hero"
        className="relative overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-24 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 sm:py-32"
      >
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-5xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-6xl lg:text-7xl">
            Record Platform
          </h1>
          <p className="mt-4 text-xl font-medium text-brand sm:text-2xl">
            Catalog Intelligence
          </p>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
            Real-time market data, AI-powered insights, and automated auction
            monitoring for record collectors and sellers.
          </p>
          <div className="mt-10">
            <AuthCta />
          </div>
        </div>
      </section>

      {/* ── For Collectors ── */}
      <section id="collectors" className="bg-white px-4 py-20 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 max-w-3xl">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
              For Collectors
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
              Build your collection with confidence. Know when to buy, what to
              pay, and what you are missing, all backed by real market data.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {collectorFeatures.map((f) => (
              <Card key={f.title} className="p-6 transition-shadow hover:shadow-lg">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {f.description}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── For Sellers ── */}
      <section
        id="sellers"
        className="bg-slate-50 px-4 py-20 dark:bg-slate-900"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 max-w-3xl">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
              For Record Shops and Sellers
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
              Price with confidence, move inventory faster, and maximize
              margins using real market data instead of guesswork.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {sellerFeatures.map((f) => (
              <Card key={f.title} className="p-6 transition-shadow hover:shadow-lg">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {f.description}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Catalog Intelligence ── */}
      <section
        id="catalog-intelligence"
        className="bg-white px-4 py-20 dark:bg-slate-950"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 max-w-3xl">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
              Catalog Intelligence
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
              Unified search across your collection, platform listings, and enrichment sources.
              Gap detection, condition tracking, and export paths built for serious collectors and shops.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="p-6">
              <h3 className="font-semibold text-slate-900 dark:text-white">Smart catalog</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Artist, title, format, grades, and catalog numbers in one searchable library.
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="font-semibold text-slate-900 dark:text-white">Market signals</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Trending searches, price snapshots, and analytics-backed suggestions.
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="font-semibold text-slate-900 dark:text-white">Observability</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Runtime metrics and bench results via Grafana, Prometheus, and Jaeger at the edge.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* ── Pricing & Comparable Sales ── */}
      <section id="pricing" className="bg-slate-50 px-4 py-20 dark:bg-slate-900">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 max-w-3xl">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
              Pricing and Comparable Sales
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
              Research comparables from platform listings first, then Discogs and eBay as enrichment.
              Not an eBay-only workflow — multi-source by design.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-6">
              <h3 className="font-semibold text-slate-900 dark:text-white">Research comparables</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Compare asking prices and recent sales before you list or buy.
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="font-semibold text-slate-900 dark:text-white">List with confidence</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Fixed price, auction, and OBO guidance from real market position — not guesswork.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* ── Integrations ── */}
      <section id="integrations" className="bg-white px-4 py-20 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
            Integrations
          </h2>
          <p className="mt-4 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
            Connect external marketplaces and AI services when credentials are configured.
            Missing integrations show a clear disabled state — not a generic error.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {integrationSources.map((src) => (
              <Card key={src.name} className="p-5">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{src.name}</h3>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{src.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section
        id="how-it-works"
        className="bg-slate-50 px-4 py-20 dark:bg-slate-900"
      >
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
            How It Works
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-slate-600 dark:text-slate-400">
            Three steps from raw market data to better decisions.
          </p>
          <div className="mt-16 grid gap-10 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.step} className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-xl font-bold text-brand">
                  {s.step}
                </div>
                <h3 className="mt-5 text-xl font-semibold text-slate-900 dark:text-white">
                  {s.title}
                </h3>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
                  {s.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="bg-white px-4 py-20 dark:bg-slate-950">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
            Frequently Asked Questions
          </h2>
          <dl className="mt-14 space-y-8">
            {faqs.map((faq) => (
              <div key={faq.question}>
                <dt className="text-lg font-semibold text-slate-900 dark:text-white">
                  {faq.question}
                </dt>
                <dd className="mt-2 text-slate-600 dark:text-slate-400">
                  {faq.answer}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section
        id="cta"
        className="bg-gradient-to-br from-brand/10 to-brand/5 px-4 py-20 dark:from-brand/20 dark:to-brand/10"
      >
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
            Ready to Collect (or Sell) Smarter?
          </h2>
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
            Stop guessing. Start making data-driven decisions with automated
            price intelligence and AI-powered insights.
          </p>
          <div className="mt-8">
            <AuthCta
              guestLinks={[
                { label: 'Get Started', href: '/register' },
                { label: 'Learn More', href: '/about', variant: 'outline' },
              ]}
              authenticatedLinks={[
                { label: 'Open Dashboard', href: '/dashboard' },
              ]}
            />
          </div>
          <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
            Free to start. No credit card required.
          </p>
        </div>
      </section>
    </main>
      <LandingFooter />
    </div>
  )
}
