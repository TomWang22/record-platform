# OCH full scripts/infra reference bundle — merge into Record Platform

This document describes a **reference tarball produced outside this repo** (not the housing substrate bundle). Use it to **bring material into Record Platform (RP)** when you want the full script tree, extra Kafka/infra, outbox SQL, observability assets, and CI workflows from that build.

**This is for RP only.** Do not treat this tarball as the substrate bundle for Off-Campus-Housing-Tracker; unpack and merge into the **record-platform** repository root (or a worktree), then reconcile conflicts.

**Colima / cluster bring-up:** Another project may own Colima and base cluster setup. **This doc does not set up Colima** — it only describes what the tarball contains and how to merge it into RP.

---

## Tarball identity (example build)

| Field | Value |
|--------|--------|
| **Path** | `/Users/tom/record-platform-och-full-scripts-infra-reference-20260410-1245.tar.gz` |
| **Approx. size** | ~8.6 MB |
| **SHA-256** | `e321f349d24cf61695c086d28ccd0812879ebbd1864a9902f56ce65fb93f1684` |

Verify after download or copy:

```bash
shasum -a 256 /Users/tom/record-platform-och-full-scripts-infra-reference-20260410-1245.tar.gz
```

---

## Verification (full count, not spot-check)

When the bundle was built, **source `scripts/`** file count (excluding `__pycache__/`, `*.pyc`, `.DS_Store`) matched the tarball:

- **Source:** 469 files  
- **Bundled `scripts/` regular files in tar:** 469  

Rsync-style excludes used when assembling:

- `--exclude='__pycache__/'`
- `--exclude='*.pyc'`
- `--exclude='.DS_Store'`

---

## What is inside the tarball

- **`scripts/`** — Full tree (469 regular files as above).
- **`proto/common.proto`** and full **`proto/events/`**.
- **`infra/k8s/`** — Including `kafka-kraft-metallb`, `kafka-certs`, `metallb`, `base/kafka*`, `base/observability` (Prometheus/Grafana/OTel/Jaeger, SLO examples, auth-outbox rules, etc.).
- **`infra/monitoring/`** — Extra Prometheus rules + Grafana JSON (Kafka, TLS, auth-outbox, …).
- **`infra/db/`** — Full SQL tree (all `*outbox*.sql` and related schemas) so `ensure-auth-outbox.sh` and related scripts find the files they reference.
- **Root `Makefile`**.
- **`.github/workflows/`** — e.g. `kafka-cluster-verify.yml`, `kafka-dns-validate.yml`, `kafka-alignment.yml`, `protocol-validation.yml` (broad shellcheck coverage).

### Markdown at tar root

| File | Purpose |
|------|--------|
| **README-BUNDLE.md** | Index and layout of the bundle. |
| **RECORD_PLATFORM_ALIGNMENT.md** | How to align with RP: `REPO_ROOT`, namespaces, `ENV_PREFIX`, Postgres ports, Colima vs cloud, CI, TLS secrets. |
| **OUTBOX_AND_OBSERVABILITY.md** | Outbox SQL paths, `ensure-auth-outbox.sh` / `auth-outbox-*.sh`, `auth_outbox_unpublished_count` alert, Prometheus + Grafana assets, and **what you must still implement in service code** (publisher + metrics). |

---

## Unpack

```bash
tar -xzf /Users/tom/record-platform-och-full-scripts-infra-reference-20260410-1245.tar.gz -C /path/to/workspace
```

Then read **in order**:

1. **README-BUNDLE.md**  
2. **RECORD_PLATFORM_ALIGNMENT.md**  
3. **OUTBOX_AND_OBSERVABILITY.md**

---

## Merge into Record Platform

1. **Unpack** to a **temporary directory** or a **git worktree** first; do not blindly overwrite `record-platform` without reviewing diffs.
2. **Copy or rsync** into your RP clone root, e.g.:
   - `scripts/` → merge; expect **some conflicting scripts** — resolve per file (keep RP behavior where it is canonical; take bundle additions for Kafka 3-broker, certs, outbox, CI).
   - `proto/`, `infra/k8s/`, `infra/monitoring/`, `infra/db/` → merge carefully; diff against current RP layouts.
   - `.github/workflows/` → add or merge workflow files.
   - Root `Makefile` → merge or fold targets into existing automation.
3. **Naming / branding:** Replace OCH-oriented names with RP-oriented ones where the bundle says “rebuild och” or similar — use **rebuild RP** (or your standard RP script names) so operators are not confused.
4. **Kafka / TLS / zero trust:** The bundle is aimed at **real multi-broker Kafka**, **EKU** usage where **clientAuth and serverAuth** are required, and **zero-trust** patterns. After merge, wire secrets, trust stores, and service env to RP’s namespaces and `record-platform` (or your chosen namespace) per **RECORD_PLATFORM_ALIGNMENT.md**.

---

## Relationship to other bundles

| Artifact | Purpose |
|----------|--------|
| **`scripts/build-substrate-bundle.sh` output** | Portable substrate + housing skeleton for a **different repo**. |
| **This OCH full reference tarball** | **Superset reference for RP**: scripts + infra + db + observability + CI; merge **into** record-platform. |

Older, smaller archives under `/Users/tom/` may still exist; you can delete them and keep only this full-scripts build if you want a single reference tarball.

---

## Checklist after merge

- [ ] Conflicts in `scripts/` resolved; OCH-specific names updated to RP where needed.  
- [ ] `infra/db` outbox SQL paths match what `ensure-auth-outbox.sh` (and friends) expect.  
- [ ] Workflows pass or are adjusted for RP branch names and secrets.  
- [ ] Kafka 3-broker / mTLS / EKU settings documented in Runbook or ENGINEERING as you adopt them.  
- [ ] Service code: implement outbox **publisher** and **metrics** per **OUTBOX_AND_OBSERVABILITY.md** (bundle documents gaps; code is not automatic).
