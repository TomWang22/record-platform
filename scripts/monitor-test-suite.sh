#!/usr/bin/env bash
# Monitor the running test suite

LOG_FILE=$(find /tmp -name "full-test-suite-clean-*.log" -type f -mmin -30 2>/dev/null | sort | tail -1)

if [[ -n "$LOG_FILE" ]]; then
  echo "Monitoring: $LOG_FILE"
  echo "Press Ctrl+C to stop"
  echo ""
  tail -f "$LOG_FILE"
else
  echo "No recent test suite log found"
  echo "Checking for running processes..."
  ps aux | grep -E "run-all-test-suites|test-microservices|test-tls-mtls" | grep -v grep || echo "No test processes running"
fi
