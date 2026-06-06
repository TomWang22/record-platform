#!/bin/bash
# Packet capture script for auth-service connection debugging
# Captures TCP packets between API Gateway and auth-service

set -e

KUBECONFIG=${KUBECONFIG:-$HOME/.kube/kind-h3.yaml}
NAMESPACE=${NAMESPACE:-record-platform}
API_GW_POD=${API_GW_POD:-}
AUTH_SVC_IP=${AUTH_SVC_IP:-}
OUTPUT_DIR=${OUTPUT_DIR:-test-results/packet-capture}
TIMEOUT=${TIMEOUT:-60}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Packet Capture for Auth Service Connection Debugging ===${NC}"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
CAPTURE_FILE="$OUTPUT_DIR/auth-connection-${TIMESTAMP}.pcap"

# Get API Gateway pod
if [ -z "$API_GW_POD" ]; then
  echo "Getting API Gateway pod..."
  export KUBECONFIG
  API_GW_POD=$(kubectl get pods -n "$NAMESPACE" -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [ -z "$API_GW_POD" ]; then
    echo -e "${RED}Error: API Gateway pod not found${NC}"
    exit 1
  fi
  echo -e "${GREEN}Found API Gateway pod: $API_GW_POD${NC}"
fi

# Get auth-service IP
if [ -z "$AUTH_SVC_IP" ]; then
  echo "Getting auth-service IP..."
  export KUBECONFIG
  AUTH_SVC_IP=$(kubectl get svc auth-service -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
  if [ -z "$AUTH_SVC_IP" ]; then
    echo -e "${RED}Error: auth-service IP not found${NC}"
    exit 1
  fi
  echo -e "${GREEN}Found auth-service IP: $AUTH_SVC_IP${NC}"
fi

echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "  API Gateway Pod: $API_GW_POD"
echo "  Auth Service IP: $AUTH_SVC_IP"
echo "  Output File: $CAPTURE_FILE"
echo "  Timeout: ${TIMEOUT}s"
echo ""

# Check if tcpdump is available in the pod
echo "Checking if tcpdump is available..."
export KUBECONFIG
if ! kubectl exec -n "$NAMESPACE" "$API_GW_POD" -- sh -c 'which tcpdump > /dev/null 2>&1' 2>/dev/null; then
  echo -e "${YELLOW}Warning: tcpdump not found in pod. Installing...${NC}"
  # Try to install tcpdump (Alpine)
  kubectl exec -n "$NAMESPACE" "$API_GW_POD" -- sh -c 'apk add --no-cache tcpdump > /dev/null 2>&1' 2>/dev/null || \
  # Try to install tcpdump (Debian/Ubuntu)
  kubectl exec -n "$NAMESPACE" "$API_GW_POD" -- sh -c 'apt-get update && apt-get install -y tcpdump > /dev/null 2>&1' 2>/dev/null || {
    echo -e "${RED}Error: Could not install tcpdump. Please install it manually in the pod.${NC}"
    exit 1
  }
fi

echo -e "${GREEN}tcpdump is available${NC}"
echo ""

# Start packet capture in background
echo -e "${YELLOW}Starting packet capture...${NC}"
echo "  Filter: host $AUTH_SVC_IP and port 50051 (gRPC)"
echo "  Capturing for ${TIMEOUT} seconds..."
echo ""

# Capture packets
export KUBECONFIG
kubectl exec -n "$NAMESPACE" "$API_GW_POD" -- sh -c \
  "timeout $TIMEOUT tcpdump -i any -n -s 0 -w - 'host $AUTH_SVC_IP and (port 50051 or port 4001)'" \
  2>/dev/null > "$CAPTURE_FILE" &
CAPTURE_PID=$!

echo -e "${GREEN}Packet capture started (PID: $CAPTURE_PID)${NC}"
echo ""
echo -e "${YELLOW}Now make some test requests to trigger connections...${NC}"
echo "  Example: curl -k -X POST https://record.local:30443/api/auth/validate \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -H 'Authorization: Bearer YOUR_TOKEN' \\"
echo "    -d '{}'"
echo ""
echo "Waiting ${TIMEOUT} seconds for capture..."
echo ""

# Wait for capture to complete
wait $CAPTURE_PID 2>/dev/null || true

# Check if capture file was created and has content
if [ ! -f "$CAPTURE_FILE" ] || [ ! -s "$CAPTURE_FILE" ]; then
  echo -e "${RED}Error: Capture file is empty or not created${NC}"
  exit 1
fi

FILE_SIZE=$(du -h "$CAPTURE_FILE" | cut -f1)
echo -e "${GREEN}Packet capture completed!${NC}"
echo "  File: $CAPTURE_FILE"
echo "  Size: $FILE_SIZE"
echo ""

# Analyze capture (if tcpdump is available locally)
if command -v tcpdump > /dev/null 2>&1; then
  echo -e "${YELLOW}Quick analysis:${NC}"
  echo ""
  echo "TCP connections:"
  tcpdump -r "$CAPTURE_FILE" -n 'tcp' 2>/dev/null | head -20 || echo "  (analysis not available)"
  echo ""
  echo "gRPC traffic:"
  tcpdump -r "$CAPTURE_FILE" -n 'port 50051' 2>/dev/null | head -10 || echo "  (analysis not available)"
  echo ""
fi

echo -e "${GREEN}To analyze the capture file:${NC}"
echo "  tcpdump -r $CAPTURE_FILE -n"
echo "  wireshark $CAPTURE_FILE"
echo ""

