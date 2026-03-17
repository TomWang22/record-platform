-- Create the analytics database on the PostgreSQL instance for port 5439 (analytics service).
-- Run: PGPASSWORD=postgres psql -h localhost -p 5439 -U postgres -d postgres -f infra/db/00-create-analytics-database.sql
-- Then run 08-analytics-schema.sql against -d analytics.
-- App-config uses POSTGRES_URL_ANALYTICS=...:5439/analytics (see infra/k8s/base/config/app-config.yaml).

SELECT 'CREATE DATABASE analytics'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'analytics')\gexec
