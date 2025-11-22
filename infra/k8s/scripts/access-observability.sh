#!/usr/bin/env bash
set -euo pipefail

# Quick script to access observability tools
# This will set up port-forwards for Grafana, Prometheus, and Jaeger

bold() {
  echo -e "\033[1m$1\033[0m"
}

step() {
  echo
  bold ">>> $1"
}

# Function to check if port is in use
check_port() {
  lsof -i :$1 >/dev/null 2>&1
}

# Grafana
step "Setting up Grafana access..."
if check_port 3000; then
  echo "⚠️  Port 3000 is already in use. Skipping Grafana port-forward."
else
  kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80 > /dev/null 2>&1 &
  GRAFANA_PID=$!
  echo "✅ Grafana port-forward started (PID: $GRAFANA_PID)"
  echo "   URL: http://localhost:3000"
  echo "   Username: admin"
  echo "   Password: Admin123!"
fi

# Prometheus
step "Setting up Prometheus access..."
if check_port 9090; then
  echo "⚠️  Port 9090 is already in use. Skipping Prometheus port-forward."
else
  kubectl -n monitoring port-forward svc/monitoring-kube-prom-prometheus 9090:9090 > /dev/null 2>&1 &
  PROMETHEUS_PID=$!
  echo "✅ Prometheus port-forward started (PID: $PROMETHEUS_PID)"
  echo "   URL: http://localhost:9090"
fi

# Jaeger
step "Setting up Jaeger access..."
if check_port 16686; then
  echo "⚠️  Port 16686 is already in use. Skipping Jaeger port-forward."
else
  kubectl -n observability port-forward svc/jaeger 16686:16686 > /dev/null 2>&1 &
  JAEGER_PID=$!
  echo "✅ Jaeger port-forward started (PID: $JAEGER_PID)"
  echo "   URL: http://localhost:16686"
fi

echo
bold "✅ All observability tools are now accessible!"
echo
echo "Access URLs:"
echo "  Grafana:    http://localhost:3000 (admin/Admin123!)"
echo "  Prometheus: http://localhost:9090"
echo "  Jaeger:     http://localhost:16686"
echo
echo "To stop port-forwards, run:"
echo "  kill $GRAFANA_PID $PROMETHEUS_PID $JAEGER_PID 2>/dev/null || true"
echo
echo "Or manually:"
echo "  pkill -f 'port-forward.*monitoring-grafana'"
echo "  pkill -f 'port-forward.*prometheus'"
echo "  pkill -f 'port-forward.*jaeger'"

# Wait for user input to keep script running
echo
read -p "Press Enter to stop all port-forwards and exit..."

# Cleanup
kill $GRAFANA_PID $PROMETHEUS_PID $JAEGER_PID 2>/dev/null || true
pkill -f 'port-forward.*monitoring-grafana' 2>/dev/null || true
pkill -f 'port-forward.*prometheus' 2>/dev/null || true
pkill -f 'port-forward.*jaeger' 2>/dev/null || true

echo "✅ Port-forwards stopped."

