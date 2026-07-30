#!/usr/bin/env bash
# Live monitoring script for Colima k3s - fixed for terminal display
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
kubectl config use-context colima >/dev/null 2>&1 || true

clear
while true; do
  echo "=== DEPLOYMENT STATUS @ $(date +%H:%M:%S) ==="
  echo ""
  
  # Infrastructure
  echo "🌐 Infrastructure:"
  CADDY_READY=$(kubectl get pods -n ingress-nginx -l app=caddy-h3 --no-headers 2>/dev/null | awk '{ready+=$2; total++} END {if(total>0) printf "  %d/%d", ready, total; else print "  (checking...)"}' || echo "  (checking...)")
  ENVOY_READY=$(kubectl get pods -n envoy-test -l app=envoy-test --no-headers 2>/dev/null | awk '{ready+=$2; total++} END {if(total>0) printf "  %d/%d", ready, total; else print "  (checking...)"}' || echo "  (checking...)")
  
  if echo "$CADDY_READY" | grep -q "2/2"; then
    echo "  Caddy: $CADDY_READY ✅"
  else
    echo "  Caddy: $CADDY_READY ⏳"
  fi
  
  if echo "$ENVOY_READY" | grep -q "1/1"; then
    echo "  Envoy: $ENVOY_READY ✅"
  else
    echo "  Envoy: $ENVOY_READY ⏳"
  fi
  echo ""
  
  # Services
  echo "🚀 Services (target: 1/1 each):"
  SERVICES=("api-gateway" "auth-service" "records-service" "listings-service" "messaging-service" "shopping-service" "analytics-service" "auction-monitor" "python-ai-service")
  
  READY_COUNT=0
  TOTAL_COUNT=${#SERVICES[@]}
  
  for service in "${SERVICES[@]}"; do
    # Get ready count and total count properly
    READY=$(kubectl get pods -n record-platform -l app="$service" --no-headers 2>/dev/null | awk -F'/' '{print $1}' | awk '{s+=$1} END {print s+0}' || echo "0")
    TOTAL=$(kubectl get pods -n record-platform -l app="$service" --no-headers 2>/dev/null | wc -l | tr -d ' \n' || echo "0")
    
    if [[ "$TOTAL" == "0" ]]; then
      STATUS=$(kubectl get deployment "$service" -n record-platform -o jsonpath='{.status.conditions[?(@.type=="Available")].status}' 2>/dev/null || echo "Unknown")
      echo "  ⏳ $service: 0/0 ($STATUS)"
    elif [[ "$READY" == "$TOTAL" ]] && [[ "$TOTAL" == "1" ]]; then
      echo "  ✅ $service: $READY/$TOTAL Ready"
      READY_COUNT=$((READY_COUNT + 1))
    else
      STATUS=$(kubectl get pods -n record-platform -l app="$service" --no-headers 2>/dev/null | head -1 | awk '{print $3}' || echo "Unknown")
      echo "  ⏳ $service: $READY/$TOTAL ($STATUS)"
      if [[ "$READY" == "$TOTAL" ]] && [[ "$READY" -gt 0 ]]; then
        READY_COUNT=$((READY_COUNT + 1))
      fi
    fi
  done
  echo ""
  
  # Overall progress
  echo "📊 Overall Progress: $READY_COUNT/$TOTAL_COUNT service pods Ready"
  echo ""
  
  # Check for errors
  ERROR_PODS=$(kubectl get pods -n record-platform -l 'app in (auth-service,records-service,listings-service,messaging-service,shopping-service,analytics-service,auction-monitor,python-ai-service)' --field-selector=status.phase!=Running,status.phase!=Succeeded --no-headers 2>/dev/null | wc -l | tr -d ' \n' || echo "0")
  if [[ "$ERROR_PODS" -gt 0 ]]; then
    echo "⚠️  $ERROR_PODS pods with errors (not Running/Succeeded)"
    kubectl get pods -n record-platform -l 'app in (auth-service,records-service,listings-service,messaging-service,shopping-service,analytics-service,auction-monitor,python-ai-service)' --field-selector=status.phase!=Running,status.phase!=Succeeded --no-headers 2>/dev/null | head -3 | awk '{print "    " $1 ": " $3}'
    echo ""
  fi
  
  echo "Next update in 10s... (Ctrl+C to stop)"
  sleep 10
  clear
done
