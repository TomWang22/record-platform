-- Catalog schema: data_lake (logical DB/domain), data_model (schema/entity model), data_object (table/view).
-- Apply to all 8 DBs; then run scripts/ensure-catalog-all-dbs.sh to populate per DB.
SET ROLE postgres;

CREATE SCHEMA IF NOT EXISTS catalog;

CREATE TABLE IF NOT EXISTS catalog.data_lake (
  id   serial PRIMARY KEY,
  name text UNIQUE NOT NULL,
  description text
);
COMMENT ON TABLE catalog.data_lake IS 'Logical data lake / DB domain (one per database).';

CREATE TABLE IF NOT EXISTS catalog.data_model (
  id           serial PRIMARY KEY,
  data_lake_id int NOT NULL REFERENCES catalog.data_lake(id) ON DELETE CASCADE,
  name         text,
  schema_name  text NOT NULL,
  description  text,
  UNIQUE (data_lake_id, schema_name)
);
CREATE INDEX IF NOT EXISTS idx_data_model_lake ON catalog.data_model(data_lake_id);
COMMENT ON TABLE catalog.data_model IS 'Data model / schema (one per application schema).';

CREATE TABLE IF NOT EXISTS catalog.data_object (
  id             serial PRIMARY KEY,
  data_model_id  int NOT NULL REFERENCES catalog.data_model(id) ON DELETE CASCADE,
  schema_name    text NOT NULL,
  object_name    text NOT NULL,
  object_type    text,
  description    text,
  UNIQUE (data_model_id, schema_name, object_name)
);
CREATE INDEX IF NOT EXISTS idx_data_object_model ON catalog.data_object(data_model_id);
COMMENT ON TABLE catalog.data_object IS 'Data object (table or view).';
