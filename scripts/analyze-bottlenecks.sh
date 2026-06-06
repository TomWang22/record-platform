#!/usr/bin/env bash
# Analyze k6 test results to identify bottlenecks

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <results-directory>"
  echo "Example: $0 test-results/20251230-085650-k6-fixed"
  exit 1
fi

RESULTS_DIR="$1"

say "=== Bottleneck Analysis ==="
echo "Results directory: $RESULTS_DIR"
echo ""

# Function to extract metric from log
extract_metric() {
  local log_file="$1"
  local metric="$2"
  grep "$metric" "$log_file" 2>/dev/null | tail -1 | sed 's/^[[:space:]]*//' || echo "N/A"
}

# Function to analyze HTTP/2 results
analyze_http2() {
  local log_file="$RESULTS_DIR/k6-http2.log"
  if [[ ! -f "$log_file" ]]; then
    warn "HTTP/2 log not found: $log_file"
    return 1
  fi
  
  say "=== HTTP/2 Limit Test Analysis ==="
  echo ""
  
  echo "Success Rates:"
  echo "  Auth:      $(extract_metric "$log_file" 'auth_success_rate')"
  echo "  Records:   $(extract_metric "$log_file" 'records_success_rate')"
  echo "  Listings:  $(extract_metric "$log_file" 'listings_success_rate')"
  echo "  Social:   $(extract_metric "$log_file" 'social_success_rate')"
  echo "  Shopping:  $(extract_metric "$log_file" 'shopping_success_rate')"
  echo "  Analytics: $(extract_metric "$log_file" 'analytics_success_rate')"
  echo "  Python AI: $(extract_metric "$log_file" 'python_ai_success_rate')"
  echo ""
  
  echo "Error Counts:"
  echo "  Auth:      $(extract_metric "$log_file" 'auth_errors')"
  echo "  Records:   $(extract_metric "$log_file" 'records_errors')"
  echo "  Listings:  $(extract_metric "$log_file" 'listings_errors')"
  echo "  Social:    $(extract_metric "$log_file" 'social_errors')"
  echo "  Shopping:  $(extract_metric "$log_file" 'shopping_errors')"
  echo "  Analytics: $(extract_metric "$log_file" 'analytics_errors')"
  echo "  Python AI: $(extract_metric "$log_file" 'python_ai_errors')"
  echo ""
  
  echo "Latency (p95):"
  echo "  Auth:      $(extract_metric "$log_file" 'auth_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo "  Records:   $(extract_metric "$log_file" 'records_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo "  Listings:  $(extract_metric "$log_file" 'listings_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo "  Social:    $(extract_metric "$log_file" 'social_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo "  Shopping:  $(extract_metric "$log_file" 'shopping_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo "  Analytics: $(extract_metric "$log_file" 'analytics_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo "  Python AI: $(extract_metric "$log_file" 'python_ai_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo ""
  
  # Identify bottleneck
  echo "Bottleneck Analysis:"
  AUTH_SUCCESS=$(extract_metric "$log_file" 'auth_success_rate' | grep -oE '[0-9]+\.[0-9]+%' | head -1 | sed 's/%//' || echo "0")
  AUTH_ERRORS=$(extract_metric "$log_file" 'auth_errors' | grep -oE '[0-9]+' | head -1 || echo "0")
  
  if (( $(echo "$AUTH_SUCCESS < 20" | bc -l 2>/dev/null || echo 0) )); then
    warn "🔴 PRIMARY BOTTLENECK: Auth Service"
    echo "   - Success rate: ${AUTH_SUCCESS}%"
    echo "   - Errors: $AUTH_ERRORS"
    echo "   - Root cause: bcrypt password hashing (CPU-intensive security operation)"
    echo "   - Impact: All services depend on auth tokens"
  fi
  
  # Check other services
  RECORDS_SUCCESS=$(extract_metric "$log_file" 'records_success_rate' | grep -oE '[0-9]+\.[0-9]+%' | head -1 | sed 's/%//' || echo "100")
  if (( $(echo "$RECORDS_SUCCESS < 20" | bc -l 2>/dev/null || echo 0) )); then
    warn "⚠️  Secondary bottleneck: Records Service (${RECORDS_SUCCESS}% success)"
  fi
  
  LISTINGS_SUCCESS=$(extract_metric "$log_file" 'listings_success_rate' | grep -oE '[0-9]+\.[0-9]+%' | head -1 | sed 's/%//' || echo "100")
  if (( $(echo "$LISTINGS_SUCCESS < 20" | bc -l 2>/dev/null || echo 0) )); then
    warn "⚠️  Secondary bottleneck: Listings Service (${LISTINGS_SUCCESS}% success)"
  fi
}

# Function to analyze HTTP/3 results
analyze_http3() {
  local log_file="$RESULTS_DIR/k6-http3.log"
  if [[ ! -f "$log_file" ]]; then
    warn "HTTP/3 log not found: $log_file"
    return 1
  fi
  
  say "=== HTTP/3 Limit Test Analysis ==="
  echo ""
  
  echo "Success Rates:"
  echo "  Auth:      $(extract_metric "$log_file" 'auth_success_rate')"
  echo "  Records:   $(extract_metric "$log_file" 'records_success_rate')"
  echo "  Listings:  $(extract_metric "$log_file" 'listings_success_rate')"
  echo "  Social:    $(extract_metric "$log_file" 'social_success_rate')"
  echo "  Shopping:  $(extract_metric "$log_file" 'shopping_success_rate')"
  echo "  Analytics: $(extract_metric "$log_file" 'analytics_success_rate')"
  echo "  Python AI: $(extract_metric "$log_file" 'python_ai_success_rate')"
  echo ""
  
  echo "Error Counts:"
  echo "  Auth:      $(extract_metric "$log_file" 'auth_errors')"
  echo "  Records:   $(extract_metric "$log_file" 'records_errors')"
  echo "  Listings:  $(extract_metric "$log_file" 'listings_errors')"
  echo "  Social:    $(extract_metric "$log_file" 'social_errors')"
  echo "  Shopping:  $(extract_metric "$log_file" 'shopping_errors')"
  echo "  Analytics: $(extract_metric "$log_file" 'analytics_errors')"
  echo "  Python AI: $(extract_metric "$log_file" 'python_ai_errors')"
  echo ""
  
  echo "Latency (p95):"
  echo "  Auth:      $(extract_metric "$log_file" 'auth_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo "  Records:   $(extract_metric "$log_file" 'records_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo "  Listings:  $(extract_metric "$log_file" 'listings_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo "  Social:    $(extract_metric "$log_file" 'social_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo "  Shopping:  $(extract_metric "$log_file" 'shopping_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo "  Analytics: $(extract_metric "$log_file" 'analytics_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo "  Python AI: $(extract_metric "$log_file" 'python_ai_latency_ms' | grep -o 'p(95)=[^ ]*' || echo 'N/A')"
  echo ""
}

# Function to compare HTTP/2 vs HTTP/3
compare_protocols() {
  local http2_log="$RESULTS_DIR/k6-http2.log"
  local http3_log="$RESULTS_DIR/k6-http3.log"
  
  if [[ ! -f "$http2_log" ]] || [[ ! -f "$http3_log" ]]; then
    warn "Cannot compare - missing log files"
    return 1
  fi
  
  say "=== HTTP/2 vs HTTP/3 Comparison ==="
  echo ""
  echo "Service Success Rates:"
  echo ""
  
  for service in auth records listings social shopping analytics python_ai; do
    SERVICE_NAME=$(echo "$service" | sed 's/_/ /g' | awk '{for(i=1;i<=NF;i++)sub(/./,toupper(substr($i,1,1)),$i)}1')
    H2_SUCCESS=$(extract_metric "$http2_log" "${service}_success_rate" | grep -oE '[0-9]+\.[0-9]+%' | head -1 || echo "N/A")
    H3_SUCCESS=$(extract_metric "$http3_log" "${service}_success_rate" | grep -oE '[0-9]+\.[0-9]+%' | head -1 || echo "N/A")
    
    if [[ "$H2_SUCCESS" != "N/A" ]] && [[ "$H3_SUCCESS" != "N/A" ]]; then
      H2_VAL=$(echo "$H2_SUCCESS" | sed 's/%//')
      H3_VAL=$(echo "$H3_SUCCESS" | sed 's/%//')
      if (( $(echo "$H3_VAL > $H2_VAL" | bc -l 2>/dev/null || echo 0) )); then
        echo "  $SERVICE_NAME: HTTP/2: $H2_SUCCESS → HTTP/3: $H3_SUCCESS ✅ (Better)"
      elif (( $(echo "$H3_VAL < $H2_VAL" | bc -l 2>/dev/null || echo 0) )); then
        echo "  $SERVICE_NAME: HTTP/2: $H2_SUCCESS → HTTP/3: $H3_SUCCESS ⚠️  (Worse)"
      else
        echo "  $SERVICE_NAME: HTTP/2: $H2_SUCCESS → HTTP/3: $H3_SUCCESS (Same)"
      fi
    else
      echo "  $SERVICE_NAME: HTTP/2: $H2_SUCCESS → HTTP/3: $H3_SUCCESS"
    fi
  done
  echo ""
}

# Main analysis
analyze_http2
echo ""
analyze_http3
echo ""
compare_protocols

say "=== Analysis Complete ==="
ok "Results saved to: $RESULTS_DIR"
echo ""
echo "To view detailed logs:"
echo "  tail -100 $RESULTS_DIR/k6-http2.log"
echo "  tail -100 $RESULTS_DIR/k6-http3.log"
