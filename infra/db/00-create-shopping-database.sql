-- Create the shopping database on the PostgreSQL instance for port 5436 (shopping service).
-- Run while connected to the default database (e.g. postgres) on port 5436:
--   PGPASSWORD=postgres psql -h localhost -p 5436 -U postgres -d postgres -f infra/db/00-create-shopping-database.sql
-- Then run 06-shopping-schema.sql, 07-shopping-orders-migration.sql, 08-shopping-notes-migration.sql,
-- and 09-shopping-order-number-sequence.sql (or scripts/ensure-shopping-order-number-sequence.sh) against -d shopping.

SELECT 'CREATE DATABASE shopping'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'shopping')\gexec
