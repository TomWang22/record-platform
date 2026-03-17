-- Create the python_ai database on the PostgreSQL instance for port 5440 (python-ai service).
-- Run: PGPASSWORD=postgres psql -h localhost -p 5440 -U postgres -d postgres -f infra/db/00-create-python-ai-database.sql
-- Then run 09-python-ai-schema.sql (python-ai-schema.sql) against -d python_ai.
-- App-config uses POSTGRES_URL_PYTHON_AI=...:5440/python_ai (see infra/k8s/base/config/app-config.yaml).

SELECT 'CREATE DATABASE python_ai'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'python_ai')\gexec
