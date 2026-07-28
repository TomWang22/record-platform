#!/usr/bin/env bash
# Wait until kafka-0..N-1-external each have status.loadBalancer.ingress[0].ip (MetalLB / cloud LB).
# Env: HOUSING_NS, KAFKA_BROKER_REPLICAS, KAFKA_LB_WAIT_MAX_ATTEMPTS (default 90), KAFKA_LB_WAIT_SLEEP (default 2)
set -euo pipefail

NS="${HOUSING_NS:-record-platform}"
REP="${KAFKA_BROKER_REPLICAS:-3}"
MAX="${KAFKA_LB_WAIT_MAX_ATTEMPTS:-90}"
SLEEP="${KAFKA_LB_WAIT_SLEEP:-2}"

echo "Waiting for kafka-0..$((REP - 1))-external LoadBalancer IPs in $NS (max ${MAX} attempts × ${SLEEP}s)..."
for ((i = 0; i < REP; i++)); do
  svc="kafka-${i}-external"
  found=""
  for ((a = 1; a <= MAX; a++)); do
    ip="$(kubectl get svc "$svc" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "$ip" ]] && [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "  ✅ $svc → $ip"
      found=1
      break
    fi
    hn="$(kubectl get svc "$svc" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "$hn" ]]; then
      echo "  ✅ $svc → $hn (hostname)"
      found=1
      break
    fi
    sleep "$SLEEP"
  done
  if [[ -z "$found" ]]; then
    echo "❌ Timed out waiting for EXTERNAL-IP on $svc" >&2
    kubectl get svc "$svc" -n "$NS" -o wide 2>/dev/null || true
    pin="$(kubectl get svc "$svc" -n "$NS" -o jsonpath="{.metadata.annotations['metallb.universe.tf/loadBalancerIPs']}" 2>/dev/null || true)"
    echo "--- RCA hints for $svc ---" >&2
    [[ -n "$pin" ]] && echo "  pin annotation: metallb.universe.tf/loadBalancerIPs=$pin" >&2
    kubectl describe svc "$svc" -n "$NS" 2>/dev/null | awk '/Events:/,0' | tail -20 >&2 || true
    if [[ -n "$pin" ]]; then
      echo "  other LoadBalancers using $pin (cluster-wide):" >&2
      _json="$(kubectl get svc -A -o json --request-timeout=30s 2>/dev/null || true)"
      if [[ -n "$_json" ]]; then
        printf '%s' "$_json" | WANT_IP="$pin" python3 -c "
import json, os, sys
want = os.environ['WANT_IP']
for item in json.load(sys.stdin).get('items') or []:
    md, spec = item.get('metadata') or {}, item.get('spec') or {}
    if spec.get('type') != 'LoadBalancer':
        continue
    ns, name = md.get('namespace', ''), md.get('name', '')
    anns = md.get('annotations') or {}
    pinned = anns.get('metallb.universe.tf/loadBalancerIPs') or ''
    ips = [x.get('ip') for x in ((item.get('status') or {}).get('loadBalancer') or {}).get('ingress') or [] if x.get('ip')]
    if want in [p.strip() for p in pinned.split(',') if p.strip()] or want in ips:
        print('    %s/%s status=%s pin=%s' % (ns, name, ips or ['<pending>'], pinned or '-'))
" >&2 || true
      fi
      echo "  Common cause: KAFKA_METALLB_FIRST_OFFSET=1 pins kafka-2 to pool+2 (.243) which collides with ollama-lb." >&2
      echo "  Fix: KAFKA_METALLB_FIRST_OFFSET=0 ./scripts/patch-kafka-external-metallb-pinned-ips.sh" >&2
    fi
    exit 1
  fi
done
echo "✅ All kafka-*-external services have LoadBalancer endpoints"
