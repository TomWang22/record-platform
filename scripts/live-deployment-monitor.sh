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
CYAN='\033[0;36m'
NC='\033[0m'

INTERVAL=${1:-10}  # Default 10 seconds

echo "=== LIVE DEPLOYMENT MONITOR (gRPC + HTTP/3 Health Checks) ==="
echo "Updates every ${INTERVAL}s (Ctrl+C to stop)"
echo ""

# Check if grpcurl is available
if ! command -v grpcurl &> /dev/null; then
  echo -e "${YELLOW}⚠️  grpcurl not found - gRPC health checks will be skipped${NC}"
  echo "   Install: brew install grpcurl"
  echo ""
fi

# Check if curl supports HTTP/3
CURL_H3_SUPPORT=false
if curl --version 2>/dev/null | grep -q "HTTP/3"; then
  CURL_H3_SUPPORT=true
else
  echo -e "${YELLOW}⚠️  curl doesn't support HTTP/3 - HTTP/3 checks will use HTTP/2 fallback${NC}"
  echo ""
fi

while true; do
  clear
  TIMESTAMP=$(date '+%H:%M:%S')
  echo -e "${CYAN}=== DEPLOYMENT STATUS @ $TIMESTAMP ===${NC}"
  echo ""
  
  # Infrastructure
  echo -e "${BLUE}🌐 Infrastructure:${NC}"
  CADDY=$(kubectl get pods -n ingress-nginx -l app=caddy-h3 --request-timeout=5s --no-headers 2>/dev/null | awk '$2 ~ /^[1-9]\//' | wc -l | tr -d ' ' || echo "0")
  ENVOY=$(kubectl get pods -n envoy-test -l app=envoy-test --request-timeout=5s --no-headers 2>/dev/null | awk '$2 ~ /^[1-9]\//' | wc -l | tr -d ' ' || echo "0")
  echo "  Caddy: $CADDY/2 $(if [ "$CADDY" -eq 2 ]; then echo -e "${GREEN}✅${NC}"; else echo -e "${YELLOW}⏳${NC}"; fi)"
  echo "  Envoy: $ENVOY/1 $(if [ "$ENVOY" -eq 1 ]; then echo -e "${GREEN}✅${NC}"; else echo -e "${YELLOW}⏳${NC}"; fi)"
  echo ""
  
  # Services - Pod Status
  echo -e "${BLUE}🚀 Services (Pod Status):${NC}"
  SERVICES="api-gateway auth-service records-service listings-service social-service shopping-service analytics-service auction-monitor python-ai-service"
  READY_COUNT=0
  TOTAL_COUNT=0
  for svc in $SERVICES; do
    READY=$(kubectl get pods -n record-platform -l app=$svc --request-timeout=5s --no-headers 2>/dev/null | awk '$2 ~ /^[1-9]\//' | wc -l | tr -d ' \n' || echo "0")
    TOTAL=$(kubectl get pods -n record-platform -l app=$svc --request-timeout=5s --no-headers 2>/dev/null | wc -l | tr -d ' \n' || echo "0")
    # Ensure values are numeric (default to 0 if empty or non-numeric)
    READY=${READY:-0}
    TOTAL=${TOTAL:-0}
    READY_COUNT=$((READY_COUNT + READY))
    TOTAL_COUNT=$((TOTAL_COUNT + TOTAL))
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
  
  # gRPC Health Checks (using Kubernetes probes status)
  echo -e "${BLUE}🔌 gRPC Health Checks (via Kubernetes probes):${NC}"
  for svc in $SERVICES; do
    POD=$(kubectl get pods -n record-platform -l app=$svc --request-timeout=5s --no-headers 2>/dev/null | awk '$2 ~ /^[1-9]\// {print $1; exit}' || echo "")
    if [ -n "$POD" ]; then
      # Check if startup probe passed
      STARTUP_STATUS=$(kubectl get pod $POD -n record-platform --request-timeout=5s -o jsonpath='{.status.containerStatuses[0].started}' 2>/dev/null || echo "false")
      # Check if readiness probe passed
      READY_STATUS=$(kubectl get pod $POD -n record-platform --request-timeout=5s -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
      if [ "$STARTUP_STATUS" = "true" ] && [ "$READY_STATUS" = "true" ]; then
        echo -e "  ${GREEN}✅${NC} $svc: gRPC health probe passing"
      else
        # Check last probe state
        LAST_PROBE=$(kubectl get pod $POD -n record-platform --request-timeout=5s -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}' 2>/dev/null || echo "")
        if [ -n "$LAST_PROBE" ]; then
          echo -e "  ${YELLOW}⏳${NC} $svc: gRPC probe starting ($LAST_PROBE)"
        else
          echo -e "  ${YELLOW}⏳${NC} $svc: gRPC probe waiting"
        fi
      fi
    else
      echo -e "  ${YELLOW}⏸️${NC}  $svc: No ready pod found"
    fi
  done
  echo ""
  
  # HTTP/3 Health Checks (via Caddy)
  echo -e "${BLUE}🌐 HTTP/3 Health Checks (via Caddy):${NC}"
  # Test Caddy health endpoint
  if [ "$CURL_H3_SUPPORT" = "true" ]; then
    CADDY_H3_HEALTH=$(curl --http3 -k -s -o /dev/null -w "%{http_code}" --max-time 2 --resolve record.local:30443:127.0.0.1 https://record.local:30443/_caddy/healthz 2>/dev/null || echo "000")
    if [ "$CADDY_H3_HEALTH" = "200" ]; then
      echo -e "  ${GREEN}✅${NC} Caddy HTTP/3 health: OK (200)"
    else
      echo -e "  ${YELLOW}⏳${NC} Caddy HTTP/3 health: $CADDY_H3_HEALTH"
    fi
  else
    # Fallback to HTTP/2
    CADDY_H2_HEALTH=$(curl --http2 -k -s -o /dev/null -w "%{http_code}" --max-time 2 --resolve record.local:30443:127.0.0.1 https://record.local:30443/_caddy/healthz 2>/dev/null || echo "000")
    if [ "$CADDY_H2_HEALTH" = "200" ]; then
      echo -e "  ${GREEN}✅${NC} Caddy HTTP/2 health: OK (200)"
    else
      echo -e "  ${YELLOW}⏳${NC} Caddy HTTP/2 health: $CADDY_H2_HEALTH"
    fi
  fi
  
  # Test service health via API Gateway (HTTP/2 or HTTP/3)
  API_GATEWAY_POD=$(kubectl get pods -n record-platform -l app=api-gateway --request-timeout=5s --no-headers 2>/dev/null | awk '$2 ~ /^[1-9]\// {print $1; exit}' || echo "")
  if [ -n "$API_GATEWAY_POD" ]; then
    # Port-forward API Gateway health check
    GATEWAY_HEALTH=$(kubectl exec -n record-platform $API_GATEWAY_POD --request-timeout=3s -- wget -qO- --timeout=2 http://localhost:4000/healthz 2>/dev/null | grep -q "ok\|healthy" && echo "200" || echo "000" || echo "000")
    if [ "$GATEWAY_HEALTH" = "200" ]; then
      echo -e "  ${GREEN}✅${NC} API Gateway health: OK (HTTP)"
    else
      echo -e "  ${YELLOW}⏳${NC} API Gateway health: Not responding"
    fi
  fi
  echo ""
  
  # Database Connection Status
  echo -e "${BLUE}💾 Database Status:${NC}"
  POSTGRES_COUNT=$(docker ps --filter "name=postgres" --format "{{.Names}}" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  if [ "$POSTGRES_COUNT" -ge 8 ]; then
    echo -e "  ${GREEN}✅${NC} Postgres containers: $POSTGRES_COUNT/8 running"
  else
    echo -e "  ${YELLOW}⚠️${NC}  Postgres containers: $POSTGRES_COUNT/8 running"
  fi
  echo ""
  
  # Recent Errors
  echo -e "${BLUE}🔍 Recent Activity (last 60s):${NC}"
  ERRORS=$(kubectl get pods -n record-platform --request-timeout=5s --no-headers 2>/dev/null | awk '$3 ~ /(Error|CrashLoopBackOff)/' | wc -l | tr -d ' ' || echo "0")
  if [ "$ERRORS" -gt 0 ]; then
    echo -e "  ${RED}⚠️${NC}  $ERRORS pods with errors:"
    kubectl get pods -n record-platform --request-timeout=5s --no-headers 2>/dev/null | awk '$3 ~ /(Error|CrashLoopBackOff)/ {print "    " $1 ": " $3}' | head -3
  else
    echo -e "  ${GREEN}✅${NC} No pod errors detected"
  fi
  echo ""
  
  # Summary
  echo -e "${BLUE}📊 Overall Progress:${NC} $READY_COUNT/$TOTAL_COUNT service pods Ready"
  echo ""
  echo "Next update in ${INTERVAL}s... (Ctrl+C to stop)"
  
  sleep "$INTERVAL"
done
