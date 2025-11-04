#!/usr/bin/env bash
set -euo pipefail

DB_BASE="postgresql://postgres:postgres@localhost:5432/records"

echo "==> auth-service migrations"
(
  cd services/auth-service
  export POSTGRES_URL_AUTH="${DB_BASE}?schema=auth"
  npx prisma migrate deploy
)

echo "==> records-service migrations"
(
  cd services/records-service
  export POSTGRES_URL_RECORDS="${DB_BASE}?schema=records"
  npx prisma migrate deploy
)

echo "==> Done."
