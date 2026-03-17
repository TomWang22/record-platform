-- Idempotent: add columns to records.records so Prisma (records-service) can create records.
-- Run on port 5433, database "records". Safe when columns already exist (ADD COLUMN IF NOT EXISTS).
-- Prisma expects: insert_grade, booklet_grade, obi_strip_grade, factory_sleeve_grade, release_year, release_date, pressing_year, label, label_code.
-- infra/db/03-database.sql does not create these; this migration aligns DB with services/records-service/prisma/schema.prisma.

\echo '=== records.records: add Prisma columns if missing (46-records-prisma-columns) ==='

ALTER TABLE records.records ADD COLUMN IF NOT EXISTS insert_grade         VARCHAR(16);
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS booklet_grade        VARCHAR(16);
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS obi_strip_grade      VARCHAR(16);
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS factory_sleeve_grade VARCHAR(16);
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS release_year         INTEGER;
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS release_date         TIMESTAMPTZ;
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS pressing_year        INTEGER;
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS label                VARCHAR(128);
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS label_code           VARCHAR(64);

-- Ensure composite primary key if table was created with single-column PK (Prisma uses id + user_id).
-- Do not drop/recreate PK here; only add columns. If your table has (id) PK, Prisma migration or manual ALTER is required.

\echo 'Done. records.records now has insert_grade and other Prisma columns.'
