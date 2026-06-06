#!/bin/bash
# Extract granular percentiles from k6 JSON results
# Calculates: p100, p99, p99.9, p99.99, p99.999, p99.9999, p99.99999, p99.999999

set -e

INPUT_FILE=${1:-}
OUTPUT_DIR=${2:-test-results}

if [ -z "$INPUT_FILE" ]; then
  echo "Usage: $0 <k6-results.json> [output-dir]"
  echo ""
  echo "Finding latest k6 JSON results..."
  LATEST=$(ls -t test-results/k6-auth-comprehensive-*.json 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    echo "Found: $LATEST"
    INPUT_FILE="$LATEST"
  else
    echo "Error: No k6 JSON results found. Run k6 with JSON output first."
    exit 1
  fi
fi

if [ ! -f "$INPUT_FILE" ]; then
  echo "Error: File not found: $INPUT_FILE"
  exit 1
fi

echo "=== Extracting Granular Percentiles ==="
echo "Input: $INPUT_FILE"
echo ""

# Use Node.js script if available, otherwise use jq
if command -v node > /dev/null 2>&1 && [ -f "scripts/load/calculate-granular-percentiles.js" ]; then
  echo "Using Node.js percentile calculator..."
  node scripts/load/calculate-granular-percentiles.js "$INPUT_FILE"
else
  echo "Using jq for basic percentile extraction..."
  
  # Extract basic metrics using jq
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  OUTPUT_FILE="$OUTPUT_DIR/k6-percentiles-${TIMESTAMP}.md"
  
  echo "# Granular Percentile Analysis" > "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  echo "**Generated:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$OUTPUT_FILE"
  echo "**Source:** $INPUT_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  
  # Extract metrics
  for metric in register_latency login_latency validate_latency refresh_latency logout_latency http_req_duration; do
    echo "## ${metric^^}" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
    
    # Get values array
    VALUES=$(jq -r ".metrics.${metric}.values[]?" "$INPUT_FILE" 2>/dev/null || echo "")
    
    if [ -n "$VALUES" ] && [ "$VALUES" != "null" ]; then
      COUNT=$(echo "$VALUES" | wc -l | tr -d ' ')
      MIN=$(echo "$VALUES" | jq -s 'min')
      MAX=$(echo "$VALUES" | jq -s 'max')
      AVG=$(echo "$VALUES" | jq -s 'add/length')
      
      echo "- **Count:** $COUNT" >> "$OUTPUT_FILE"
      echo "- **Min:** $(printf "%.2f" $MIN)ms" >> "$OUTPUT_FILE"
      echo "- **Max (p100):** $(printf "%.2f" $MAX)ms" >> "$OUTPUT_FILE"
      echo "- **Average:** $(printf "%.2f" $AVG)ms" >> "$OUTPUT_FILE"
      echo "" >> "$OUTPUT_FILE"
      echo "### Percentiles" >> "$OUTPUT_FILE"
      echo "" >> "$OUTPUT_FILE"
      echo "| Percentile | Latency (ms) |" >> "$OUTPUT_FILE"
      echo "|------------|-------------|" >> "$OUTPUT_FILE"
      echo "| p100 | $(printf "%.2f" $MAX) |" >> "$OUTPUT_FILE"
      
      # Calculate percentiles using jq
      for p in 99 99.9 99.99 99.999 99.9999 99.99999 99.999999; do
        INDEX=$(echo "$COUNT * $p / 100" | bc -l | cut -d. -f1)
        INDEX=$((INDEX - 1))
        if [ $INDEX -lt 0 ]; then INDEX=0; fi
        if [ $INDEX -ge $COUNT ]; then INDEX=$((COUNT - 1)); fi
        
        SORTED=$(echo "$VALUES" | jq -s 'sort')
        VALUE=$(echo "$SORTED" | jq ".[$INDEX]")
        echo "| p$p | $(printf "%.2f" $VALUE) |" >> "$OUTPUT_FILE"
      done
      echo "" >> "$OUTPUT_FILE"
    else
      echo "No data available for $metric" >> "$OUTPUT_FILE"
      echo "" >> "$OUTPUT_FILE"
    fi
  done
  
  echo "✅ Percentile analysis saved to: $OUTPUT_FILE"
fi

