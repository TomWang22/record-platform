-- Optional: set statement_timeout on records DB to avoid analytics-service "connection timeout"
-- when pool is under load (e.g. rotation/chaos). Default or "fast verify" may use 2s.
-- Run once per records instance: psql -h localhost -p 5433 -U postgres -d records -f records-statement-timeout.sql
-- Or: PGPORT=5433 PGDATABASE=records psql -h localhost -U postgres -f infra/db/records-statement-timeout.sql
ALTER DATABASE records SET statement_timeout = '5s';
