import { Card } from '@/components/ui/card'

const stats = [
  { label: 'Hot slice records', value: '110k', delta: '+0.4%' },
  { label: 'Latest pgbench TPS', value: '891', delta: 'target: 28k' },
  { label: 'KNN latency', value: '2.8 s', delta: 'needs hot routing' },
]

export default function DashboardHome() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Overview</p>
        <h1 className="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">Operational readiness</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          Keep an eye on throughput, AI workloads, and Kafka readiness. Use the navigation to drill into each surface.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-950">
            <p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
            <p className="mt-3 text-3xl font-semibold text-slate-900 dark:text-white">{stat.value}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">{stat.delta}</p>
          </Card>
        ))}
      </section>
    </div>
  )
}












