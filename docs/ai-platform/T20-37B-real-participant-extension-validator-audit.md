# T20.37B — Real-participant extension validator audit

**Status:** Validator **PASS**  
**Generated:** 2026-07-03  
**Baseline SHA:** `cb22969`  
**Artifact:** `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md`

---

## 1. Artifact unchanged (T20.36B baseline)

| Check | Result |
|-------|--------|
| Artifact SHA256 | `2f540e4b01fa1a5e8ea4eafbe4d2e86f9cd27007307176574d2cb5a8f69166c1` |
| Unchanged since T20.36B PASS | **PASS** |
| Complete rows ≥3 | **PASS** (3/3) |

---

## 2. Participants (3 real + 1 contract control)

| # | Email | UUID | Type | JWT sub match |
|---|-------|------|------|---------------|
| 1 | tom@example.com | `0dc268d0-a86f-4e12-8d10-9db0f1b735e0` | real_owner_approved | **PASS** |
| 2 | tw5126@example.com | `950a40b1-d12e-4839-aefd-0d353b90182a` | internal_staff | **PASS** |
| 3 | seed@example.com | `2901355e-7d04-4da1-b3a7-c22807326b94` | internal_staff | **PASS** |
| — | e2e-contract@record-platform.local | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` | contract control | **PASS** |

Staging 12-JWT cohort: **excluded** (not used as real participants).

---

## 3. Runtime env (KEEP)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

| Check | Result |
|-------|--------|
| CANARY=1 | **PASS** |
| Single contract allowlist only | **PASS** |
| PERCENT=0 | **PASS** |
| ALLOW_PROD_PERCENT=0 | **PASS** |
| Production default keyword | **PASS** (unchanged) |

**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 4. Preflight scripts

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-rp-decontaminate-scan.sh` | **PASS** (`__SCANNED__=105`) |
| `ai-quality-telemetry-report.mjs` | **PASS** (WARNs 0) |

---

## 5. Preview UI smoke

| Spec | Result |
|------|--------|
| `e2e/ai-rag-opt-in-hybrid-preview-ui.spec.ts` | **4/4 PASS** |

---

## 6. Verdict

```text
T20.37B: PASS — artifact unchanged, 3 participants reconfirmed, preflight PASS
T20.37C-LIVE: AUTHORIZED
Expected matrix: 16 windows → preview_opt_in=2160, allowlist=720, total=2880
```
