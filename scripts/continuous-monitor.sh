#!/bin/bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
docker context use colima >/dev/null 2>&1
export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

INTERVAL=${1:-10}  # Default 10 seconds, can override with first arg

echo "=== CONTINUOUS MONITORING (every ${INTERVAL}s, Ctrl+C to stop) ==="
echo ""

while true; do
  clear
  TIMESTAMP=$(date '+%H:%M:%S')
  echo "=== STATUS @ $TIMESTAMP ==="
  echo ""
  
  # Infrastructure
  echo -e "${BLUE}🌐 Infrastructure:${NC}"
  CADDY=$(kubectl get pods -n ingress-nginx -l app=caddy-h3 --request-timeout=5s --no-headers 2>/dev/null | awk '$2 ~ /^1\//' | wc -l | tr -d ' ' || echo "0")
  ENVOY=$(kubectl get pods -n envoy-test -l app=envoy-test --request-timeout=5s --no-headers 2>/dev/null | awk '$2 ~ /^1\//' | wc -l | tr -d ' ' || echo "0")
  echo "  Caddy: $CADDY/2 $(if [ "$CADDY" -eq 2 ]; then echo -e "${GREEN}✅${NC}"; else echo -e "${YELLOW}⏳${NC}"; fi)"
  echo "  Envoy: $ENVOY/1 $(if [ "$ENVOY" -eq 1 ]; then echo -e "${GREEN}✅${NC}"; else echo -e "${YELLOW}⏳${NC}"; fi)"
  echo ""
  
  # Services
  echo -e "${BLUE}🚀 Services (target: 1/1 each):${NC}"
  SERVICES="api-gateway auth-service records-service listings-service social-service shopping-service analytics-service auction-monitor python-ai-service"
  for svc in $SERVICES; do
    READY=$(kubectl get pods -n record-platform -l app=$svc --request-timeout=5s --no-headers 2>/dev/null | awk '$2 ~ /^[1-9]\//' | wc -l | tr -d ' ' || echo "0")
    TOTAL=$(kubectl get pods -n record-platform -l app=$svc --request-timeout=5s --no-headers 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    if [ "$TOTAL" -eq 0 ]; then
      echo -e "  ⏸️  $svc: Not deployed"
    elif [ "$READY" -gt 0 ]; then
      echo -e "  ${GREEN}✅${NC} $svc: $READY/$TOTAL Ready"
    else
      STATUS=$(kubectl get pods -n record-platform -l app=$svc --request-timeout=5s --no-headers 2>/dev/null | awk '{print $3}' | head -1 || echo "Pending")
      echo -e "  ${YELLOW}⏳${NC} $svc: $READY/$TOTAL ($STATUS)"
    fi
  done
  echo ""
  
  # Redis status
  echo -e "${BLUE}📊 Redis Connection:${NC}"
  REDIS_ENDPOINT=$(kubectl get endpoints redis-external -n record-platform --request-timeout=5s -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null || echo "unknown")
  REDIS_ACTUAL=$(docker inspect record-platform-redis-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || echo "unknown")
  if [ "$REDIS_ENDPOINT" = "$REDIS_ACTUAL" ] && [ "$REDIS_ENDPOINT" != "unknown" ]; then
    echo -e "  ${GREEN}✅${NC} Endpoint matches Redis IP: $REDIS_ENDPOINT"
  else
    echo -e "  ${YELLOW}⚠️${NC}  Endpoint: $REDIS_ENDPOINT, Actual: $REDIS_ACTUAL"
  fi
  REDIS_RUNNING=$(docker ps --filter name=redis --format "{{.Names}}" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  if [ "$REDIS_RUNNING" -gt 0 ]; then
    echo -e "  ${GREEN}✅${NC} External Redis: Running"
  else
    echo -e "  ${RED}❌${NC} External Redis: Not running"
  fi
  echo ""
  
  # Recent errors
  echo -e "${BLUE}🔍 Recent Activity (last 60s):${NC}"
  ERRORS=$(kubectl get pods -n record-platform --request-timeout=5s --no-headers 2>/dev/null | awk '$3 ~ /(Error|CrashLoopBackOff)/' | wc -l | tr -d ' ' || echo "0")
  if [ "$ERRORS" -gt 0 ]; then
    echo -e "  ${RED}⚠️${NC}  $ERRORS pods with errors:"
    kubectl get pods -n record-platform --request-timeout=5s --no-headers 2>/dev/null | awk '$3 ~ /(Error|CrashLoopBackOff)/ {print "    " $1 ": " $3}' | head -3
  else
    echo -e "  ${GREEN}✅${NC} No pod errors detected"
  fi
  echo ""
  
  # Redis connection errors in logs
  REDIS_ERR=$(kubectl logs -n record-platform -l 'app in (auth-service,records-service)' --request-timeout=5s --tail=50 --since=2m 2>/dev/null | grep -i "ECONNREFUSED.*6379" | wc -l | head -1 | tr -d ' \n' || echo "0")
  if [ "$REDIS_ERR" -gt 0 ] 2>/dev/null; then
    echo -e "  ${YELLOW}⚠️${NC}  $REDIS_ERR Redis connection errors in logs (last 2m)"
  else
    echo -e "  ${GREEN}✅${NC} No Redis connection errors in recent logs"
  fi
  echo ""
  
  # Summary
  READY_COUNT=$(kubectl get pods -n record-platform -l 'app in (api-gateway,auth-service,records-service,listings-service,social-service,shopping-service,analytics-service,auction-monitor,python-ai-service)' --request-timeout=5s --field-selector=status.phase=Running --no-headers 2>/dev/null | awk '$2 ~ /^[1-9]\//' | wc -l | tr -d ' ' || echo "0")
  TOTAL_COUNT=$(kubectl get pods -n record-platform -l 'app in (api-gateway,auth-service,records-service,listings-service,social-service,shopping-service,analytics-service,auction-monitor,python-ai-service)' --request-timeout=5s --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  echo -e "${BLUE}📊 Overall Progress:${NC} $READY_COUNT/$TOTAL_COUNT service pods Ready"
  echo ""
  echo "Next update in ${INTERVAL}s... (Ctrl+C to stop)"
  
  sleep "$INTERVAL"
done
