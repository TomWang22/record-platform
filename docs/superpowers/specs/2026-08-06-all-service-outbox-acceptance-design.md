# All-Service Outbox Acceptance Design

**Date:** 2026-08-06  
**Status:** design-only  
**Parent:** `2026-08-06-record-platform-performance-and-lineage-master-design.md`  
**Track:** C  
**execution_authorized:** false

## Goal

Auction-monitor canary-v3 proves one publisher. This contract closes the **platform outbox denominator** for every owner/table.

## Inventory artifact

```text
reports/performance/outbox-owner-inventory.json
```

Shape:

```json
{
  "schema": "record-platform-outbox-inventory/v1",
  "outboxes": [
    {
      "service": "service-name",
      "database": "database-name",
      "table": "schema.outbox_events",
      "publisher_owner": "service-name",
      "topic": "topic-name",
      "consumer_groups": [],
      "status_predicate": "published=false",
      "terminal_predicates": [],
      "publisher_present": true
    }
  ]
}
```

Expected count must equal discovered count. Missing publisher → explicit `publisher_present: false` plus disposition path (not silent ack).

## Required lifecycle states (per test row)

```text
database inserted
publisher selected
produce attempted
Kafka broker acknowledged
database acknowledged
consumer received
consumer offset committed
business effect observed
```

## Frozen identity

```text
run_id, event_id, outbox_primary_key, payload_sha256,
producer principal, producer client_id, topic, partition, offset,
time-covered leader broker, consumer group, consumer principal,
consumer offset, business-effect identifier
```

## Latency measurements

```text
insert → selection
selection → produce
produce → broker acknowledgment
broker acknowledgment → database acknowledgment
broker acknowledgment → consumer receipt
consumer receipt → offset commit
consumer receipt → business effect
insert → final business effect
```

Report p50, p95, p99, max, failures, retries, unknowns separately. Unknowns must be zero for PASS.

## Failure / recovery rows

```text
broker unavailable
publisher restart after selection
publisher restart after broker ack before DB ack
database ack failure
duplicate delivery
consumer restart
consumer rebalance
poison event
retry exhaustion
DLQ disposition
out-of-order arrival where ordering is required
```

Process exit code alone is never success evidence.

## Relation to canary-v3

Canary-v3 closes auction-monitor evidence-complete accounting only. Track C must not treat canary-v3 PASS as multi-outbox closure.
