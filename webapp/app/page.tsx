import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import config from '@/lib/config'

const features = [
  { title: 'Streaming exports', description: 'Kick off S3/R2 CSV exports and monitor Kafka delivery health from one place.' },
  { title: 'AI insights', description: 'Feed listings into the inference service to project fair price, demand, and watchlist size.' },
  { title: 'Tenant tuning', description: 'Compare hot-slice vs. cold table latency and validate pgbench targets instantly.' },
]

export default function Home() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 py-16">
      <section className="rounded-3xl border border-slate-200/60 bg-white px-10 py-16 text-center shadow-card dark:border-white/10 dark:bg-slate-900">
        <p className="text-sm uppercase tracking-[0.25em] text-brand">Record Platform</p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight text-slate-900 dark:text-white">
          Operational console for <br /> {config.appName}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-500 dark:text-slate-300">
          Run benchmarks, inspect listings, and review AI insights without leaving the browser. Built for low latency and bfcache-friendly
          workflows.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Button asChild>
            <Link href="/dashboard">Launch dashboard</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {features.map((feature) => (
          <Card key={feature.title} title={feature.title} description={feature.description} />
        ))}
      </section>
    </main>
  )
}
