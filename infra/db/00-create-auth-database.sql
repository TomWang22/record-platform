-- Create the auth database on the PostgreSQL instance for port 5437 (auth service).
-- Run while connected to the default database (e.g. postgres) on port 5437:
--   PGPASSWORD=postgres psql -h localhost -p 5437 -U postgres -d postgres -f infra/db/00-create-auth-database.sql
-- Then run 07-auth-schema.sql, 07-auth-schema-extended.sql, 07-auth-passkeys.sql against -d auth.

SELECT 'CREATE DATABASE auth'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'auth')\gexec
