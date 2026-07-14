# Phase 32H-R1 Process Identity Repair

## Problem

Baseline-r7 blocked at 21/8640 probes because `isPhase32hCaptureProcess()` matched
the substring `dumpcap` inside an agent diagnostic `bash -c` shell (PID 10745).
That shell was not the capture executable and did not own PCAP output.

## Repair

- `scripts/lib/phase32h-process-identity.mjs` classifies collectors by **executable
  basename** (`comm` / argv[0]), not free-form command text.
- Diagnostic executables (`bash`, `node`, `rg`, `ps`, …) are always `NON_COLLECTOR`
  even when their args quote collector commands or evidence-root paths.
- `scripts/phase32h-runtime-status-readonly.mjs` provides committed read-only status
  polling so operators do not need ad-hoc shells embedding collector strings.

## Baseline roots

| Root | Status |
|------|--------|
| `/tmp/phase32h-r1-baseline-r7` | **BLOCKED** — false foreign classifier; never resume |
| `/tmp/phase32h-r1-baseline-r8` | superseded / not the frozen PASS root |
| `/tmp/phase32h-r1-baseline-r9` | **FROZEN PASS** — immutable; packet-index status repair is post-R9 source work |
| `/tmp/phase32h-r1-caffeinate-r1` | Protected arm (not launched until new SHA + owner approval) |
