Record Platform

A containerized microservices stack for managing a personal record collection with auth, gateway, observability, and a web app.

Gateway (Node/Express) with JWT verification, rate limiting, identity fan-out

Records Service (Node/Express + Prisma + Postgres)

Auth, Listings, Analytics, AI services

Nginx entrypoint, Prometheus + Grafana metrics, Redis for token revocation

Kafka + Zookeeper (future/eventing)

Fully dockerized dev environment

✅ Recent fixes:

# Login
JWT=$(
  curl -sS -H 'content-type: application/json' \
    -d '{"email":"t@t.t","password":"p@ssw0rd"}' \
    http://localhost:8080/api/auth/login | jq -r .token
)

# Create
curl -sS -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  -d '{"artist":"Aphex Twin","name":"SAW 85-92","format":"LP"}' \
  http://localhost:8080/api/records | jq .

Gateway now verifies JWTs and injects x-user-* headers to downstream services.

Records proxy uses the mount path (no extra rewrite), so /api/records hits /records upstream.

Prisma model aligned to UUID for id and userId; POST create mapping hardened.

Slim runtime images (no pnpm in containers); migrations run via build step or on host.

Contents

Architecture

Services & Ports

Data Model

API

Auth & Identity Flow

Local Quickstart

Smoke Test

Build & Rebuild Tips

Migrations

Nginx

Observability

Security Hardening

Troubleshooting

Roadmap

Contributing

Architecture
Browser
  │
  ▼
NGINX (8080)  ──►  API Gateway (Node 4000)
                   • JWT verify (verifyJwt)
                   • Rate-limit (300/min)
                   • Inject x-user-id/email/jti
                   • /metrics, /healthz
                   • Redis (revocation)
                   │
                   ├─► Auth Service (4001)
                   ├─► Records Service (4002) ──► Postgres (5432) via Prisma
                   ├─► Listings (4003)
                   ├─► Analytics (4004)
                   └─► Python AI (5005)

Prometheus (9091→9090) ⇦ scrapes /metrics
Grafana (3000) dashboards
Kafka (29092) + Zookeeper (2181) for events
Redis (6379) for token revocation


Key paths

