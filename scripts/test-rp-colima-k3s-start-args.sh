#!/usr/bin/env bash
# Regression: Colima start argv must pass --disable=servicelb and --disable=traefik without mangling.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/rp-colima-k3s-start-args.sh
source "$SCRIPT_DIR/lib/rp-colima-k3s-start-args.sh"

FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

colima_args=()
rp_colima_build_start_argv colima_args 12 16 256 v1.29.6+k3s1

rendered="$(mktemp)"
rp_colima_print_start_argv colima_args >"$rendered"
cat "$rendered"

if ! grep -q -- '--k3s-arg' "$rendered"; then
  bad "missing --k3s-arg in colima argv"
fi
if ! grep -q -- '--disable=servicelb' "$rendered"; then
  bad "missing --disable=servicelb in colima argv"
fi
if ! grep -q -- '--disable=traefik' "$rendered"; then
  bad "missing --disable=traefik in colima argv"
fi
if grep -q -- 'servicelb\\' "$rendered"; then
  bad "malformed servicelb\\ in colima argv"
fi
if grep -q -- '@server' "$rendered"; then
  bad "@server suffix in colima argv"
fi

# Array contents (not just printf output).
k3s_arg_count=0
disable_servicelb=0
disable_traefik=0
for ((i = 0; i < ${#colima_args[@]}; i++)); do
  if [[ "${colima_args[i]}" == "--k3s-arg" ]]; then
    k3s_arg_count=$((k3s_arg_count + 1))
    val="${colima_args[i + 1]:-}"
    case "$val" in
      --disable=servicelb) disable_servicelb=1 ;;
      --disable=traefik) disable_traefik=1 ;;
      *)
        if [[ "$val" == *servicelb* ]]; then
          bad "unexpected k3s-arg value: $val"
        fi
        ;;
    esac
  fi
done

[[ "$k3s_arg_count" -eq 2 ]] && ok "exactly two --k3s-arg entries" || bad "expected 2 --k3s-arg entries, got ${k3s_arg_count}"
[[ "$disable_servicelb" -eq 1 ]] && ok "argv contains --disable=servicelb" || bad "argv missing --disable=servicelb"
[[ "$disable_traefik" -eq 1 ]] && ok "argv contains --disable=traefik" || bad "argv missing --disable=traefik"

# Dry-run rp-colima-start-clean prints argv proof.
dry="$(RP_CB_DRY_RUN=1 bash "$SCRIPT_DIR/rp-colima-start-clean.sh" 2>&1 || true)"
if ! grep -q -- 'colima argv:' <<<"$dry"; then
  bad "rp-colima-start-clean dry-run missing colima argv line"
fi
if grep -q -- 'servicelb\\' <<<"$dry"; then
  bad "dry-run contains servicelb backslash escape"
fi

rm -f "$rendered"

[[ "$FAIL" -eq 0 ]] || exit 1
echo "✅ test-rp-colima-k3s-start-args passed"
