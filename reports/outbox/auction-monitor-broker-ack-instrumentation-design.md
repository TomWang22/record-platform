# Auction-monitor broker-ack instrumentation

- **Status:** IMPLEMENTED_IN_SOURCE_NOT_DEPLOYED
- Metrics + structured logs + OTEL spans separate broker ack from DB ack.
- Pending gauge refresh throttled to ≥10 minutes (full COUNT is expensive).
- **Not deployed** in this pass; cluster still runs prior image.
