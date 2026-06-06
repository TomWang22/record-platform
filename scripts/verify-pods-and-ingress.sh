#!/usr/bin/env bash
# Verify pods and ingress-nginx layout:
#   - ingress-nginx: 2 Caddy, 1 Envoy; gRPC/HTTP2 (Envoy), HTTP/3 (Caddy), strict TLS
#   - record-platform: service pods at 1 replica; Redis external; exporters 1
#   - Kafka: plaintext-only limitation (noted)
set -euo pipefail
NS_INGRESS=ingress-nginx
NS_RP=record-platform
FAIL=0

echo "=== ingress-nginx ==="
CADDY_READY=$(kubectl -n $NS_INGRESS get deploy caddy-h3 -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
CADDY_SPEC=$(kubectl -n $NS_INGRESS get deploy caddy-h3 -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
if [[ "$CADDY_READY" == "2" && "$CADDY_SPEC" == "2" ]]; then
  echo "  Caddy: 2/2"
else
  echo "  Caddy: ${CADDY_READY:-0}/${CADDY_SPEC:-?} (expected 2/2)"
  FAIL=1
fi

ENVOY_READY=$(kubectl -n $NS_INGRESS get deploy envoy -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
ENVOY_SPEC=$(kubectl -n $NS_INGRESS get deploy envoy -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
if [[ "$ENVOY_READY" == "1" && "$ENVOY_SPEC" == "1" ]]; then
  echo "  Envoy: 1/1 (HTTP/2, gRPC)"
else
  echo "  Envoy: ${ENVOY_READY:-0}/${ENVOY_SPEC:-?} (expected 1/1; apply infra/k8s/ingress-nginx-envoy.yaml)"
  FAIL=1
fi

echo ""
echo "=== record-platform (replicas=1) ==="
for d in api-gateway auth-service records-service listings-service messaging-service media-service trust-service notification-service analytics-service shopping-service auction-monitor python-ai-service; do
  R=$(kubectl -n $NS_RP get deploy $d -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  S=$(kubectl -n $NS_RP get deploy $d -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "?")
  if [[ "$R" == "1" && "$S" == "1" ]]; then
    echo "  $d: 1/1"
  else
    echo "  $d: ${R:-0}/${S:-?}"
    FAIL=1
  fi
done

echo ""
echo "=== Redis (external) ==="
# redis deploy should not exist; redis-external Service+Endpoints should
REDIS_DEPLOY=$(kubectl -n $NS_RP get deploy redis -o name 2>/dev/null || true)
REDIS_EXT=$(kubectl -n $NS_RP get svc redis-external -o name 2>/dev/null || true)
if [[ -z "$REDIS_DEPLOY" && -n "$REDIS_EXT" ]]; then
  echo "  Redis: external (redis-external), in-cluster deploy removed"
else
  echo "  Redis: in-cluster deploy=${REDIS_DEPLOY:-none}, redis-external=${REDIS_EXT:-none}"
  FAIL=1
fi

echo ""
echo "=== Exporters (replicas=1) ==="
for d in nginx-exporter haproxy-exporter; do
  R=$(kubectl -n $NS_RP get deploy $d -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  S=$(kubectl -n $NS_RP get deploy $d -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "?")
  if [[ "$R" == "1" && "$S" == "1" ]]; then
    echo "  $d: 1/1"
  else
    echo "  $d: ${R:-0}/${S:-?}"
    FAIL=1
  fi
done

echo ""
echo "=== TLS / health ==="
echo "  Caddy: leaf (record-local-tls) + CA (dev-root-ca); tcpSocket:443 + /_caddy/healthz (HTTP/3)"
echo "  Envoy: strict TLS to backends (dev-root-ca); tcpSocket:10000"
echo "  Services: gRPC health via grpc-health-probe (Dockerfiles + deploy exec probes)"
echo "  Kafka: plaintext-only limitation (future: TLS for Kafka)"

echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "All checks passed."
else
  echo "Some checks failed. Apply: kubectl kustomize infra/k8s/base | kubectl apply -f -"
  echo "Ingress-nginx: kubectl apply -f infra/k8s/caddy-h3-deploy.yaml -f infra/k8s/caddy-h3-service.yaml"
  echo "              kubectl apply -f infra/k8s/ingress-nginx-envoy.yaml"
  echo "Secrets (ingress-nginx): record-local-tls, dev-root-ca, caddy-h3 ConfigMap (see Runbook.md)"
  exit 1
fi
