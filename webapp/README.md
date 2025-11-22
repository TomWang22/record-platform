# Webapp Testing Guide

This guide explains how to run and test the frontend webapp locally, and how it connects to the backend services.

## Quick Start

### 1. Start Backend Services

The webapp connects to the API Gateway at `http://localhost:8080` by default. You need to have the backend services running first.

**Option A: Using Docker Compose (Recommended)**
```bash
# From the project root
docker-compose up -d api-gateway auth-service records-service redis postgres
```

**Option B: Using Kubernetes (if you have a kind cluster)**
```bash
# Apply the services
kubectl apply -k infra/k8s/overlays/dev

# Port forward the API gateway
kubectl port-forward svc/api-gateway 8080:4000
```

**Option C: Run services individually**
```bash
# Terminal 1: API Gateway
cd services/api-gateway
pnpm dev

# Terminal 2: Auth Service
cd services/auth-service
pnpm dev

# Terminal 3: Records Service
cd services/records-service
pnpm dev
```

### 2. Start the Webapp

```bash
# From the project root
cd webapp
pnpm install
pnpm dev
```

The webapp will start on `http://localhost:3001`

### 3. Configure API Gateway URL (if needed)

By default, the webapp connects to `http://localhost:8080`. If your API gateway runs on a different port, set the environment variable:

```bash
NEXT_PUBLIC_GATEWAY_URL=http://localhost:4000 pnpm dev
```

Or create a `.env.local` file in the `webapp/` directory:
```
NEXT_PUBLIC_GATEWAY_URL=http://localhost:8080
```

## Testing the Frontend

### Available Pages

1. **Landing Page** (`/`)
   - Marketing-style homepage
   - Links to dashboard and login

2. **Login** (`/login`)
   - User authentication
   - Connects to `/auth/login` endpoint

3. **Dashboard** (`/dashboard`)
   - Overview page with stats
   - Requires authentication

4. **Records** (`/records`)
   - List all records
   - Search functionality
   - Create, view, edit, delete records
   - Connects to `/records` endpoints

5. **Record Detail** (`/records/[id]`)
   - View and edit individual records
   - Connects to `/records/:id` endpoint

6. **Create Record** (`/records/new`)
   - Form to create new records
   - Connects to `POST /records`

7. **Insights** (`/insights`)
   - AI price predictions
   - Connects to analytics service

8. **Market** (`/market`)
   - eBay marketplace search
   - Connects to listings service

9. **Messages** (`/messages`)
   - Real-time message stream (SSE)
   - Kafka-ready (placeholder implementation)

10. **Settings** (`/settings`)
    - User settings page

11. **Integrations** (`/integrations`)
    - Discogs OAuth integration

## Backend API Endpoints

The webapp uses the following API endpoints via the API Gateway:

### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login user
- `GET /whoami` - Get current user info

### Records
- `GET /records` - List records (supports `?q=search` query)
- `GET /records/:id` - Get single record
- `POST /records` - Create record
- `PUT /records/:id` - Update record
- `DELETE /records/:id` - Delete record

### Other Services (Proxied)
- Analytics service - Price predictions
- Listings service - eBay search
- Python AI service - AI insights

## How It Works

### API Client

The webapp uses a centralized API client (`lib/api-client.ts`) that:
- Automatically adds authentication headers from session tokens
- Handles errors consistently
- Uses `AbortController` for bfcache-friendly navigation
- Connects to `${NEXT_PUBLIC_GATEWAY_URL}${path}`

### Authentication Flow

1. User logs in via `/login` page
2. Frontend calls `POST /auth/login` with credentials
3. Backend returns JWT token
4. Token is stored in HTTP-only cookie (via middleware)
5. Subsequent requests include `Authorization: Bearer <token>` header

### Session Management

- Session tokens are managed via `lib/session.ts`
- Uses HTTP-only cookies for security
- Automatically included in authenticated requests

## Troubleshooting

### CORS Errors

If you see CORS errors, make sure:
1. The API gateway has CORS enabled
2. The `NEXT_PUBLIC_GATEWAY_URL` matches the actual gateway URL
3. The API gateway is running and accessible

### 401 Unauthorized

If you get 401 errors:
1. Make sure you're logged in
2. Check that the JWT token is being sent in the `Authorization` header
3. Verify the auth service is running

### Connection Refused

If you see connection errors:
1. Verify the API gateway is running: `curl http://localhost:8080/healthz`
2. Check the `NEXT_PUBLIC_GATEWAY_URL` environment variable
3. Make sure all backend services are running

### Build Errors

If you get build errors:
```bash
cd webapp
rm -rf .next node_modules
pnpm install
pnpm dev
```

## Development Tips

- The webapp uses Next.js 14 App Router with route groups
- Styling uses Tailwind CSS with shadcn/ui components
- Dark mode is supported via `next-themes`
- The app is bfcache-friendly for smooth navigation
- All API calls go through the centralized `apiFetch` helper

## Production Build

```bash
cd webapp
pnpm build
pnpm start
```

The production build will be in `.next/standalone` (configured for Docker).

