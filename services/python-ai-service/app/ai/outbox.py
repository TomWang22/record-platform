"""T15.4D — python-ai outbox publisher for PricingRecommendationCreatedV1."""
from __future__ import annotations

import json
import os
import ssl
import uuid
from typing import Any, Dict, Optional

from aiokafka import AIOKafkaProducer

PREFIX = os.getenv("ENV_PREFIX", "dev")
AI_EVENTS_TOPIC = f"{PREFIX}.ai.events"


async def _kafka_producer() -> Optional[AIOKafkaProducer]:
    if os.getenv("PYTHON_AI_OUTBOX_PUBLISHER", "1") == "0":
        return None
    broker = os.getenv("KAFKA_BROKER", "kafka.record-platform.svc.cluster.local:9093")
    ca = os.getenv("KAFKA_SSL_CA_CERT", "/etc/kafka/secrets/ca-cert.pem")
    cert = os.getenv("KAFKA_CLIENT_CERT", "/etc/kafka/secrets/client.crt")
    key = os.getenv("KAFKA_CLIENT_KEY", "/etc/kafka/secrets/client.key")
    if not os.getenv("KAFKA_USE_SSL", "true").lower() == "true":
        return None
    ctx = ssl.create_default_context()
    if os.path.exists(ca):
        ctx.load_verify_locations(ca)
    if os.path.exists(cert) and os.path.exists(key):
        ctx.load_cert_chain(cert, key)
    producer = AIOKafkaProducer(
        bootstrap_servers=broker,
        security_protocol="SSL",
        ssl_context=ctx,
    )
    await producer.start()
    return producer


async def insert_pricing_recommendation_outbox(
    conn,
    *,
    user_id: str,
    listing_id: str,
    envelope: Dict[str, Any],
) -> str:
    event_id = str(uuid.uuid4())
    payload = json.dumps(
        {
            "metadata": {
                "event_id": event_id,
                "event_type": "PricingRecommendationCreatedV1",
                "aggregate_id": listing_id,
                "aggregate_type": "listing_offer",
                "occurred_at": envelope.get("generated_at"),
                "producer": "python-ai-service",
                "version": "1",
            },
            "payload": {
                "insight_id": envelope.get("insight_id", event_id),
                "contract_id": envelope.get("contract_id", "pricing_recommendation"),
                "user_id": user_id,
                "listing_id": listing_id,
                "summary": envelope.get("summary"),
                "details": envelope.get("details"),
                "source_refs": envelope.get("source_refs", []),
                "model_used": envelope.get("model_used"),
                "generated_at": envelope.get("generated_at"),
            },
        }
    ).encode("utf-8")
    await conn.execute(
        """
        INSERT INTO ai.outbox_events (id, aggregate_id, type, version, payload, published)
        VALUES ($1::uuid, $2, 'PricingRecommendationCreatedV1', 1, $3::bytea, false)
        """,
        event_id,
        listing_id,
        payload,
    )
    return event_id


async def publish_python_ai_outbox_tick(conn, *, limit: int = 25) -> int:
    producer = await _kafka_producer()
    if not producer:
        return 0
    published = 0
    try:
        rows = await conn.fetch(
            """
            WITH picked AS (
              SELECT id FROM ai.outbox_events WHERE published = false
              ORDER BY created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED
            )
            SELECT b.id::text, b.aggregate_id, b.payload
            FROM ai.outbox_events b
            INNER JOIN picked p ON b.id = p.id
            """,
            limit,
        )
        for row in rows:
            await producer.send_and_wait(
                AI_EVENTS_TOPIC,
                key=row["aggregate_id"].encode("utf-8"),
                value=bytes(row["payload"]),
            )
            await conn.execute(
                "UPDATE ai.outbox_events SET published = true WHERE id = $1::uuid",
                row["id"],
            )
            published += 1
    finally:
        await producer.stop()
    return published
