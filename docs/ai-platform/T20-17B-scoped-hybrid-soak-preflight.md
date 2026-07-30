# T20.17B — Scoped hybrid soak preflight

**Status:** Preflight complete — **PASS** (controls verified)  
**Generated:** 2026-06-30  
**Plan SHA:** `b460e00` (T20.17A)  
**Image:** `python-ai-service:t20-p216b`

---

## 1. Cluster snapshot

| Check | Result |
|-------|--------|
| Image | `python-ai-service:t20-p216b` |
| Pod | `python-ai-service-56b8566fd-gttdl` — **Running** 1/1 |
| Service | `python-ai-service` ClusterIP — **Ready** |

### KEEP env (verified pre-drill)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

---

## 2. Preflight scripts

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** (RAG + seller endpoints); `session_reset` **degraded** — no active session in probe sequence (informational; non-blocking for hybrid soak) |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-rp-decontaminate-scan.sh` | **PASS** (`__SCANNED__=589`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** (record 3.86, longform 3.67, final 4.0) |

---

## 3. Control drills

### 3.1 KEEP env — allowlisted contract user

Run: `hybrid-canary-transcript/20260630-185503`

| Metric | Result |
|--------|--------|
| HTTP 200 | **9/9** |
| `retrieval_mode` | **hybrid_canary** 9/9 |
| `gate_reason` | allowlist (via hybrid_canary lane) |
| `final_tagged_plan` | hybrid_canary, score **4.0**, refs **9**, fallback **0** |
| Leakage | **PASS** 9/9 |

### 3.2 Fake allowlist — Lane C control

Env: `AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=00000000-0000-0000-0000-000000000000`

Run: `hybrid-canary-transcript/20260630-185744`

| Metric | Result |
|--------|--------|
| HTTP 200 | **9/9** |
| `retrieval_mode` | **keyword** 9/9 |
| `gate_reason` | keyword_default |
| Leakage | **PASS** 9/9 |

### 3.3 Full rollback — `CANARY=0`

Run: `hybrid-canary-transcript/20260630-185837`

| Metric | Result |
|--------|--------|
| HTTP 200 | **9/9** |
| `retrieval_mode` | **keyword** 9/9 |
| Leakage | **PASS** 9/9 |

### 3.4 KEEP restore

Env restored exactly; rollout **complete**.

Run: `hybrid-canary-transcript/20260630-185929`

| Metric | Result |
|--------|--------|
| HTTP 200 | **9/9** |
| `retrieval_mode` | **hybrid_canary** 9/9 |
| `final_tagged_plan` | hybrid_canary, score **4.0**, fallback **0** |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **0** verified |

---

## 4. Gate verdict — **PASS**

Proceed to **T20.17C** live scoped hybrid soak eval (10× transcript).

---

## 5. Artifacts (local only — not committed)

| Artifact | Path |
|----------|------|
| KEEP control | `bench_logs/ai-platform/hybrid-canary-transcript/20260630-185503/` |
| Fake allowlist | `bench_logs/ai-platform/hybrid-canary-transcript/20260630-185744/` |
| CANARY=0 | `bench_logs/ai-platform/hybrid-canary-transcript/20260630-185837/` |
| KEEP restore | `bench_logs/ai-platform/hybrid-canary-transcript/20260630-185929/` |
