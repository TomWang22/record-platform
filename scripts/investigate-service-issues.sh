#!/usr/bin/env bash
set -euo pipefail

# Comprehensive investigation script for API Gateway, Python AI, and Analytics services
# Usage: ./scripts/investigate-service-issues.sh

NS="${NS:-record-platform}"
API_GATEWAY="api-gateway"
PYTHON_AI="python-ai-service"
ANALYTICS="analytics-service"

echo "🔍 Investigating Service Issues"
echo "=============================="
echo ""

# Function to check pod status
check_pod_status() {
  local service=$1
  echo "📋 Checking $service Pod Status..."
  echo "-----------------------------------"
  
  PODS=$(kubectl -n "$NS" get pods -l app="$service" -o wide 2>&1)
  if echo "$PODS" | grep -q "No resources found"; then
    echo "❌ No pods found for $service"
    return 1
  fi
  
  echo "$PODS"
  echo ""
  
  # Check for crashloopbackoff
  if echo "$PODS" | grep -q "CrashLoopBackOff"; then
    echo "⚠️  CRITICAL: $service has pods in CrashLoopBackOff state!"
    CRASH_PODS=$(echo "$PODS" | grep "CrashLoopBackOff" | awk '{print $1}')
    for pod in $CRASH_PODS; do
      echo "   Investigating pod: $pod"
      echo "   Recent events:"
      kubectl -n "$NS" describe pod "$pod" 2>&1 | grep -A 10 "Events:" | tail -10
      echo ""
    done
  fi
  
  # Check for other error states
  if echo "$PODS" | grep -qE "(Error|Pending|ImagePullBackOff|ErrImagePull)"; then
    echo "⚠️  WARNING: $service has pods in error states"
    ERROR_PODS=$(echo "$PODS" | grep -E "(Error|Pending|ImagePullBackOff|ErrImagePull)" | awk '{print $1}')
    for pod in $ERROR_PODS; do
      echo "   Pod: $pod"
      kubectl -n "$NS" describe pod "$pod" 2>&1 | grep -A 5 "State:" | head -10
    done
    echo ""
  fi
  
  # Check restart counts
  RESTARTS=$(echo "$PODS" | awk 'NR>1 {sum+=$4} END {print sum+0}')
  if [ "$RESTARTS" -gt 10 ]; then
    echo "⚠️  WARNING: $service has high restart count: $RESTARTS"
    echo "$PODS" | awk 'NR>1 && $4>0 {print "   Pod " $1 ": " $4 " restarts"}'
    echo ""
  fi
  
  return 0
}

# Function to check service logs for errors
check_service_logs() {
  local service=$1
  local lines=${2:-50}
  
  echo "📜 Checking $service Logs (last $lines lines)..."
  echo "-----------------------------------"
  
  PODS=$(kubectl -n "$NS" get pods -l app="$service" -o jsonpath='{.items[*].metadata.name}' 2>&1)
  if [ -z "$PODS" ]; then
    echo "❌ No pods found for $service"
    return 1
  fi
  
  for pod in $PODS; do
    echo ""
    echo "Pod: $pod"
    echo "---"
    kubectl -n "$NS" logs "$pod" --tail="$lines" --since=10m 2>&1 | grep -iE "(error|warn|fail|timeout|refused|crash|panic|exception)" | head -20 || echo "   No recent errors/warnings found"
  done
  echo ""
}

# Function to check resource usage
check_resources() {
  local service=$1
  
  echo "💻 Checking $service Resource Usage..."
  echo "-----------------------------------"
  
  kubectl -n "$NS" top pods -l app="$service" 2>&1 || echo "   Metrics not available (metrics-server may not be installed)"
  echo ""
}

