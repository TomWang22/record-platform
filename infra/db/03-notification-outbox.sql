-- Transactional outbox for notification-service (NotificationCreatedV1 on domain create).
-- Flow: same TX as notification.notifications insert; background worker publishes to Kafka; mark published.
-- NotificationSentV1 is reserved for an actual delivery transition (not this create path).

CREATE TABLE IF NOT EXISTS notification.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_unpublished
  ON notification.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON COLUMN notification.outbox_events.payload IS 'UTF-8 JSON notification event matching consumer decoder (JSON.stringify bytes; not binary protobuf).';
COMMENT ON COLUMN notification.outbox_events.id IS 'UUID = metadata.event_id; publisher must not mint a new UUID on publish.';
COMMENT ON TABLE notification.outbox_events IS 'Transactional outbox: NotificationCreatedV1 on create; Kafka key = aggregate_id (notification_id); topic ${ENV_PREFIX}.notification.events.';
