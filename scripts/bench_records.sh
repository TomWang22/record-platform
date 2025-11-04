#!/usr/bin/env bash
set -euo pipefail

# ---------------- config ----------------
NS=${NS:-record-platform}
APP=${APP:-records-service}
FORTIO_IMAGE=${FORTIO_IMAGE:-fortio/fortio:latest}
FORTIO_LABEL=run=fortio
DURATION=${DURATION:-20s}
QPS=${QPS:-200}           # target qps
CONC=${CONC:-16}          # number of connections/threads
USER_ID=${USER_ID:-'4ad36240-c1ad-4638-ab1b-4c8cfb04a553'}

# endpoints to test
declare -a URLS=(
  "http://$APP:4002/records/search?q=teresa"
  "http://$APP:4002/records/search/autocomplete?field=artist&q=te&k=10"
  "http://$APP:4002/records/search/price-stats?q=teresa"
)

hdr=(-H "x-user-id: $USER_ID")

# --------------- helpers ----------------
wait_for_pod() {
  local sel="$1"
  kubectl -n "$NS" wait pod -l "$sel" --for=condition=Ready --timeout=120s >/dev/null
}

run_fortio() {
  local url="$1"
  local name="fortio-$(date +%s%N)"
  echo "→ Fortio: $url"

  kubectl -n "$NS" run "$name" --image="$FORTIO_IMAGE" --restart=Never -- \
    fortio load -quiet -labels "$APP" \
      -allow-initial-errors \
      -qps "$QPS" -c "$CONC" -t "$DURATION" \
      -H "x-user-id: $USER_ID" "$url" >/dev/null 2>&1 || true

  # Wait for the pod to exist (Created) then for it to complete (it exits after load)
  kubectl -n "$NS" wait --for=condition=Ready "pod/$name" --timeout=120s 2>/dev/null || true
  kubectl -n "$NS" wait --for=condition=ContainersReady "pod/$name" --timeout=120s 2>/dev/null || true

  # Print the summary lines (includes p50/p75/p90/p99/p99.9 and max)
  kubectl -n "$NS" logs "pod/$name" 2>/dev/null | tee "/tmp/${name}.log" | sed -n '/All done/,$p' || true
  echo -n "   summary: "
  awk '/^# target/ || /^All done/ || /^Sockets/ || /Summary:/ {print}' "/tmp/${name}.log" | tail -n 3

  kubectl -n "$NS" delete pod "$name" --ignore-not-found >/dev/null 2>&1 || true
}

toggle_app_cache() {
  local onoff="$1"   # "on" or "off"
  if [ "$onoff" = "off" ]; then
    echo "==> Disabling Redis in app (REDIS_DISABLE=1)…"
    kubectl -n "$NS" set env deploy/$APP REDIS_DISABLE=1 >/dev/null
  else
    echo "==> Enabling Redis in app (unset REDIS_DISABLE)…"
    kubectl -n "$NS" set env deploy/$APP REDIS_DISABLE- >/dev/null
  fi
  kubectl -n "$NS" rollout status deploy/$APP --timeout=120s >/dev/null
}

flush_redis() {
  echo "==> Flushing Redis…"
  kubectl -n "$NS" exec -i deploy/redis -- redis-cli FLUSHALL >/dev/null
}

# --------------- preflight --------------
echo "==> Preflight"
# ensure prepull DS exists and ready
kubectl -n "$NS" rollout status ds/prepull-fortio --timeout=180s || true

# curl sanity checks (won't fail the run)
for url in "${URLS[@]}"; do
  kubectl -n "$NS" run curl-$$-$RANDOM --rm -i --restart=Never --image=alpine:3.20 -- \
    sh -lc "apk add -q curl >/dev/null; curl -sS ${hdr[*]} \"$url\" >/dev/null" || true
done

# --------------- PHASE A: Redis OFF ---------------
echo
echo "==================== PHASE A: Redis OFF (app cache disabled) ===================="
toggle_app_cache off
echo "==> Warmup (one pass)"
for url in "${URLS[@]}"; do
  kubectl -n "$NS" run curl-$$-$RANDOM --rm -i --restart=Never --image=alpine:3.20 -- \
    sh -lc "apk add -q curl >/dev/null; curl -sS ${hdr[*]} \"$url\" >/dev/null" || true
done

for url in "${URLS[@]}"; do run_fortio "$url"; done

# --------------- PHASE B: Redis ON (cold -> warm) ---------------
echo
echo "==================== PHASE B: Redis ON (cold then warm) ===================="
toggle_app_cache on
flush_redis

echo "==> Cold cache run (immediately after flush)"
for url in "${URLS[@]}"; do run_fortio "$url"; done

echo "==> Warm cache run (repeat same)"
for url in "${URLS[@]}"; do run_fortio "$url"; done

echo
echo "Done. Fortio prints p50/p75/p90/p99/p99.9 and max (p100)."
