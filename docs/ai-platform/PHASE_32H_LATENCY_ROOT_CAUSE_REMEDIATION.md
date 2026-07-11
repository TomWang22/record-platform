# Phase 32H — Latency Root Cause Remediation

```text
Phase 32H: IN PROGRESS
Phase 32G soak: PASS
Latency production-readiness: BLOCKED
RCA status: REPRODUCED_AND_TRANSPORT_WAIT_LOCALIZED; underlying root cause unresolved
Verdict (32H-C): F — reproduced but still unresolved
Production enablement: NOT APPROVED
Phase 32H-D remediation: BLOCKED until confirmed cause
```

## Objective

Identify and remediate the underlying cause of the Phase 31/32G ~16–17 minute latency tier localized to **curl pre-first-byte / starttransfer wait**, not application RAG execution.

## Evidence inputs

| Source | Path |
| ------ | ---- |
| Phase 32G matrix | `/tmp/phase32g-timing-attributed-repaired-long-soak` |
| Phase 32H correlation | `/tmp/phase32h-latency-root-cause/` |
| Stall analyzer | `/tmp/phase32g-stall-attribution-analysis/` |

Artifacts under `/tmp` only — not committed.

## Ticket track

### 32H-A — Evidence consistency and Phase 32G publication

- [x] Correct RCA wording (transport-wait localized; root cause unresolved)
- [x] Run verifiers
- [x] Commit correction
- [ ] Push to origin/main (no force push)

### 32H-B — Extreme latency timeline and correlation

- [x] Analyze every ≥60 s event (32 rows)
- [x] Cross-protocol clustering (7 all-three-protocol overlap clusters)
- [x] Curl phase decomposition (27/32 request-to-first-byte dominated)
- [ ] Gateway/app/host log correlation (PARTIAL — manual follow-up)
- [x] `/tmp/phase32h-latency-root-cause/` reports

### 32H-C — Root-cause verdict

**Selected: F — Reproduced but still unresolved**

Do not select gateway/host/app cause without direct evidence.

### 32H-D — Remediation implementation

**BLOCKED** until 32H-C confirms cause (A–E).

Candidate remediations (apply only when supported):

- Explicit request timeout below 17-minute tier
- Gateway upstream timeout alignment
- Cancellation propagation / bounded retry budget
- Client connect/start-transfer/total timeout separation
- Server queue timeout / missing-first-byte watchdog
- Host sleep prevention for controlled soak
- PCAP + diagnostic bundle at wall ≥60 s

All defaults must remain safe; no production KPI enablement.

### 32H-E — Targeted reproduction

Focused controlled staging matrix:

- H1/H2/H3, cases from extreme rows
- Timing attribution + gateway/app logs + PCAP before probes
- Diagnostic trigger at wall ≥60 s
- Output under `/tmp/phase32h-targeted-reproduction/`

Do **not** run another 51,840 matrix without owner approval.

### 32H-F — Validation decision

Possible outcomes:

| Decision | Condition |
| -------- | --------- |
| STAGING CONTINUE | Extreme remediated; targeted validation clean |
| BLOCKED | Cause unresolved or extreme reproduced |
| FULL SOAK REQUIRED | Targeted pass but insufficient confidence |
| PRODUCTION ENABLEMENT | **NOT APPROVED** in every 32H outcome unless separately approved |

## PCAP capture plan

Existing PCAP (`bench_logs/security-contract/pcap/`) is dated 2026-06-10 — **no match** for July 2026 extreme events.

Next reproduction:

1. Start PCAP before probes spanning H1/H2/H3
2. Capture gateway + app logs for full window
3. Trigger diagnostic bundle at wall ≥60 s

## Hard stops

- Production enablement: NOT APPROVED
- Production default: keyword; PERCENT=0; ALLOW_PROD_PERCENT=0
- No production DB migration
- No /tmp artifacts, JSONL, PCAP, or bench logs committed
