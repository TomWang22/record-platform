# Off-Campus-Housing-Tracker

A Kubernetes-first microservices platform for off-campus housing: listings, bookings, messaging, notifications, trust (reviews/ratings), and analytics. Built on a shared substrate (Caddy, Envoy, MetalLB, strict TLS, Kafka mTLS) with one service per domain and event-driven cross-domain communication.

---

## Project overview

- **Event-driven:** Cross-domain interaction only via Kafka; no service reads another service’s database.
- **Domain-isolated:** Each service has its own Postgres (or is stateless and consumes Kafka only).
- **Strict TLS / mTLS:** Edge (Caddy), gRPC (Envoy), and Kafka use TLS with a single dev-root CA; Kafka requires client certs (mTLS).
- **Cluster-native:** Colima k3s (or k3d), MetalLB for LoadBalancer, Caddy for HTTP/2 + HTTP/3 + REST, Envoy for gRPC.

This repo is produced from a **substrate bundle** (see **docs/SUBSTRATE_OPERATIONS_REPORT.md** and **docs/SUBSTRATE_BUNDLE_OPERATIONS.md**). Root layout: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `docker-compose.yml`, `services/`, `webapp/`, `proto/`, `infra/k8s/`, `scripts/`, `docs/`.

---

## User cases (high level)

| User | Needs |
|------|--------|
| **Tenant** | Search listings, request/book, message landlord, get reminders and notifications, leave reviews. |
| **Landlord** | Publish listings, manage availability, approve/decline bookings, message tenants, see reviews and trust signals. |
| **Platform** | Aggregate events for analytics, send notifications (rent reminders, price drops, review alerts), enforce trust and moderation. |

---

## Architecture and service breakdown

**7 domain services** (plus shared **api-gateway** and **common**):

| # | Service | DB | Responsibility |
|---|---------|-----|----------------|
| 1 | **auth-service** | auth | Users, roles (tenant, landlord, admin), JWT, MFA/passkeys, account state. No other service touches this DB. |
| 2 | **listings-service** | listings | Listings, geo, pricing, availability, search/filtering, image refs. No booking logic. |
| 3 | **booking-service** | bookings | Reservation lifecycle, cancellation, landlord approval. Emits: `booking_created`, `booking_confirmed`, `booking_cancelled`. |
| 4 | **messaging-service** | messaging | Conversations, messages, read receipts, attachments. No booking/listing logic. |
| 5 | **notification-service** | — | Kafka consumer only. Email/push, rent reminders, price drops, review alerts. Stateless. |
| 6 | **trust-service** | trust | Reviews, ratings, abuse reports, moderation, listing flags. Emits: `listing_flagged`, `user_suspended`. |
| 7 | **analytics-service** | — | Kafka consumer only. Event aggregation, usage/revenue metrics, insights. Never in request path. |

**Shared:**

- **common** — Kafka (mTLS), Redis, logger, metrics, gRPC helpers. No business logic.
- **api-gateway** — Auth (JWT), rate limiting, REST → gRPC proxy. No business logic.

**Communication rules:**

- No cross-service database access.
- Cross-domain only via Kafka (versioned event contracts).
- Gateway may call services via REST or gRPC; services may call auth for token validation only.

---

## Databases

- **auth**, **listings**, **bookings**, **messaging**, **trust**: one Postgres DB per service (own schema/migrations).
- **notification** and **analytics**: stateless; no DB.
- Restore auth from `backups/5437-auth.dump` if using the ported auth-service (see `backups/README.txt`).

---

## Docs in this bundle

| Doc | Purpose |
|-----|---------|
| **docs/ARCHITECTURE.md** | Full architecture and service boundaries (event-driven, 7 services, DB policy). |
| **docs/REPO_SETUP_SPEC.md** | In-depth spec: root layout, responsibilities, CI, Docker, security, phase 1 order, Cursor block. |
| **docs/CURSOR_SCAFFOLD_INSTRUCTIONS.md** | Paste into Cursor to scaffold workspace, Dockerfiles, /health, /metrics, Prisma per service. |
| **docs/SUBSTRATE_OPERATIONS_REPORT.md** | How to run the substrate (TLS, Caddy, Envoy, MetalLB, Kafka, preflight). |
| **docs/SUBSTRATE_BUNDLE_OPERATIONS.md** | What’s in the tarball, what to add, how to operate. |
| **ENGINEERING.md** | Cluster-focused engineering notes (TLS, Caddy, Envoy, deployment). |
| **Runbook.md** | Cluster stabilization and runbook (issues and fixes). |
| **docs/PORTS_REFERENCE.md** | Non-DB ports (ingress, services, Kafka, Redis, NodePort). Use it to avoid port conflicts when running alongside record-platform on the same host. |

Replace `record.local` and `record-platform` with your hostname and namespace. Use a **different MetalLB pool** per project (e.g. `METALLB_POOL=192.168.64.251-192.168.64.260`).
