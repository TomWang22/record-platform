# Auction-monitor capacity model supersession

**Classification:** `PRIOR_CAPACITY_MODEL_INTERNALLY_INCONSISTENT`

## Conflict

The same RCA pass recorded:

| Field | Value A | Value B |
| --- | --- | --- |
| net growth /h | 20,563.4 (from pending_delta/elapsed) | 15,870 (insert − ceiling) |
| DB ack /h | −3,943.4 (insert − net A) | 750 (configured ceiling / tick-aligned claim) |

A negative acknowledgment rate is impossible. The 750/h figure mixed **configured selection ceiling** with **database acknowledgment** and was never a broker-ack measurement.

## State after supersession

- `authoritative_auction_monitor_ack_rate = UNRESOLVED`
- `authoritative_auction_monitor_net_growth_rate = UNRESOLVED`
- `negative_ack_rate_accepted = false`

Original JSON reports are **preserved unmodified**. Authoritative rates require Phase 3 interval-aligned accounting.
