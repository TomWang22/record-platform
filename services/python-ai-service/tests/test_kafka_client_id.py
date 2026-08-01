"""Canonical python-ai Kafka client.id contract tests."""
from __future__ import annotations

import os

import pytest

from app.kafka_client_id import resolve_kafka_client_id


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    for k in (
        "KAFKA_CLIENT_ID",
        "RP_SERVICE_NAME",
        "OTEL_SERVICE_NAME",
        "SERVICE_NAME",
        "RP_POD_UID",
        "POD_UID",
        "RP_KAFKA_CLIENT_ID_STRICT",
        "RP_ACCEPTANCE_MODE",
    ):
        monkeypatch.delenv(k, raising=False)


def test_never_uses_aiokafka_library_default_shape():
    os.environ["RP_SERVICE_NAME"] = "python-ai-service"
    os.environ["RP_POD_UID"] = "5bfeea4d-edad-4fa4-a841-2542262219da"
    cid = resolve_kafka_client_id("market-event-consumer")
    assert cid.startswith("record-platform.python-ai-service.")
    assert cid.endswith(".market-event-consumer")
    assert "aiokafka" not in cid


def test_two_pods_distinct():
    os.environ["RP_SERVICE_NAME"] = "python-ai-service"
    a = resolve_kafka_client_id("producer", pod_uid="aaaaaaaa-1111-1111-1111-111111111111")
    b = resolve_kafka_client_id("producer", pod_uid="bbbbbbbb-2222-2222-2222-222222222222")
    assert a != b


def test_two_roles_same_pod_distinct():
    os.environ["RP_SERVICE_NAME"] = "python-ai-service"
    uid = "5bfeea4d-edad-4fa4-a841-2542262219da"
    a = resolve_kafka_client_id("producer", pod_uid=uid)
    b = resolve_kafka_client_id("outbox-publisher", pod_uid=uid)
    c = resolve_kafka_client_id("market-event-consumer", pod_uid=uid)
    assert len({a, b, c}) == 3


def test_group_id_does_not_imply_client_id():
    # client id is independent of consumer group (group is not an input)
    os.environ["RP_SERVICE_NAME"] = "python-ai-service"
    os.environ["RP_POD_UID"] = "5bfeea4d-edad-4fa4-a841-2542262219da"
    assert resolve_kafka_client_id("market-event-consumer") != "python-ai-service"


def test_missing_pod_uid_fails_closed_in_acceptance():
    os.environ["RP_ACCEPTANCE_MODE"] = "1"
    os.environ["RP_SERVICE_NAME"] = "python-ai-service"
    with pytest.raises(ValueError, match="POD_UID"):
        resolve_kafka_client_id("producer")


def test_missing_role_fails_closed():
    os.environ["RP_SERVICE_NAME"] = "python-ai-service"
    os.environ["RP_POD_UID"] = "5bfeea4d-edad-4fa4-a841-2542262219da"
    with pytest.raises(ValueError, match="invalid kafka client role"):
        resolve_kafka_client_id("")


def test_malformed_role_rejected():
    os.environ["RP_SERVICE_NAME"] = "python-ai-service"
    os.environ["RP_POD_UID"] = "5bfeea4d-edad-4fa4-a841-2542262219da"
    with pytest.raises(ValueError):
        resolve_kafka_client_id("evil role")
