#!/usr/bin/env bash
set -euo pipefail

# Generate comprehensive documentation from E2E test results
# Analyzes test results, monitoring data, and creates a detailed report

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Find the most recent test results directory
RESULTS_DIR="${1:-}"
if [[ -z "$RESULTS_DIR" ]]; then
  RESULTS_DIR=$(ls -td "$PROJECT_ROOT/test-results"/*e2e-find-limit-with-monitoring 2>/dev/null | head -1)
fi

if [[ -z "$RESULTS_DIR" ]] || [[ ! -d "$RESULTS_DIR" ]]; then
  fail "No test results directory found. Run: ./scripts/run-e2e-with-monitoring.sh"
fi

say "=== Generating E2E Test Documentation ==="
echo "Results directory: $RESULTS_DIR"

MONITOR_DIR="$RESULTS_DIR/monitoring"
DOC_DIR="$RESULTS_DIR/documentation"
mkdir -p "$DOC_DIR"

# Extract test metadata
TIMESTAMP=$(basename "$RESULTS_DIR" | cut -d'-' -f1-2)
PROTOCOLS="HTTP/2, HTTP/3"

# Analyze HTTP/2 results
HTTP2_ANALYSIS=""
if [[ -f "$RESULTS_DIR/HTTP-2-summary.json" ]]; then
  HTTP2_ANALYSIS=$(cat "$RESULTS_DIR/HTTP-2-summary.json" | jq -r '
    "## HTTP/2 Results\n",
    "**Max VUs**: \(.metrics.vus_max.values.value // "N/A")\n",
    "**Total Requests**: \(.metrics.http_reqs.values.count // 0)\n",
    "**Error Rate**: \((.metrics.http_req_failed.values.rate // 0) * 100 | floor)%\n",
    "**Average Latency**: \(.metrics.http_req_duration.values.avg // "N/A" | floor)ms\n",
    "**p95 Latency**: \(.metrics.http_req_duration.values["p(95)"] // "N/A" | floor)ms\n",
    "**p99 Latency**: \(.metrics.http_req_duration.values["p(99)"] // "N/A" | floor)ms\n"
  ' 2>/dev/null || echo "Could not parse HTTP/2 results")
fi

# Analyze HTTP/3 results
HTTP3_ANALYSIS=""
if [[ -f "$RESULTS_DIR/HTTP-3-summary.json" ]]; then
  HTTP3_ANALYSIS=$(cat "$RESULTS_DIR/HTTP-3-summary.json" | jq -r '
    "## HTTP/3 Results\n",
    "**Max VUs**: \(.metrics.vus_max.values.value // "N/A")\n",
    "**Total Requests**: \(.metrics.http_reqs.values.count // 0)\n",
    "**Error Rate**: \((.metrics.http_req_failed.values.rate // 0) * 100 | floor)%\n",
    "**Average Latency**: \(.metrics.http_req_duration.values.avg // "N/A" | floor)ms\n",
    "**p95 Latency**: \(.metrics.http_req_duration.values["p(95)"] // "N/A" | floor)ms\n",
    "**p99 Latency**: \(.metrics.http_req_duration.values["p(99)"] // "N/A" | floor)ms\n"
  ' 2>/dev/null || echo "Could not parse HTTP/3 results")
fi

# Analyze tcpdump capture
TCPDUMP_ANALYSIS=""
if [[ -f "$MONITOR_DIR/caddy-traffic.pcap" ]]; then
  TCPDUMP_SIZE=$(du -h "$MONITOR_DIR/caddy-traffic.pcap" | awk '{print $1}')
  TCPDUMP_ANALYSIS="
### Network Capture (tcpdump)

- **File**: \`monitoring/caddy-traffic.pcap\`
- **Size**: $TCPDUMP_SIZE
- **Captured**: TCP port 443 (HTTP/2) and UDP port 443 (HTTP/3)
- **Analysis**: See \`monitoring/tcpdump-analysis.txt\`

To analyze:
\`\`\`bash
# View HTTP/2 (TCP) packets
tcpdump -r monitoring/caddy-traffic.pcap 'tcp port 443'

# View HTTP/3 (UDP) packets
tcpdump -r monitoring/caddy-traffic.pcap 'udp port 443'

# Count protocol usage
tcpdump -r monitoring/caddy-traffic.pcap -n | grep -c 'tcp.*443'  # HTTP/2
tcpdump -r monitoring/caddy-traffic.pcap -n | grep -c 'udp.*443'  # HTTP/3
\`\`\`
"
fi

# Analyze pod metrics
POD_METRICS_ANALYSIS=""
if [[ -f "$MONITOR_DIR/pod-metrics.log" ]]; then
  POD_COUNT=$(wc -l < "$MONITOR_DIR/pod-metrics.log" | tr -d ' ')
  POD_METRICS_ANALYSIS="
### Pod Metrics

- **File**: \`monitoring/pod-metrics.log\`
- **Data Points**: $POD_COUNT
- **Interval**: Every 5 seconds
- **Metrics**: CPU usage, memory usage for all pods

Peak CPU usage:
\`\`\`
$(grep -h "$MONITOR_DIR/pod-metrics.log" | awk '{print $2, $3}' | sort -k2 -rn | head -10 || echo "N/A")
\`\`\`
"
fi

# Generate comprehensive documentation
cat > "$DOC_DIR/E2E_TEST_REPORT.md" <<EOF
# E2E Limit Finding Test Report

**Date**: $(date -r "$RESULTS_DIR" 2>/dev/null || date)  
**Timestamp**: $TIMESTAMP  
**Protocols**: $PROTOCOLS  
**Test Type**: Limit Finding (Ramping Load: 10→500 VUs)

## Executive Summary

This report documents the comprehensive E2E limit finding test for the Record Platform microservices architecture. The test ramps load from 10 to 500 Virtual Users (VUs) to identify system bottlenecks and maximum capacity.

### Test Configuration

- **Ramp Strategy**: 10 VUs → 25 → 50 → 100 → 200 → 300 → 500 VUs
- **Total Duration**: ~12 minutes per protocol
- **Services Tested**: Auth, Records, Listings, Social, Shopping, Analytics, Python AI
- **Frontend Excluded**: Webapp (frontend) excluded from E2E tests

### Monitoring Tools

1. **tcpdump**: Network packet capture (HTTP/2 TCP + HTTP/3 UDP)
2. **Pod Metrics**: CPU and memory usage (every 5 seconds)
3. **Process Monitoring**: Top processes in auth-service (every 10 seconds)
4. **System Resources**: Kind node resource usage (every 15 seconds)
5. **Pod Status**: Kubernetes pod status snapshots (every 30 seconds)

## Test Results

$HTTP2_ANALYSIS

$HTTP3_ANALYSIS

## Monitoring Data Analysis

$TCPDUMP_ANALYSIS

$POD_METRICS_ANALYSIS

### Process Monitoring

- **File**: \`monitoring/auth-processes.log\`
- **Interval**: Every 10 seconds
- **Purpose**: Identify CPU-intensive processes during load

### System Resources

- **Files**: \`monitoring/node-*-top-*.txt\`, \`monitoring/node-*-resources.log\`
- **Interval**: Every 15 seconds
- **Metrics**: CPU, memory, disk usage on Kind nodes

## Key Findings

### Bottleneck Identification

The test identifies which service reaches its limit first under increasing load:

1. **Auth Service**: Gatekeeper service with bcrypt bottleneck
2. **Records Service**: Database-intensive operations
3. **Listings Service**: Search and CRUD operations
4. **Messaging Service**: Kafka-dependent messaging
5. **Shopping Service**: Cart and checkout operations
6. **Analytics Service**: Kafka-dependent event ingestion
7. **Python AI Service**: AI processing and advice generation

### Protocol Comparison

- **HTTP/2**: Mature implementation, optimized connection reuse
- **HTTP/3**: QUIC-based, newer implementation, may show different characteristics under load

## Files Generated

### Test Results
- \`HTTP-2-results.json\`: Full k6 results for HTTP/2
- \`HTTP-3-results.json\`: Full k6 results for HTTP/3
- \`HTTP-2-summary.json\`: Summary metrics for HTTP/2
- \`HTTP-3-summary.json\`: Summary metrics for HTTP/3
- \`HTTP-2-output.log\`: k6 console output for HTTP/2
- \`HTTP-3-output.log\`: k6 console output for HTTP/3

### Monitoring Data
- \`monitoring/caddy-traffic.pcap\`: Network packet capture
- \`monitoring/pod-metrics.log\`: Pod CPU/memory metrics
- \`monitoring/node-metrics.log\`: Node CPU/memory metrics
- \`monitoring/auth-processes.log\`: Auth service process monitoring
- \`monitoring/pod-status-*.txt\`: Pod status snapshots
- \`monitoring/test-timeline.log\`: Test execution timeline

### Documentation
- \`documentation/E2E_TEST_REPORT.md\`: This report
- \`SUMMARY.md\`: Quick summary

## Analysis Tools

### View tcpdump Capture

\`\`\`bash
# Install Wireshark or use tcpdump
tcpdump -r monitoring/caddy-traffic.pcap -n

# Filter HTTP/2 (TCP)
tcpdump -r monitoring/caddy-traffic.pcap 'tcp port 443'

# Filter HTTP/3 (UDP/QUIC)
tcpdump -r monitoring/caddy-traffic.pcap 'udp port 443'
\`\`\`

### Analyze Pod Metrics

\`\`\`bash
# View peak CPU usage
grep -h monitoring/pod-metrics.log | awk '{print \$2, \$3}' | sort -k2 -rn | head -20

# View peak memory usage
grep -h monitoring/pod-metrics.log | awk '{print \$2, \$4}' | sort -k4 -rn | head -20
\`\`\`

### View Test Timeline

\`\`\`bash
cat monitoring/test-timeline.log
\`\`\`

## Recommendations

Based on the test results:

1. **Identify Bottlenecks**: Review which service failed first
2. **Optimize Bottlenecks**: Increase resources, optimize code, add caching
3. **Connection Pooling**: Ensure proper HTTP/2 and HTTP/3 connection reuse
4. **Resource Limits**: Adjust Kubernetes resource limits based on findings
5. **Scaling Strategy**: Implement HPA (Horizontal Pod Autoscaler) based on load patterns

## Next Steps

1. Review bottleneck analysis in test output
2. Compare HTTP/2 vs HTTP/3 performance characteristics
3. Optimize identified bottlenecks
4. Re-run tests to validate improvements
5. Document findings in runbook

---

**Generated**: $(date)  
**Test Results**: $RESULTS_DIR
EOF

ok "Documentation generated: $DOC_DIR/E2E_TEST_REPORT.md"

# Create quick reference
cat > "$DOC_DIR/QUICK_REFERENCE.md" <<EOF
# E2E Test Quick Reference

## Test Results Location
\`$RESULTS_DIR\`

## Key Files

### Results
- \`HTTP-2-summary.json\` - HTTP/2 metrics
- \`HTTP-3-summary.json\` - HTTP/3 metrics
- \`SUMMARY.md\` - Quick summary

### Monitoring
- \`monitoring/caddy-traffic.pcap\` - Network capture
- \`monitoring/pod-metrics.log\` - Pod metrics
- \`monitoring/auth-processes.log\` - Process monitoring

### Documentation
- \`documentation/E2E_TEST_REPORT.md\` - Full report
- \`documentation/QUICK_REFERENCE.md\` - This file

## Quick Commands

\`\`\`bash
# View HTTP/2 results
jq '.metrics | {vus_max, http_reqs, http_req_failed, http_req_duration}' HTTP-2-summary.json

# View HTTP/3 results
jq '.metrics | {vus_max, http_reqs, http_req_failed, http_req_duration}' HTTP-3-summary.json

# Analyze tcpdump
tcpdump -r monitoring/caddy-traffic.pcap -n | head -50

# View pod metrics
tail -100 monitoring/pod-metrics.log
\`\`\`
EOF

ok "Quick reference generated: $DOC_DIR/QUICK_REFERENCE.md"

say "=== Documentation Generation Complete ==="
ok "Full report: $DOC_DIR/E2E_TEST_REPORT.md"
ok "Quick reference: $DOC_DIR/QUICK_REFERENCE.md"

