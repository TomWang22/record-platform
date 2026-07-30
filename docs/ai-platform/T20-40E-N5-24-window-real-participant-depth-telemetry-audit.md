# T20.40E — N=5 24-window real-participant depth telemetry audit

**Status:** Telemetry audit **PASS**  
**Generated:** 2026-07-04  
**Baseline SHA:** `de2b1e5`

---

## 1. Verdict

```text
T20.40E: PASS
RP: PASS
Telemetry WARNs: 0
Playwright C-suite: 7/7 PASS
```

T20.40E ran after T20.40C-LIVE PASS and T20.40D rollback PASS.

---

## 2. RP

```text
__SCANNED__=589
RP code comb PASS
```

Report path:

```text
bench_logs/domain-comb/rp-rp-code-comb.md
```

---

## 3. Telemetry

Command:

```text
node scripts/ai-quality-telemetry-report.mjs
```

Result:

```text
WARNs (0): none
Scores — record: 3.86, longform: 3.67, final turn: 4
```

Report paths:

```text
bench_logs/ai-platform/quality-telemetry/20260704121131.md
bench_logs/ai-platform/quality-telemetry/20260704121131.json
```

Bench logs were not staged.

---

## 4. Playwright C-suite

Command:

```text
npx playwright test \
  e2e/ai-rag-opt-in-hybrid-preview-ui.spec.ts \
  e2e/seller-intelligence-ui.spec.ts \
  e2e/ai-rag-record-intelligence.spec.ts \
  e2e/ai-rag-longform-record-session.spec.ts
```

Result:

```text
7 passed
```

Coverage:

| Suite | Result |
|-------|--------|
| Opt-in hybrid preview UI/API | 4/4 PASS |
| Seller intelligence UI | 1/1 PASS |
| Record intelligence UI | 1/1 PASS |
| Longform record RAG session | 1/1 PASS |

Quality signals:

| Signal | Result |
|--------|--------|
| Record score | 3.86 |
| Longform average | 3.67 |
| Longform final turn | 4 |
| Seller panels | 4/4 |
| Leakage | PASS |

---

## 5. Hard stops

```text
Telemetry WARNs: 0
Message-body exposure: 0
Hybrid/vector production default: NOT APPROVED
PERCENT > 0: NOT APPROVED
Permanent allowlist broadening: NO
Anonymous/guest hybrid: NO
```

