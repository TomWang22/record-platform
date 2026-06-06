#!/bin/bash
# k6 incremental load test with automatic tcpdump packet capture
# Captures packets automatically if errors occur during the test

set -e

KUBECONFIG=${KUBECONFIG:-$HOME/.kube/kind-h3.yaml}
NAMESPACE=${NAMESPACE:-record-platform}
OUTPUT_DIR=${OUTPUT_DIR:-test-results/k6-incremental-load-$(date +%Y%m%d-%H%M%S)}
TCPDUMP_DURATION=${TCPDUMP_DURATION:-1800}  # 30 minutes default

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== k6 Incremental Load Test with Automatic Packet Capture ===${NC}"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
K6_LOG="$OUTPUT_DIR/k6-output.log"
CAPTURE_FILE="$OUTPUT_DIR/packets.pcap"
ERROR_LOG="$OUTPUT_DIR/errors.log"

echo "Output directory: $OUTPUT_DIR"
echo "k6 log: $K6_LOG"
echo "Packet capture: $CAPTURE_FILE"
echo ""

# Get API Gateway pod for packet capture
export KUBECONFIG
API_GW_POD=$(kubectl get pods -n "$NAMESPACE" -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
AUTH_SVC_IP=$(kubectl get svc auth-service -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")

if [ -z "$API_GW_POD" ]; then
  echo -e "${YELLOW}Warning: API Gateway pod not found, packet capture will be skipped${NC}"
  CAPTURE_ENABLED=false
else
  echo -e "${GREEN}Found API Gateway pod: $API_GW_POD${NC}"
  echo -e "${GREEN}Found auth-service IP: $AUTH_SVC_IP${NC}"
  CAPTURE_ENABLED=true
fi

# Check if tcpdump is available
if [ "$CAPTURE_ENABLED" = true ]; then
  echo "Checking if tcpdump is available in pod..."
  if ! kubectl exec -n "$NAMESPACE" "$API_GW_POD" -- sh -c 'which tcpdump > /dev/null 2>&1' 2>/dev/null; then
    echo -e "${YELLOW}Installing tcpdump...${NC}"
    kubectl exec -n "$NAMESPACE" "$API_GW_POD" -- sh -c 'apk add --no-cache tcpdump > /dev/null 2>&1' 2>/dev/null || \
    kubectl exec -n "$NAMESPACE" "$API_GW_POD" -- sh -c 'apt-get update && apt-get install -y tcpdump > /dev/null 2>&1' 2>/dev/null || {
      echo -e "${YELLOW}Warning: Could not install tcpdump, packet capture disabled${NC}"
      CAPTURE_ENABLED=false
    }
  fi
fi

# Start packet capture in background if enabled
if [ "$CAPTURE_ENABLED" = true ]; then
  echo -e "${GREEN}Starting packet capture (will run for test duration)...${NC}"
  kubectl exec -n "$NAMESPACE" "$API_GW_POD" -- sh -c \
    "timeout $TCPDUMP_DURATION tcpdump -i any -n -s 0 -w - 'host $AUTH_SVC_IP and (port 50051 or port 4001)'" \
    2>/dev/null > "$CAPTURE_FILE" &
  CAPTURE_PID=$!
  echo "Packet capture started (PID: $CAPTURE_PID)"
  echo ""
fi

# Run k6 test
echo -e "${GREEN}Starting k6 incremental load test...${NC}"
echo ""

# Run k6 and capture output
k6 run scripts/load/k6-auth-incremental-load.js 2>&1 | tee "$K6_LOG" &
K6_PID=$!

# Monitor for errors
ERROR_COUNT=0
while kill -0 $K6_PID 2>/dev/null; do
  sleep 5
  # Check for errors in recent output
  if tail -20 "$K6_LOG" 2>/dev/null | grep -i "error\|failed\|429\|500\|502\|503" > /dev/null; then
    ERROR_COUNT=$((ERROR_COUNT + 1))
    if [ $ERROR_COUNT -eq 1 ]; then
      echo -e "${YELLOW}Errors detected, continuing packet capture...${NC}"
      echo "$(date): Errors detected" >> "$ERROR_LOG"
    fi
  fi
done

# Wait for k6 to complete
wait $K6_PID
K6_EXIT_CODE=$?

# Stop packet capture
if [ "$CAPTURE_ENABLED" = true ] && kill -0 $CAPTURE_PID 2>/dev/null; then
  echo ""
  echo -e "${GREEN}Stopping packet capture...${NC}"
  kill $CAPTURE_PID 2>/dev/null || true
  wait $CAPTURE_PID 2>/dev/null || true
fi

# Analyze results
echo ""
echo -e "${GREEN}=== Test Complete ===${NC}"
echo ""

if [ $K6_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✅ k6 test completed successfully${NC}"
else
  echo -e "${RED}❌ k6 test exited with code $K6_EXIT_CODE${NC}"
fi

# Check capture file
if [ "$CAPTURE_ENABLED" = true ] && [ -f "$CAPTURE_FILE" ]; then
  FILE_SIZE=$(du -h "$CAPTURE_FILE" | cut -f1)
  echo "Packet capture: $CAPTURE_FILE ($FILE_SIZE)"
  
  # Quick analysis if tcpdump is available locally
  if command -v tcpdump > /dev/null 2>&1; then
    echo ""
    echo -e "${YELLOW}Quick packet analysis:${NC}"
    echo "TCP connections:"
    tcpdump -r "$CAPTURE_FILE" -n 'tcp' 2>/dev/null | wc -l | awk '{print "  " $1 " TCP packets"}'
    echo "gRPC traffic (port 50051):"
    tcpdump -r "$CAPTURE_FILE" -n 'port 50051' 2>/dev/null | wc -l | awk '{print "  " $1 " gRPC packets"}'
  fi
fi

# Extract error summary
if [ -f "$K6_LOG" ]; then
  echo ""
  echo -e "${YELLOW}Error Summary:${NC}"
  grep -i "error\|failed\|429\|500\|502\|503" "$K6_LOG" | tail -20 | head -10 || echo "  No errors found"
fi

echo ""
echo -e "${GREEN}Results saved to: $OUTPUT_DIR${NC}"
echo "  - k6 output: $K6_LOG"
if [ "$CAPTURE_ENABLED" = true ]; then
  echo "  - Packet capture: $CAPTURE_FILE"
fi
echo "  - Error log: $ERROR_LOG"
echo ""

exit $K6_EXIT_CODE

