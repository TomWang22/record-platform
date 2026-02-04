# Database Connection Fix - Root Cause & Solution

## Root Cause ✅ IDENTIFIED

**auth-service** connects to: `host.docker.internal:5437` (external Docker)
**records-service** connects to: K8s postgres service (10.96.91.243:5432)

**Result**: Users created in external Docker don't exist in K8s postgres → Foreign key constraint violation

## Solution Options

### Option A: Use K8s Postgres (Recommended - Production-Like)
**Change**: auth-service DATABASE_URL to K8s postgres service
**Benefits**:
- Single source of truth
- Matches production setup
- No data sync needed

**Steps**:
1. Update auth-service deployment to use K8s postgres service URL
2. Restart auth-service
3. Verify users created in K8s postgres
4. Test Records Create

### Option B: Use External Docker (Dev/Test)
**Change**: records-service DATABASE_URL to external Docker
**Issues**:
- Requires data sync between databases
- More complex configuration
- Not production-like

## Recommended Action

**Use Option A** - Align both services to K8s postgres:
1. Update auth-service to use K8s postgres service
2. Verify both services use same database
3. Test user creation and Records Create
4. Continue with HTTP/3 and k6 tests

## Current Status

- ✅ Root cause identified
- ✅ Fix plan documented
- ⏳ Waiting for decision on Option A vs B
- ⏳ Implementation pending
