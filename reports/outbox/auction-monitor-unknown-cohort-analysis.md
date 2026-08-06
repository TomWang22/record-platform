# Auction-monitor UNKNOWN_BLOCKING cohort analysis

## Correction

| Metric | Value |
| --- | --- |
| categorized | 1067/1067 |
| causally resolved (ACKNOWLEDGED + NEVER_SELECTED) | 168/1067 |
| prior UNKNOWN_BLOCKING | 899/1067 |

## Reclassification (no payload export)

| New class | Count | Meaning |
| --- | ---: | --- |
| PUBLISHER_CAPACITY_BACKLOG_AWAITING_FIFO | majority of 899 | Eligible `published=false`, behind FIFO head |
| SEMANTIC_DUPLICATE_GENERATION_CANDIDATE | duplicate cohort subset | Same aggregate many new event IDs from 120s ON CONFLICT |

## Permanent historical evidence gaps (sealed)

Cannot attribute individual rows to: deploy SHA, StandardAuthorizer cutover, ACL/topic/mTLS windows, Colima NodeNotReady, chaos runs, broker coords, consumer/business effects, per-send traces.

**Lineage is not complete** until broker-ack instrumentation exists or remaining rows are explicitly sealed as gaps (done for unattributable dimensions).
