-- Phase A hardening (A1–A5): append-only SALE_COMPLETED, idempotency,
-- follow-up correction events, lifecycle transition audit, settlement outbox.
-- Depends on 49-listings-sale-completed-lifecycle.sql
--
--   export PGOPTIONS='-c gssencmode=disable'
--   PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d listings \
--     -f infra/db/50-listings-sale-completed-hardening.sql

SET ROLE postgres;

-- ---------------------------------------------------------------------------
-- A2: Idempotency constraints on sale_completed_events
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sale_completed_events_market_event_id_key'
  ) THEN
    ALTER TABLE listings.sale_completed_events
      ADD CONSTRAINT sale_completed_events_market_event_id_key UNIQUE (market_event_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_completed_settlement_payment
  ON listings.sale_completed_events (settlement_source, payment_transaction_id)
  WHERE payment_transaction_id IS NOT NULL AND length(trim(payment_transaction_id)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_completed_order_completion
  ON listings.sale_completed_events (order_id, payload_hash)
  WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_completed_payload_hash_listing
  ON listings.sale_completed_events (listing_id, payload_hash);

-- ---------------------------------------------------------------------------
-- A3: Eligibility flag — sold_at / lifecycle SOLD alone is NOT evidence
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'listings' AND table_name = 'listings'
      AND column_name = 'settlement_evidence_eligible'
  ) THEN
    ALTER TABLE listings.listings
      ADD COLUMN settlement_evidence_eligible BOOLEAN NOT NULL DEFAULT FALSE;
    COMMENT ON COLUMN listings.listings.settlement_evidence_eligible IS
      'TRUE only when an immutable SALE_COMPLETED settlement event exists. sold_at alone never sets this.';
  END IF;
END $$;

-- Historical sold_at may keep lifecycle SOLD for display, but evidence stays ineligible
-- until a SALE_COMPLETED row exists (do NOT synthesize events from sold_at).
UPDATE listings.listings l
SET settlement_evidence_eligible = EXISTS (
  SELECT 1 FROM listings.sale_completed_events s WHERE s.listing_id = l.id
);

-- ---------------------------------------------------------------------------
-- A5: Lifecycle transition audit (authoritative transitions enforced in app + check)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listings.lifecycle_transition_audit (
  audit_id         BIGSERIAL PRIMARY KEY,
  listing_id       UUID NOT NULL REFERENCES listings.listings(id),
  from_lifecycle   TEXT,
  to_lifecycle     TEXT NOT NULL,
  reason_code      TEXT NOT NULL,
  actor            TEXT,
  sale_event_id    TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (to_lifecycle IN (
    'ACTIVE', 'ENDED_UNSOLD', 'SOLD', 'CANCELLED', 'EXPIRED', 'ARCHIVED'
  ))
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_transition_audit_listing
  ON listings.lifecycle_transition_audit (listing_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- A1/A7: Follow-up events (append-only corrections; never mutate SALE_COMPLETED)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listings.sale_followup_events (
  followup_event_id      TEXT PRIMARY KEY,
  market_event_id        TEXT NOT NULL UNIQUE,
  related_sale_event_id  TEXT NOT NULL
    REFERENCES listings.sale_completed_events(sale_event_id),
  listing_id             UUID NOT NULL REFERENCES listings.listings(id),
  event_type             TEXT NOT NULL
    CHECK (event_type IN (
      'SALE_REFUNDED',
      'SALE_REVERSED',
      'PAYMENT_CHARGEBACK',
      'AUCTION_NON_PAYMENT',
      'SALE_CORRECTION_RECORDED'
    )),
  occurred_at            TIMESTAMPTZ NOT NULL,
  amount                 NUMERIC(12, 2),
  currency               TEXT,
  reason_code            TEXT,
  authorization_scope    TEXT NOT NULL DEFAULT 'first_party_settlement',
  rights_status          TEXT NOT NULL DEFAULT 'FIRST_PARTY',
  deletion_status        TEXT NOT NULL DEFAULT 'ACTIVE',
  evidence_snapshot_id   TEXT,
  evidence_snapshot_hash TEXT,
  payload_hash           TEXT NOT NULL,
  payload                JSONB NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sale_followup_related_sale
  ON listings.sale_followup_events (related_sale_event_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- A1: Append-only triggers for sale_completed_events + sale_followup_events
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION listings.deny_sale_completed_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SALE_COMPLETED_APPEND_ONLY: % on listings.sale_completed_events is forbidden', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_completed_deny_update ON listings.sale_completed_events;
CREATE TRIGGER trg_sale_completed_deny_update
  BEFORE UPDATE ON listings.sale_completed_events
  FOR EACH ROW EXECUTE FUNCTION listings.deny_sale_completed_mutation();

DROP TRIGGER IF EXISTS trg_sale_completed_deny_delete ON listings.sale_completed_events;
CREATE TRIGGER trg_sale_completed_deny_delete
  BEFORE DELETE ON listings.sale_completed_events
  FOR EACH ROW EXECUTE FUNCTION listings.deny_sale_completed_mutation();

CREATE OR REPLACE FUNCTION listings.deny_sale_followup_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SALE_FOLLOWUP_APPEND_ONLY: % on listings.sale_followup_events is forbidden', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_followup_deny_update ON listings.sale_followup_events;
CREATE TRIGGER trg_sale_followup_deny_update
  BEFORE UPDATE ON listings.sale_followup_events
  FOR EACH ROW EXECUTE FUNCTION listings.deny_sale_followup_mutation();

DROP TRIGGER IF EXISTS trg_sale_followup_deny_delete ON listings.sale_followup_events;
CREATE TRIGGER trg_sale_followup_deny_delete
  BEFORE DELETE ON listings.sale_followup_events
  FOR EACH ROW EXECUTE FUNCTION listings.deny_sale_followup_mutation();

-- Revoke mutation grants from application readwrite role when present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    REVOKE UPDATE, DELETE ON listings.sale_completed_events FROM record_readwrite;
    REVOKE UPDATE, DELETE ON listings.sale_followup_events FROM record_readwrite;
    GRANT SELECT, INSERT ON listings.sale_completed_events TO record_readwrite;
    GRANT SELECT, INSERT ON listings.sale_followup_events TO record_readwrite;
    GRANT SELECT, INSERT ON listings.lifecycle_transition_audit TO record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON listings.sale_completed_events TO record_readonly;
    GRANT SELECT ON listings.sale_followup_events TO record_readonly;
    GRANT SELECT ON listings.lifecycle_transition_audit TO record_readonly;
  END IF;
END $$;

COMMENT ON TABLE listings.sale_completed_events IS
  'Append-only SALE_COMPLETED settlement events. UPDATE/DELETE forbidden by trigger + grants. Corrections use sale_followup_events.';
COMMENT ON TABLE listings.sale_followup_events IS
  'Append-only refund/reversal/chargeback/non-payment/correction events. Never mutate SALE_COMPLETED.';
