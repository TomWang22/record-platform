#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_FILE="$REPO_ROOT/services/records-service/prisma/schema.prisma"
EDGE_BASE="${RP_PUBLIC_ORIGIN:-https://record-platform.test}"
NS="record-platform"
FAIL=0

pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; FAIL=1; }

echo "=== RP records DB contract audit ==="

if kubectl exec -n "$NS" deployment/records-service -c app -- sh -c 'echo "$DATABASE_URL"' | grep -q ':5433/records'; then
  pass "records-service DATABASE_URL points to records DB (5433)"
else
  fail "records-service DATABASE_URL is not records DB (5433)"
fi

TABLE_JSON="$(kubectl exec -n "$NS" deployment/records-service -c app -- node -e "const {PrismaClient}=require('/app/services/records-service/generated/records-client'); const p=new PrismaClient({datasources:{db:{url:process.env.POSTGRES_URL_RECORDS}}}); p.\$queryRawUnsafe(\"select table_schema, table_name from information_schema.tables where table_schema in ('records','public','auth') order by table_schema, table_name\").then(r=>{console.log(JSON.stringify(r));process.exit(0)}).catch(e=>{console.error(e);process.exit(1)});" 2>/dev/null || true)"

if echo "$TABLE_JSON" | grep -q '"table_schema":"records"'; then
  pass "records schema exists"
else
  fail "records schema missing"
fi

if echo "$TABLE_JSON" | grep -q '"table_name":"records"'; then
  pass "records.records table exists"
else
  fail "records.records table missing"
fi

if grep -q '@@schema("records")' "$SCHEMA_FILE" && grep -q '@@map("records")' "$SCHEMA_FILE"; then
  pass "Prisma Record model maps to records.records"
else
  fail "Prisma model mapping for records table mismatch"
fi

API_CODE="$(curl -sk -o /tmp/rp-audit-records-body.txt -w '%{http_code}' "$EDGE_BASE/api/records" || true)"
if [[ "$API_CODE" == "200" || "$API_CODE" == "401" ]]; then
  pass "GET /api/records is auth-safe (HTTP $API_CODE)"
else
  fail "GET /api/records returned unexpected HTTP $API_CODE"
fi

if grep -qiE '"table_name":"(.*och.*|.*housing.*|.*booking.*|.*social.*)"' <<<"$TABLE_JSON"; then
  fail "OCH/housing-style table names found in records DB"
else
  pass "No OCH/housing/booking/social table names in active records DB tables"
fi

echo ""
if [[ "$FAIL" -ne 0 ]]; then
  echo "records DB contract: FAILED"
  exit 1
fi
echo "records DB contract: PASSED"
