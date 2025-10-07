DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_owner') THEN CREATE ROLE record_owner NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN CREATE ROLE record_readwrite NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN CREATE ROLE record_readonly NOINHERIT; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_app') THEN
    CREATE ROLE record_app LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS records;
CREATE SCHEMA IF NOT EXISTS listings;
CREATE SCHEMA IF NOT EXISTS analytics;

ALTER SCHEMA auth OWNER TO record_owner;
ALTER SCHEMA records OWNER TO record_owner;
ALTER SCHEMA listings OWNER TO record_owner;
ALTER SCHEMA analytics OWNER TO record_owner;

GRANT USAGE ON SCHEMA auth, records, listings, analytics TO record_readwrite, record_readonly;
GRANT CREATE ON SCHEMA auth, records, listings, analytics TO record_owner;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth, records, listings, analytics TO record_readwrite;
GRANT SELECT ON ALL TABLES IN SCHEMA auth, records, listings, analytics TO record_readonly;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA auth, records, listings, analytics TO record_readwrite;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth, records, listings, analytics TO record_readonly;

ALTER DEFAULT PRIVILEGES FOR ROLE record_owner IN SCHEMA auth, records, listings, analytics
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO record_readwrite;
ALTER DEFAULT PRIVILEGES FOR ROLE record_owner IN SCHEMA auth, records, listings, analytics
  GRANT SELECT ON TABLES TO record_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE record_owner IN SCHEMA auth, records, listings, analytics
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO record_readwrite;
ALTER DEFAULT PRIVILEGES FOR ROLE record_owner IN SCHEMA auth, records, listings, analytics
  GRANT USAGE, SELECT ON SEQUENCES TO record_readonly;

GRANT record_readwrite TO record_app;
