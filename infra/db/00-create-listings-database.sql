-- Create the listings database on the PostgreSQL instance for port 5435 (listings service).
-- Run while connected to the default database (e.g. postgres) on port 5435:
--   PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d postgres -f infra/db/00-create-listings-database.sql
-- Then run 05-listings-schema.sql (and optional 05-listings-schema-extended.sql, etc.) against -d listings.
-- App-config uses POSTGRES_URL_LISTINGS=...:5435/listings (see infra/k8s/base/config/app-config.yaml).

SELECT 'CREATE DATABASE listings'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'listings')\gexec
