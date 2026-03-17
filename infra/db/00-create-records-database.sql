-- Create the records database on the PostgreSQL instance for port 5433 (records service).
-- Run: PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -f infra/db/00-create-records-database.sql
-- Then run 03-database.sql, 46-records-prisma-columns.sql, etc. against -d records.

SELECT 'CREATE DATABASE records'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'records')\gexec
