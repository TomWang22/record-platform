CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS records;
CREATE SCHEMA IF NOT EXISTS listings;
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS auth.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT,
  settings      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS records.records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  artist             VARCHAR(256) NOT NULL,
  name               VARCHAR(256) NOT NULL,
  format             VARCHAR(64)  NOT NULL,
  catalog_number     VARCHAR(64),
  record_grade       VARCHAR(16),
  sleeve_grade       VARCHAR(16),
  has_insert         BOOLEAN DEFAULT FALSE,
  has_booklet        BOOLEAN DEFAULT FALSE,
  has_obi_strip      BOOLEAN DEFAULT FALSE,
  has_factory_sleeve BOOLEAN DEFAULT FALSE,
  is_promo           BOOLEAN DEFAULT FALSE,
  notes              TEXT,
  purchased_at       DATE,
  price_paid         NUMERIC(10,2),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION records.touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_records_touch ON records.records;
CREATE TRIGGER trg_records_touch BEFORE UPDATE ON records.records FOR EACH ROW EXECUTE FUNCTION records.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_records_user ON records.records(user_id);
CREATE INDEX IF NOT EXISTS idx_records_catalog ON records.records(catalog_number);
CREATE INDEX IF NOT EXISTS idx_records_artist_trgm ON records.records USING gin(artist gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_name_trgm   ON records.records USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_combo ON records.records(artist, name, format);

CREATE TABLE IF NOT EXISTS listings.search_history (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source     TEXT NOT NULL,
  q          TEXT NOT NULL,
  results    INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_search_q_trgm ON listings.search_history USING gin(q gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_user_time ON listings.search_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS listings.oauth_tokens (
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service            TEXT NOT NULL,
  oauth_token        TEXT NOT NULL,
  oauth_token_secret TEXT NOT NULL,
  PRIMARY KEY(user_id, service)
);

CREATE TABLE IF NOT EXISTS listings.watchlist (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  source     TEXT NOT NULL,
  query      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings.auctions (
  id         BIGSERIAL PRIMARY KEY,
  source     TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  price      NUMERIC(12,2),
  currency   TEXT,
  shipping   NUMERIC(12,2),
  ends_at    TIMESTAMPTZ,
  url        TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auctions_end ON listings.auctions(ends_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auctions_source_item ON listings.auctions(source, item_id);

DROP TABLE IF EXISTS listings.user_settings;
CREATE TABLE listings.user_settings (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  country_code TEXT DEFAULT 'US',
  currency     TEXT DEFAULT 'USD',
  fee_rate     NUMERIC(5,2) DEFAULT 0.0,
  duty_rate    NUMERIC(5,2) DEFAULT 0.0
);

-- Nightly price snapshots (for trends)
CREATE TABLE IF NOT EXISTS analytics.price_snapshots (
  id           BIGSERIAL PRIMARY KEY,
  snap_date    DATE NOT NULL,
  artist       TEXT NOT NULL,
  name         TEXT NOT NULL,
  format       TEXT,
  median_price NUMERIC(12,2),
  sample_count INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_snap_date ON analytics.price_snapshots(snap_date);
CREATE INDEX IF NOT EXISTS idx_snap_artist_name ON analytics.price_snapshots(artist, name);

CREATE OR REPLACE FUNCTION records.add_record(
  p_user UUID, p_artist TEXT, p_name TEXT, p_format TEXT,
  p_catalog TEXT DEFAULT NULL, p_record_grade TEXT DEFAULT NULL, p_sleeve_grade TEXT DEFAULT NULL,
  p_flags JSONB DEFAULT '{}'::jsonb, p_purchased DATE DEFAULT NULL, p_price NUMERIC(10,2) DEFAULT NULL, p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE rid UUID;
BEGIN
  INSERT INTO records.records(user_id, artist, name, format, catalog_number, record_grade, sleeve_grade,
    has_insert, has_booklet, has_obi_strip, has_factory_sleeve, is_promo, purchased_at, price_paid, notes)
  VALUES (p_user, p_artist, p_name, p_format, p_catalog, p_record_grade, p_sleeve_grade,
    COALESCE((p_flags->>'has_insert')::boolean, FALSE),
    COALESCE((p_flags->>'has_booklet')::boolean, FALSE),
    COALESCE((p_flags->>'has_obi_strip')::boolean, FALSE),
    COALESCE((p_flags->>'has_factory_sleeve')::boolean, FALSE),
    COALESCE((p_flags->>'is_promo')::boolean, FALSE), p_purchased, p_price, p_notes)
  RETURNING id INTO rid;
  RETURN rid;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION records.search_records(
  p_user UUID, p_q TEXT, p_limit INT DEFAULT 100, p_offset INT DEFAULT 0
) RETURNS SETOF records.records AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM records.records r
  WHERE r.user_id = p_user AND (
    r.artist ILIKE '%'||p_q||'%' OR r.name ILIKE '%'||p_q||'%' OR r.catalog_number ILIKE '%'||p_q||'%')
  ORDER BY r.updated_at DESC
  LIMIT p_limit OFFSET p_offset;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION listings.log_search(p_user UUID, p_source TEXT, p_q TEXT, p_results INT)
RETURNS VOID AS $$ BEGIN
  INSERT INTO listings.search_history(user_id, source, q, results) VALUES (p_user, p_source, p_q, p_results);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION listings.upsert_auction(
  p_source TEXT, p_item_id TEXT, p_title TEXT, p_price NUMERIC, p_currency TEXT, p_shipping NUMERIC, p_ends TIMESTAMPTZ, p_url TEXT
) RETURNS VOID AS $$ BEGIN
  INSERT INTO listings.auctions(source, item_id, title, price, currency, shipping, ends_at, url)
  VALUES (p_source, p_item_id, p_title, p_price, p_currency, p_shipping, p_ends, p_url)
  ON CONFLICT (source, item_id) DO UPDATE SET
    title = EXCLUDED.title, price = EXCLUDED.price, currency = EXCLUDED.currency,
    shipping = EXCLUDED.shipping, ends_at = EXCLUDED.ends_at, url = EXCLUDED.url, fetched_at = now();
END; $$ LANGUAGE plpgsql;
