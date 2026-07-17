# Phase 34C — Prompt / model configuration registry

```text
Status: SCAFFOLDING COMPLETE — SELECTION NOT HOLD-OUT ACCEPTED
MODEL_WEIGHT_TRAINING: NO
OPTIMIZATION: PROMPT_RETRIEVAL_RERANKER_TOOL_CALIBRATION_AND_MODEL_SELECTION
Target: /tmp/phase33f-capability-gauntlet-target-v1 — ABSENT / NOT LAUNCHED
Production: NOT APPROVED
```

## Artifacts

| Artifact | Path |
| --- | --- |
| Registry | `scripts/ai-platform/phase34-prompt-registry/` |
| Generator / validator | `scripts/ai-platform/generate-phase34-prompt-registry.mjs` |
| Eval policy (floors) | `scripts/ai-platform/phase34-eval-policy.json` |
| Candidate selection | `scripts/ai-platform/run-phase34-prompt-candidate-selection.mjs` |
| Tests | `tests/phase34-prompt-registry.test.mjs` |

## Counts

- 8 capabilities × 12 material candidates = **96** configurations
- Each candidate has `version`, `content_sha256`, `rationale`, prompts, and policies
- Primary dimensions are material (evidence-first, tool ordering, audience, few-shot, schema strategy, …) — not punctuation-only variants

## Available model tiers (honest)

Discovered from `services/python-ai-service/app/ai/providers/registry.py` and `app/ai/config.py`:

1. **rule_deterministic** — `rule` / `rule-engine` (default)
2. **ollama_optional** — `ollama` / `llama3.2:1b` (+ `nomic-embed-text` embeddings)

**Tier count: 2.** Three-tier comparison is `NOT_AVAILABLE` — no third approved tier invented.

## Commands

```bash
node scripts/ai-platform/generate-phase34-prompt-registry.mjs
node scripts/ai-platform/generate-phase34-prompt-registry.mjs --validate
node scripts/ai-platform/run-phase34-prompt-candidate-selection.mjs --smoke
node --test tests/phase34-prompt-registry.test.mjs
```

Scorecards write under `/tmp/phase34-eval/candidate-selection/` (not committed).
