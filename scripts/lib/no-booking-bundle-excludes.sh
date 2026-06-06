# Shared exclude predicates for no-booking bundle (source: package-och-platform-no-booking-bundle.sh).
# Shell: source scripts/lib/no-booking-bundle-excludes.sh

no_booking_should_skip() {
  local rel="${1#./}"
  case "$rel" in
    .git/*|node_modules/*|*/node_modules/*|bench_logs/*|*/bench_logs/*|.build-cache/*|.reissue-tmp.*/*|.venv-*/*|.k6-build/*|.xk6-build/*) return 0 ;;
    */.next/*|*/dist/*|*/.turbo/*|*/__pycache__/*) return 0 ;;
    services/*/coverage/*|webapp/coverage/*) return 0 ;;
    reports/no-booking-bundle-*) return 0 ;;
    *booking-service*|*5443-bookings*) return 0 ;;
    proto/booking.proto|proto/events/booking.proto|infra/k8s/base/config/proto/booking.proto) return 0 ;;
    infra/db/*booking*) return 0 ;;
    testd/physical/bookings.*|tests/system/booking-analytics.contract.test.ts) return 0 ;;
    BOOKING_SERVICE_EXPANSION_NO_DB.md) return 0 ;;
    docs/api/booking-service.md|docs/lld/booking-service.md|docs/checklists/booking-service-branch-checklist.md) return 0 ;;
    */.DS_Store|.DS_Store) return 0 ;;
    .env|*/.env) return 0 ;;
    01-booking-schema.sql|02-booking-state-machine.sql|03-booking-outbox.sql|04-booking-search-history.sql|05-booking-prisma-columns.sql|06-booking-processed-events.sql|19-booking-search-history-alerts.sql|20-booking-tenant-username-snapshot.sql|25-notification-booking-context-read.sql|27-notification-backfill-booking-context-read-and-dedupe.sql|27-notification-booking-identity-backfill.md|29-notification-booking-dedupe-cleanup.sql|30-notification-booking-read-state-normalize.sql|30-notification-booking-read-siblings.sql) return 0 ;;
  esac
  local base
  base="$(basename "$rel")"
  case "$base" in
    booking.proto|booking-analytics.contract.test.ts|BOOKING_SERVICE_EXPANSION_NO_DB.md|bookings.json|bookings.svg|bookings.dot) return 0 ;;
  esac
  return 1
}

# Top-level directories expected in the portable platform bundle.
NO_BOOKING_BUNDLE_TOP_DIRS=(
  .github artifacts backups certs diagrams docker docs infra k8s monitoring observability
  proto reports schemas scripts services testd tests tools webapp
)
