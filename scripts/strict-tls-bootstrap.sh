# file: scripts/strict-tls-bootstrap.sh  (re-run to ensure secrets exist in BOTH namespaces)
#!/usr/bin/env bash
set -euo pipefail
set -x
# dev-root.pem, tls.crt, tls.key must be in ./certs/
kubectl -n ingress-nginx create secret tls record-local-tls \
  --cert=certs/record.local.crt --key=certs/record.local.key \
  -o yaml --dry-run=client | kubectl apply -f -
kubectl -n record-platform create secret tls record-local-tls \
  --cert=certs/record.local.crt --key=certs/record.local.key \
  -o yaml --dry-run=client | kubectl apply -f -
kubectl -n ingress-nginx create secret generic dev-root-ca \
  --from-file=dev-root.pem=certs/dev-root.pem \
  -o yaml --dry-run=client | kubectl apply -f -
kubectl -n record-platform create secret generic dev-root-ca \
  --from-file=dev-root.pem=certs/dev-root.pem \
  -o yaml --dry-run=client | kubectl apply -f -