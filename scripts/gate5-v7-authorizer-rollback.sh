#!/usr/bin/env bash
# Rollback Kafka authorizer settings to the previous *tracked* fail-closed posture.
#
# IMPORTANT: This does NOT silently enable permissive authorization.
# allow.everyone.if.no.acl.found must remain false (or unset only together with
# removing authorizer.class.name — never set to true).
#
# Default mode (RP_GATE5_V7_ROLLBACK_MODE=authorizer-off):
#   Remove authorizer.class.name / allow.everyone / super.users from live STS env
#   after confirming source rollback intent. Used only for emergency unlock when
#   ACLs are broken AND recovery-admin cannot repair.
#
# Preferred recovery: keep StandardAuthorizer and repair ACLs via recovery-admin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-record-platform}"
MODE="${RP_GATE5_V7_ROLLBACK_MODE:-repair-acls}"
CONFIRM="${RP_GATE5_V7_ROLLBACK_CONFIRM:-}"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ "$CONFIRM" == "yes" ]] || fail "set RP_GATE5_V7_ROLLBACK_CONFIRM=yes to proceed"

case "$MODE" in
  repair-acls)
    ok "preferred rollback: re-run ACL bootstrap (authorizer stays enabled, fail-closed)"
    bash "$SCRIPT_DIR/gate5-v7-acl-bootstrap.sh"
    ok "ACL repair complete — authorizer remains StandardAuthorizer with allow.everyone=false"
    ;;
  authorizer-off)
    echo "⚠️  Removing live authorizer env (does NOT set allow.everyone=true)"
    kubectl -n "$NS" set env sts/kafka \
      KAFKA_AUTHORIZER_CLASS_NAME- \
      KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND- \
      KAFKA_SUPER_USERS-
    # Explicitly refuse permissive flag
    live_allow="$(kubectl -n "$NS" get sts kafka -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' \
      | grep '^KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND=' || true)"
    if echo "$live_allow" | grep -qi '=true'; then
      fail "refusing permissive allow.everyone=true"
    fi
    ok "authorizer env removed from live STS; roll pods manually one-at-a-time if required"
    echo "NOTE: tracked source still declares StandardAuthorizer — reconcile Git before next bootstrap"
    ;;
  *)
    fail "unknown RP_GATE5_V7_ROLLBACK_MODE=${MODE} (repair-acls|authorizer-off)"
    ;;
esac
