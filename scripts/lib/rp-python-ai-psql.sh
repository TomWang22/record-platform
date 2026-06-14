#!/usr/bin/env bash
# Timeout-safe, non-interactive psql helpers for python_ai (port 5440).
# Source from scripts: source "$SCRIPT_DIR/lib/rp-python-ai-psql.sh"

rp_python_ai_psql() {
  local sql="$1"
  local runner=(env
    PGPASSWORD="${PGPASSWORD:-postgres}"
    PGCONNECT_TIMEOUT=5
    psql -h "${PGHOST:-127.0.0.1}"
      -p "${PYTHON_AI_PGPORT:-5440}"
      -U "${PGUSER:-postgres}"
      -d "${PYTHON_AI_DB:-python_ai}"
      -v ON_ERROR_STOP=1 -At -c "$sql")

  if command -v timeout >/dev/null 2>&1; then
    timeout 10s "${runner[@]}"
    return $?
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout 10s "${runner[@]}"
    return $?
  fi

  "${runner[@]}" &
  local cmd_pid=$!
  (
    sleep 10
    if kill -0 "$cmd_pid" 2>/dev/null; then
      kill -TERM "$cmd_pid" 2>/dev/null
      sleep 1
      kill -KILL "$cmd_pid" 2>/dev/null
    fi
  ) &
  local watch_pid=$!
  wait "$cmd_pid" 2>/dev/null
  local rc=$?
  kill "$watch_pid" 2>/dev/null || true
  wait "$watch_pid" 2>/dev/null || true
  return "$rc"
}

rp_python_ai_psql_connect_check() {
  rp_python_ai_psql "SELECT 1;" >/dev/null
}
