/** Paths on listings-service HTTP app that are mounted at Express root (not under /listings/). */
const LISTINGS_ROOT_FIRST_SEGMENTS = new Set([
  "create",
  "mine",
  "search",
  "settings",
  "ratings",
  "community",
  "healthz",
  "health",
  "metrics",
  "internal",
  "cache",
  "debug",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * After http-proxy-middleware strips the matched `/listings` prefix, map the remainder
 * to the path listings-service expects.
 */
export function rewriteListingsProxyPath(path: string): string {
  const p = (path || "").replace(/^\/+/, "") || "";
  if (!p) {
    return "/listings";
  }

  const withoutListings = p.replace(/^listings\/?/, "");

  if (withoutListings === "settings" || withoutListings.startsWith("settings/")) {
    return `/${withoutListings}`;
  }
  if (withoutListings === "ratings" || withoutListings.startsWith("ratings/")) {
    return `/${withoutListings}`;
  }
  if (withoutListings === "search" || withoutListings.startsWith("search/")) {
    return `/${withoutListings}`;
  }

  const first = withoutListings.split("/")[0] ?? "";
  if (LISTINGS_ROOT_FIRST_SEGMENTS.has(first)) {
    return `/${withoutListings}`;
  }

  if (UUID_RE.test(first)) {
    return `/listings/${withoutListings}`;
  }

  if (withoutListings.startsWith("listings/")) {
    return `/${withoutListings}`;
  }

  return `/listings/${withoutListings}`;
}