Nginx serves the UI at / and proxies /api/* to the gateway (stripping /api).

Gateway proxies:

/auth/* → auth-service:4001 (strips /auth)

/records/* → records-service:4002 (no prefix rewrite; uses mount path)

/listings/*, /analytics/*, /ai/* with identity headers when available

Services & Ports
Service	Port (inside)	Notes
Nginx	8080 (host)	Entry point: / (web), /api/* → gateway
API Gateway	4000	Auth guard, identity headers, metrics
Auth Service	4001	Login/register, /auth/*
Records Service	4002	/records CRUD, /records/_ping
Listings Service	4003	Public GETs allowed
Analytics Service	4004	Protected
Python AI	5005	/ai/* via gateway (GETs public)
Postgres	5432 (host)	Dev DB
Redis	6379 (host)	Revoked JWT store
Prometheus	9091 (host)	Scrapes gateway & services /metrics
Grafana	3000 (host)	Dashboards
Kafka/Zookeeper	29092/2181	Event infra
Data Model

services/records-service/prisma/schema.prisma

datasource db {
  provider = "postgresql"
  url      = env("POSTGRES_URL_RECORDS")
}

generator client {
  provider      = "prisma-client-js"
  output        = "../generated/records-client"
  binaryTargets = ["native", "linux-arm64-openssl-3.0.x"]
}

model Record {
  id               String    @id @db.Uuid @default(uuid())
  userId           String    @db.Uuid @map("user_id")

  artist           String    @db.VarChar(256)
  name             String    @db.VarChar(256)
  format           String    @db.VarChar(64)

  catalogNumber    String?   @db.VarChar(64) @map("catalog_number")
  recordGrade      String?   @db.VarChar(16) @map("record_grade")
  sleeveGrade      String?   @db.VarChar(16) @map("sleeve_grade")
  hasInsert        Boolean   @default(false) @map("has_insert")
  hasBooklet       Boolean   @default(false) @map("has_booklet")
  hasObiStrip      Boolean   @default(false) @map("has_obi_strip")
  hasFactorySleeve Boolean   @default(false) @map("has_factory_sleeve")
  isPromo          Boolean   @default(false) @map("is_promo")

  notes            String?   @db.Text
  purchasedAt      DateTime? @map("purchased_at")
  pricePaid        Decimal?  @db.Decimal(10, 2) @map("price_paid")

  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt      @map("updated_at")

  @@map("records")
  @@index([userId])
  @@index([artist])
  @@index([catalogNumber])
  @@index([artist, name, format])
}


Gotcha we fixed: aligning Prisma types to UUIDs (and using uuid() default) prevents runtime errors like “Inconsistent column data: Error creating UUID…”

API
Auth (via gateway /api/auth/*)

POST /api/auth/register {email, password}

POST /api/auth/login → { token }

GET /api/auth/me (Bearer) → token payload

POST /api/auth/logout (Bearer) → 204 and revokes token JTI in Redis

Records (via gateway /api/records/*) — requires Bearer

GET /api/records → latest 100 for user

POST /api/records body:

{
  "artist": "Aphex Twin",
  "name": "Selected Ambient Works",
  "format": "LP",
  "pricePaid": "24.50",
  "purchasedAt": "2022-10-01",
  "notes": "used, VG+"
}


→ 201 Created with the new record

PUT /api/records/:id → update if owned

DELETE /api/records/:id → 204 if owned

GET /api/records/_ping → { ok: true }

The gateway verifies the JWT and injects x-user-id, x-user-email, x-user-jti for the records service. The service does not parse JWTs itself.

Auth & Identity Flow

Client hits /api/auth/login → gets JWT.

All protected routes go through the gateway:

Gateway deletes any client x-user-* headers (anti-spoof),

Verifies JWT, checks Redis revocation (revoked:<jti>),

Sets x-user-id/email/jti on the proxied request to the service.

Service scopes all queries to the user-id header.

Helpers in gateway:

extractBearer(req) for reliable Authorization parsing

Debug routes:

/api/__echo_authz (shows raw Authorization header)

/api/__whoami (after guard; shows decoded payload)

Local Quickstart
# 1) build & start everything
docker compose up -d

# 2) check health
curl -sSf http://localhost:8080/api/healthz

# 3) register (once; ignore “email exists”)
curl -sS -X POST http://localhost:8080/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"t@t.t","password":"p@ssw0rd"}'

# 4) login → JWT
JWT=$(curl -sS -X POST http://localhost:8080/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"t@t.t","password":"p@ssw0rd"}' | jq -r .token)

# 5) sanity check identity
curl -sS http://localhost:8080/api/__whoami -H "Authorization: Bearer $JWT"

Smoke Test
# ping records
curl -sS http://localhost:8080/api/records/_ping -H "Authorization: Bearer $JWT"

# list (expect [])
curl -sS http://localhost:8080/api/records -H "Authorization: Bearer $JWT" | jq .

# create
curl -sS -X POST http://localhost:8080/api/records \
  -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  -d '{"artist":"Aphex Twin","name":"Selected Ambient Works","format":"LP"}' | jq .

# list again (expect the new record)
curl -sS http://localhost:8080/api/records -H "Authorization: Bearer $JWT" | jq .

Build & Rebuild Tips

Rebuild one service:

docker compose up -d --no-deps --build records-service
docker compose up -d --no-deps --build api-gateway


Full rebuild (be careful with -v: it deletes DB):

docker compose down -v
docker compose build --no-cache
docker compose up -d


Why pnpm is “not found” inside containers?
Runtime images are slim by design; we run pnpm only in the build stage. The Prisma client is generated during the build.

Migrations

You’ve got three good options:

A) Run from host
export POSTGRES_URL_RECORDS='postgresql://record_app:CHANGE_ME_STRONG_PASSWORD@localhost:5432/records?schema=records'
pnpm -C services/records-service prisma migrate deploy

B) One-off inside container (no pnpm needed)
docker compose exec -T records-service sh -lc \
  'export POSTGRES_URL_RECORDS="$POSTGRES_URL_RECORDS" && npx --yes prisma@latest migrate deploy'

C) Dedicated migrator service (recommended for CI/CD)
# docker-compose.yml
records-migrator:
  build:
    context: .
    dockerfile: ./services/records-service/Dockerfile
    target: build
  command: sh -lc "pnpm -C services/records-service exec prisma migrate deploy"
  environment:
    POSTGRES_URL_RECORDS: ${POSTGRES_URL_RECORDS}
  depends_on:
    postgres:
      condition: service_healthy


Run as needed:

docker compose run --rm records-migrator

Nginx

Key bits (already configured):

upstream gateway  { server api-gateway:4000; }
server {
  listen 8080;

  location = /api/healthz { proxy_pass http://gateway/healthz; proxy_cache off; }

  # /api/* -> gateway /* (strip /api)
  location /api/ {
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://gateway/;

    proxy_cache STATIC;
    proxy_cache_methods GET HEAD;
    proxy_no_cache     $http_authorization;
    proxy_cache_bypass $http_authorization;
    proxy_cache_valid  200 1m;

    add_header X-Cache-Status $upstream_cache_status always;
  }

  # everything else → webapp
  location / { proxy_pass http://webapp_up; }
}


The trailing / in proxy_pass http://gateway/; under location /api/ removes the /api prefix (this was a previous source of “Cannot GET /”).

Observability

Every service exposes /metrics (Prometheus text format).

Gateway increments a labeled counter per route/method/status:

httpCounter{service="gateway", route, method, code}

Prometheus is exposed at http://localhost:9091 (proxied to container 9090).

Grafana at http://localhost:3000 (admin/admin by default – change it).

Security Hardening

helmet with CSP (restrictive defaults)

Rate limiting 300 req / 60s (skips /healthz, /metrics)

compression, cors (explicit allowlist for localhost:8080 and 3001)

app.set('trust proxy', 1) (we sit behind Nginx)

Gateway never trusts client x-user-* headers; it sets them after JWT verify

Troubleshooting

401 “auth required” on /api/records

Check gateway logs to confirm the guard sees your token:

docker compose logs -f api-gateway


You should see [gw] guard token? true len= ... path=/records

“Cannot GET /” (HTML error page)

Typically a proxy path issue. Make sure records proxy uses:

app.use("/records", createProxyMiddleware({
  target: "http://records-service:4002",
  changeOrigin: true,
  // NO extra pathRewrite here; mount path passes through
}));


Prisma “Inconsistent column data: Error creating UUID …”

Mismatch between Prisma model and DB column type/default.

We set @db.Uuid and @default(uuid()) and rebuilt the service.

pnpm: not found inside container

Expected. Use the host to run Prisma CLI, or the migrator service.

Check service health

curl -sSf http://localhost:8080/api/healthz
curl -sSf http://localhost:8080/api/records/_ping -H "Authorization: Bearer $JWT"
docker compose logs -f records-service

Roadmap

v0.2 – AI insights layer + prompt logging

Lightweight analysis over a user’s collection, persisted prompt/response logs

v0.3 – Dashboard refinement

Web UI polish, bulk import/export, real-world collection flows

v0.4 – Multi-agent orchestration

Fetch/analyze/report pipelines, Kafka events, scheduled jobs

Contributing

Node 20+, pnpm@9

PRs should:

Include service-level smoke instructions

Keep runtime images slim (no build tools)

Surface metrics for new endpoints

Commit convention example:

fix(records-service): align Prisma UUID columns and harden create mapping

- Mark id and userId as @db.Uuid; switch id default to uuid()
- Map POST fields explicitly to avoid leaking unexpected keys
- Normalize purchasedAt and pricePaid inputs


License: MIT (or your choice)