# Function to check health endpoints
check_health() {
  local service=$1
  local port=$2
  local path=${3:-/healthz}
  
  echo "🏥 Checking $service Health Endpoint..."
  echo "-----------------------------------"
  
  PODS=$(kubectl -n "$NS" get pods -l app="$service" -o jsonpath='{.items[0].metadata.name}' 2>&1)
  if [ -z "$PODS" ] || [ "$PODS" = "" ]; then
    echo "❌ No pods found for $service"
    return 1
  fi
  
  POD=$(echo "$PODS" | awk '{print $1}')
  echo "Testing pod: $POD"
  
  # Try to curl the health endpoint
  RESPONSE=$(kubectl -n "$NS" exec "$POD" -- curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port$path" 2>&1 || echo "ERROR")
  
  if [ "$RESPONSE" = "200" ] || [ "$RESPONSE" = "200" ]; then
    echo "✅ Health check passed (HTTP $RESPONSE)"
  elif [ "$RESPONSE" = "ERROR" ]; then
    echo "❌ Health check failed: Could not connect"
    echo "   Attempting to check if service is running..."
    kubectl -n "$NS" exec "$POD" -- ps aux | grep -E "(python|node|java|gunicorn)" | head -5 || echo "   No process found"
  else
    echo "⚠️  Health check returned: HTTP $RESPONSE"
  fi
  echo ""
}

# Function to check database connections
check_db_connections() {
  local service=$1
  
  echo "🗄️  Checking $service Database Connections..."
  echo "-----------------------------------"
  
  PODS=$(kubectl -n "$NS" get pods -l app="$service" -o jsonpath='{.items[0].metadata.name}' 2>&1)
  if [ -z "$PODS" ] || [ "$PODS" = "" ]; then
    echo "❌ No pods found for $service"
    return 1
  fi
  
  POD=$(echo "$PODS" | awk '{print $1}')
  
  # Check for connection errors in logs
  echo "Checking for DB connection errors in logs..."
  kubectl -n "$NS" logs "$POD" --tail=100 --since=10m 2>&1 | grep -iE "(connection.*refused|connection.*timeout|database.*error|pool.*exhausted|too many connections)" | head -10 || echo "   No DB connection errors found"
  echo ""
}

# Function to check service endpoints
check_service_endpoints() {
  local service=$1
  
  echo "🔗 Checking $service Service Endpoints..."
  echo "-----------------------------------"
  
  ENDPOINTS=$(kubectl -n "$NS" get endpoints "$service" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>&1 || echo "")
  
  if [ -z "$ENDPOINTS" ] || [ "$ENDPOINTS" = "" ]; then
    echo "❌ No endpoints found for $service service"
    echo "   This means no pods are ready to receive traffic"
  else
    echo "✅ Service has endpoints: $ENDPOINTS"
  fi
  echo ""
}

# Main investigation
echo "1. API GATEWAY INVESTIGATION"
echo "============================"
check_pod_status "$API_GATEWAY"
check_service_endpoints "$API_GATEWAY"
check_resources "$API_GATEWAY"
check_health "$API_GATEWAY" "4000" "/healthz"
check_service_logs "$API_GATEWAY" 100

echo ""
echo "2. PYTHON AI SERVICE INVESTIGATION"
echo "=================================="
check_pod_status "$PYTHON_AI"
check_service_endpoints "$PYTHON_AI"
check_resources "$PYTHON_AI"
check_health "$PYTHON_AI" "5005" "/healthz"
check_db_connections "$PYTHON_AI"
check_service_logs "$PYTHON_AI" 100

echo ""
echo "3. ANALYTICS SERVICE INVESTIGATION"
echo "================================="
check_pod_status "$ANALYTICS"
check_service_endpoints "$ANALYTICS"
check_resources "$ANALYTICS"
check_health "$ANALYTICS" "4004" "/healthz"
check_db_connections "$ANALYTICS"
check_service_logs "$ANALYTICS" 100

echo ""
echo "4. NETWORK CONNECTIVITY CHECK"
echo "============================"
echo "Testing connectivity between services..."
echo ""

# Test Python AI -> Analytics
PYTHON_AI_POD=$(kubectl -n "$NS" get pods -l app="$PYTHON_AI" -o jsonpath='{.items[0].metadata.name}' 2>&1 || echo "")
if [ -n "$PYTHON_AI_POD" ] && [ "$PYTHON_AI_POD" != "" ]; then
  echo "Testing Python AI -> Analytics connectivity..."
  kubectl -n "$NS" exec "$PYTHON_AI_POD" -- curl -s -o /dev/null -w "HTTP %{http_code} (time: %{time_total}s)\n" "http://$ANALYTICS:4004/healthz" --max-time 5 2>&1 || echo "❌ Connection failed"
  echo ""
fi

# Test API Gateway -> Python AI
API_GATEWAY_POD=$(kubectl -n "$NS" get pods -l app="$API_GATEWAY" -o jsonpath='{.items[0].metadata.name}' 2>&1 || echo "")
if [ -n "$API_GATEWAY_POD" ] && [ "$API_GATEWAY_POD" != "" ]; then
  echo "Testing API Gateway -> Python AI connectivity..."
  kubectl -n "$NS" exec "$API_GATEWAY_POD" -- curl -s -o /dev/null -w "HTTP %{http_code} (time: %{time_total}s)\n" "http://$PYTHON_AI:5005/healthz" --max-time 5 2>&1 || echo "❌ Connection failed"
  echo ""
fi

echo ""
echo "5. RECENT EVENTS SUMMARY"
echo "======================="
echo "Checking recent Kubernetes events for all services..."
kubectl -n "$NS" get events --field-selector involvedObject.kind=Pod --sort-by='.lastTimestamp' 2>&1 | grep -E "($API_GATEWAY|$PYTHON_AI|$ANALYTICS)" | tail -20 || echo "No recent events found"
echo ""

echo "✅ Investigation Complete"
echo "========================="
echo ""
echo "💡 Next Steps:"
echo "  1. Review pod statuses above for CrashLoopBackOff or Error states"
echo "  2. Check logs for specific error patterns"
echo "  3. Verify resource limits are not being exceeded"
echo "  4. Check database connection pools if connection errors are present"
echo "  5. Review service endpoints to ensure pods are ready"

