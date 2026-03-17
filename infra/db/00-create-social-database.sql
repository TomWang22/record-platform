-- Create the social database on the PostgreSQL instance for port 5434 (social service).
-- Run: PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d postgres -f infra/db/00-create-social-database.sql
-- Then run 04-social-schema.sql and related migrations against -d social.
-- App-config uses POSTGRES_URL_SOCIAL=...:5434/social (see infra/k8s/base/config/app-config.yaml).

SELECT 'CREATE DATABASE social'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'social')\gexec
