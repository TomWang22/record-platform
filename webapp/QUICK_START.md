# Quick Start Guide - Testing the Webapp

## Prerequisites

1. **Backend services must be running** (API Gateway, Auth Service, Records Service, PostgreSQL, Redis)

## Step 1: Start Backend Services

Choose one method:

### Option A: Docker Compose
```bash
# From project root
docker-compose up -d api-gateway auth-service records-service redis postgres
```

### Option B: Kubernetes (if you have a kind cluster)
```bash
kubectl apply -k infra/k8s/overlays/dev
kubectl port-forward svc/api-gateway 8080:4000
```

### Option C: Manual (for development)
```bash
# Terminal 1: API Gateway (port 4000)
cd services/api-gateway && pnpm dev

# Terminal 2: Auth Service (port 4001)
cd services/auth-service && pnpm dev

# Terminal 3: Records Service (port 4002)
cd services/records-service && pnpm dev
```

## Step 2: Verify Backend is Running

```bash
# Test the API gateway health endpoint
curl http://localhost:8080/healthz

# Should return: {"ok":true}
```

Or use the test script:
```bash
cd webapp
./test-backend.sh
```

## Step 3: Start the Webapp

```bash
cd webapp
pnpm install  # First time only
pnpm dev
```

The webapp will start on **http://localhost:3001**

## Step 4: Test the Frontend

1. **Open your browser**: http://localhost:3001
2. **Landing Page**: You should see the marketing homepage
3. **Login**: Click "Sign in" or go to http://localhost:3001/login
4. **Register**: Click "Register" button on login page (creates a new user)
5. **Dashboard**: After login, you'll be redirected to `/records`
6. **Records Page**: 
   - View all records
   - Search records
   - Create new records
   - Edit/delete records

## Configuration

The webapp connects to the API Gateway at `http://localhost:8080` by default.

To change this, create a `.env.local` file in the `webapp/` directory:
```
NEXT_PUBLIC_GATEWAY_URL=http://localhost:4000
```

## Troubleshooting

### "Connection refused" errors
- Make sure the API gateway is running
- Check the port: `curl http://localhost:8080/healthz`
- Verify `NEXT_PUBLIC_GATEWAY_URL` matches your gateway URL

### 401 Unauthorized errors
- Make sure you're logged in
- Check browser console for auth errors
- Verify auth-service is running

### CORS errors
- The API gateway should have CORS enabled
- Check that the gateway URL is correct

## What's Connected

The webapp is fully connected to:
- ✅ **Auth Service** - Login, registration, JWT tokens
- ✅ **Records Service** - CRUD operations via gRPC
- ✅ **API Gateway** - All requests go through the gateway
- ⚠️ **Analytics Service** - Price predictions (needs service running)
- ⚠️ **Listings Service** - eBay search (needs service running)
- ⚠️ **Python AI Service** - AI insights (needs service running)

## Pages Overview

- `/` - Landing page
- `/login` - Authentication
- `/dashboard` - Dashboard overview
- `/records` - List/search records
- `/records/new` - Create record
- `/records/[id]` - View/edit record
- `/insights` - AI insights
- `/market` - Marketplace search
- `/messages` - Real-time messages (SSE)
- `/settings` - User settings
- `/integrations` - OAuth integrations

