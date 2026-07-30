#!/bin/bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
docker context use colima >/dev/null 2>&1
export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

while true; do
  clear
  echo "=== LIVE MONITORING (Ctrl+C to stop) ==="
  echo "Last update: $(date '+%H:%M:%S')"
  echo ""
  
  # Colima resources
  echo -e "${BLUE}📦 Colima Resources:${NC}"
  echo "  • CPUs: 12 | Memory: 12GB | Disk: 256GB"
  echo ""
  
  # Build status
  echo -e "${BLUE}🔨 Build Status:${NC}"
  BUILT=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep ":dev$" | wc -l | tr -d ' ')
  echo "  Built images: ${BUILT}/10"
  if [ -f /tmp/build-output.log ]; then
    CURRENT_BUILD=$(tail -5 /tmp/build-output.log 2>/dev/null | grep -E "(Building|→)" | tail -1 | sed 's/^/    /' || echo "    (idle)")
    echo "  $CURRENT_BUILD"
  fi
  BUILD_PID=$(ps aux | grep '[b]uild-and-load' | awk '{print $2}' || echo "")
  if [ -n "$BUILD_PID" ]; then
    echo -e "  ${GREEN}✅ Build process running (PID: $BUILD_PID)${NC}"
  else
    echo -e "  ${YELLOW}⏸️  No build process running${NC}"
  fi
  echo ""
  
  # Infrastructure pods
  echo -e "${BLUE}🌐 Infrastructure:${NC}"
  CADDY=$(kubectl get pods -n ingress-nginx -l app=caddy-h3 --request-timeout=3s --no-headers 2>/dev/null | awk '{print $2}' | grep -c "1/1" || echo "0")
  ENVOY=$(kubectl get pods -n envoy-test -l app=envoy-test --request-timeout=3s --no-headers 2>/dev/null | awk '{print $2}' | grep -c "1/1" || echo "0")
  METRICS=$(kubectl get pods -n kube-system -l k8s-app=metrics-server --request-timeout=3s --no-headers 2>/dev/null | awk '{print $2}' | grep -c "1/1" || echo "0")
  
  if [ "$CADDY" -eq 2 ]; then
    echo -e "  ${GREEN}✅ Caddy: 2/2${NC}"
  else
    echo -e "  ${YELLOW}⏳ Caddy: $CADDY/2${NC}"
  fi
  
  if [ "$ENVOY" -eq 1 ]; then
    echo -e "  ${GREEN}✅ Envoy: 1/1${NC}"
  else
    echo -e "  ${YELLOW}⏳ Envoy: $ENVOY/1${NC}"
  fi
  
  if [ "$METRICS" -eq 1 ]; then
    echo -e "  ${GREEN}✅ Metrics Server: 1/1${NC}"
  else
    echo -e "  ${YELLOW}⏳ Metrics Server: $METRICS/1${NC}"
  fi
  echo ""
  
  # Service pods
  echo -e "${BLUE}🚀 Services (target: 1/1 each):${NC}"
  SERVICES="auth-service records-service listings-service messaging-service shopping-service analytics-service auction-monitor python-ai-service api-gateway"
  for svc in $SERVICES; do
    READY=$(kubectl get pods -n record-platform -l app=$svc --request-timeout=3s --no-headers 2>/dev/null | awk '{print $2}' | grep -c "1/1" || echo "0")
    TOTAL=$(kubectl get pods -n record-platform -l app=$svc --request-timeout=3s --no-headers 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    if [ "$TOTAL" -eq 0 ]; then
      echo -e "  ${YELLOW}⏸️  $svc: Not deployed${NC}"
    elif [ "$READY" -eq 1 ]; then
      echo -e "  ${GREEN}✅ $svc: 1/1${NC}"
    else
      STATUS=$(kubectl get pods -n record-platform -l app=$svc --request-timeout=3s --no-headers 2>/dev/null | awk '{print $3}' | head -1 || echo "Pending")
      echo -e "  ${YELLOW}⏳ $svc: $READY/1 ($STATUS)${NC}"
    fi
  done
  echo ""
  
  # External services
  echo -e "${BLUE}📊 External Services:${NC}"
  REDIS=$(docker ps --filter name=redis --format "{{.Names}}" 2>/dev/null | wc -l | tr -d ' ')
  KAFKA=$(docker ps --filter name=kafka --format "{{.Names}}" 2>/dev/null | wc -l | tr -d ' ')
  ZOOKEEPER=$(docker ps --filter name=zookeeper --format "{{.Names}}" 2>/dev/null | wc -l | tr -d ' ')
  
  if [ "$REDIS" -gt 0 ]; then
    echo -e "  ${GREEN}✅ Redis: Running${NC}"
  else
    echo -e "  ${RED}❌ Redis: Not running${NC}"
  fi
  
  if [ "$KAFKA" -gt 0 ]; then
    echo -e "  ${GREEN}✅ Kafka: Running${NC}"
  else
    echo -e "  ${RED}❌ Kafka: Not running${NC}"
  fi
  
  if [ "$ZOOKEEPER" -gt 0 ]; then
    echo -e "  ${GREEN}✅ Zookeeper: Running${NC}"
  else
    echo -e "  ${RED}❌ Zookeeper: Not running${NC}"
  fi
  
  echo ""
  echo "Refreshing in 5 seconds... (Ctrl+C to stop)"
  sleep 5
done
