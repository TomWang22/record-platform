# Release lock operations (canonical)

**Edge hostname:** `record-platform.test` (never `record.local`).  
**TLS:** strict only — use `certs/dev-root.pem` / `certs/dev-chain.pem`; never `curl -k`.  
**Namespace:** `record-platform`.

## Host setup

```bash
make rp-bootstrap-host-deps
make ensure-edge-hosts    # /etc/hosts → MetalLB Caddy IP
```

MetalLB Caddy edge IP:

```bash
kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}{"\n"}'
# curl probes use: --resolve record-platform.test:443:<LB_IP> --cacert certs/dev-root.pem
```

## Cold bootstrap

```bash
COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/rp-all-11-<date> make cold-bootstrap
```

## Release lock gates (Phase 12/13)

```bash
pnpm install --frozen-lockfile
bash scripts/rp-repo-hygiene-contract.sh
bash scripts/rp-rp-decontaminate-scan.sh
bash scripts/rp-runtime-domain-comb.sh
bash scripts/rp-db-domain-comb.sh
bash scripts/rp-messaging-domain-comb.sh
API_BASE=https://record-platform.test bash scripts/probe-messages-start-contract.sh

bash scripts/rp-bootstrap-grpc-mtls-gate.sh      # gRPC mTLS 11/11
bash scripts/smoke-rp-edge-h2-h3-strict-tls.sh   # H2/H3 strict TLS
bash scripts/smoke-rp-mtls-real.sh               # real mTLS edge
bash scripts/rp-verify-kafka-cert-chain.sh
bash scripts/verify-kafka-ready.sh
bash scripts/audit-rp-redis-lua-runtime-contract.sh
bash scripts/audit-rp-event-outbox-contract.sh
CLUSTER_DOCTOR_STRICT=1 make cluster-doctor
```

## Playwright full sweep

```bash
cd webapp && CONTRACT_SCREENSHOT_DATE="$(date -u +%F)" \
  E2E_API_BASE=https://record-platform.test \
  NODE_EXTRA_CA_CERTS=../certs/dev-root.pem \
  pnpm exec playwright test --workers=1 --retries=0 --timeout=180000
```

## Screenshot strict guard

```bash
CONTRACT_ONLY=1 make rp-frontend-screenshot-strict-contract
```

## Backup / restore

```bash
PGPASSWORD=postgres bash scripts/backup-rp-postgres-dbs.sh
# restore smoke: use latest backups/rp-all-11-* dir per bench_logs/release-contract docs
```

## Ollama (optional analytics)

```bash
make ollama-note          # local: ollama serve && ollama pull llama3.2
make ollama-env           # point analytics-service at in-cluster Ollama LB
```

## Do not use

| Forbidden | Use instead |
|-----------|---------------|
| `record.local` | `record-platform.test` |
| `curl -k` / `--insecure` | `--cacert certs/dev-root.pem` |
| RP / record-platform / landlord / tenant terms in product paths | RP marketplace vocabulary |
| Cursor `Co-authored-by` trailers in commits | `git commit-tree` rewrite before push |

## Rollback

```bash
git revert <release-lock-sha>
```

## Release tag (prepare only — do not run unless requested)

```bash
git tag -a rp-marketplace-release-$(date -u +%Y%m%d) -m "Record Platform marketplace release lock"
```
