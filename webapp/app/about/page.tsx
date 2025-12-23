'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function AboutPage() {
  return (
    <main className="flex min-h-screen flex-col">
      {/* Header */}
      <section className="bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-16 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-5xl">
            About Record Platform
          </h1>
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">
            A production-ready, full-stack microservices platform demonstrating modern cloud-native architecture and
            distributed systems design.
          </p>
        </div>
      </section>

      {/* Architecture Overview */}
      <section className="bg-white px-4 py-20 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">System Architecture</h2>
          <div className="space-y-6">
            <Card className="p-6">
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">
                🏗️ Microservices Architecture
              </h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Record Platform is built on a modern microservices architecture with 8+ dedicated services, each
                handling a specific domain. This ensures scalability, maintainability, and independent deployment.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 mt-6">
                <div>
                  <strong className="text-slate-900 dark:text-white">Service Isolation</strong>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Each service has its own database, preventing cross-service data conflicts
                  </p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">Independent Scaling</strong>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Services can be scaled independently based on load
                  </p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">gRPC Communication</strong>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Type-safe, efficient inter-service communication with protocol buffers
                  </p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">Event-Driven</strong>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Kafka integration for real-time messaging and event processing
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">🗄️ Database Architecture</h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                <strong>8 dedicated PostgreSQL instances</strong> for complete service isolation and independent
                scaling:
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-4 text-sm">
                <div>
                  <strong className="text-slate-900 dark:text-white">Main DB (5433)</strong>
                  <p className="text-slate-600 dark:text-slate-400">Records schema</p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">Auth DB (5437)</strong>
                  <p className="text-slate-600 dark:text-slate-400">Authentication</p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">Social DB (5434)</strong>
                  <p className="text-slate-600 dark:text-slate-400">Forum & messaging</p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">Listings DB (5435)</strong>
                  <p className="text-slate-600 dark:text-slate-400">Marketplace data</p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">Shopping DB (5436)</strong>
                  <p className="text-slate-600 dark:text-slate-400">Carts & orders</p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">Auction Monitor (5438)</strong>
                  <p className="text-slate-600 dark:text-slate-400">Price tracking</p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">Analytics DB (5439)</strong>
                  <p className="text-slate-600 dark:text-slate-400">Price snapshots</p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">Python AI (5440)</strong>
                  <p className="text-slate-600 dark:text-slate-400">AI model persistence</p>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">🌐 Edge & Routing</h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Modern edge infrastructure with multi-protocol support:
              </p>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 space-y-2">
                <li>
                  <strong>Caddy</strong>: HTTP/2, HTTP/3 (QUIC), and gRPC routing with TLS termination (TLS 1.2/1.3
                  only)
                </li>
                <li>
                  <strong>ingress-nginx</strong>: Kubernetes ingress controller for service routing
                </li>
                <li>
                  <strong>API Gateway</strong>: JWT verification, rate limiting, identity injection, HTTP → gRPC proxy
                </li>
                <li>
                  <strong>HAProxy</strong>: Keep-alive pools and load balancing
                </li>
              </ul>
            </Card>

            <Card className="p-6">
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">📊 Observability Stack</h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Comprehensive monitoring, tracing, and visualization:
              </p>
              <div className="grid gap-4 sm:grid-cols-2 mt-4">
                <div>
                  <strong className="text-slate-900 dark:text-white">Prometheus</strong>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Metrics collection with 30-day retention, auto-discovery via ServiceMonitors
                  </p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">Grafana</strong>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Dashboards and visualization for microservices and Kubernetes
                  </p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">Jaeger</strong>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Distributed tracing via OpenTelemetry Collector
                  </p>
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white">OpenTelemetry</strong>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Unified observability data pipeline (traces, metrics, logs)
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Technical Highlights */}
      <section className="bg-slate-50 px-4 py-20 dark:bg-slate-900">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">Technical Highlights</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="p-6">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">
                ✅ Zero-Downtime Operations
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                100% uptime during certificate rotation (1-2 second rotation time, 0 failed requests). Validated with
                k6 distributed load testing at ~397 req/s.
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">
                ✅ Multi-Protocol Edge
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                HTTP/2, HTTP/3 (QUIC), and gRPC support with automatic protocol negotiation. Strict TLS enforcement
                (TLS 1.2/1.3 only).
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">
                ✅ Production-Ready Performance
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                99%+ success rates across all services with 45-77% latency reduction. p95 latencies improved from 2-5s
                to 0.5-2s.
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">
                ✅ Kubernetes-Native
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                Complete infrastructure as code (Terraform + Ansible), observability stack, and disaster recovery
                automation. One-command bootstrap.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-brand/10 to-brand/5 px-4 py-16 dark:from-brand/20 dark:to-brand/10">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
            Ready to Get Started?
          </h2>
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
            Experience the power of automated collection management with AI-powered insights.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Button asChild size="lg">
              <Link href="/register">Create Free Account</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/">Back to Home</Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  )
}

