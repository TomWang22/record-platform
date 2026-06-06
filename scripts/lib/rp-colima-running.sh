#!/usr/bin/env bash
# Colima running probe (status logs go to stderr — never grep stdout only).
rp_colima_is_running() {
  command -v colima >/dev/null 2>&1 || return 1
  if colima status 2>&1 | grep -qiE 'colima is running|\brunning\b'; then
    return 0
  fi
  colima list 2>/dev/null | awk 'NR>1 && $2 ~ /^[Rr]unning$/ { found=1; exit } END { exit !found }'
}
