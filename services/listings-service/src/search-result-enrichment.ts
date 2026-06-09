import { fetchAuctionStatsByListingId } from "./listings-auction-service.js";

/** Batch watch counts from booking HTTP (best-effort; failures yield zeros). */
export async function fetchWatchCountsByListingId(
  ids: string[],
): Promise<Record<string, number>> {
  const base = (process.env.BOOKING_HTTP || "http://127.0.0.1:4013").replace(/\/$/, "");
  const out: Record<string, number> = {};
  const capped = ids.slice(0, 64);
  await Promise.all(
    capped.map(async (id) => {
      try {
        const upstream = await fetch(
          `${base}/watchlist/listings/${encodeURIComponent(id)}/count`,
          { signal: AbortSignal.timeout(3000) },
        );
        if (!upstream.ok) return;
        const j = (await upstream.json()) as { watch_count?: number };
        const n =
          typeof j.watch_count === "number" && Number.isFinite(j.watch_count)
            ? Math.max(0, Math.floor(j.watch_count))
            : 0;
        out[id] = n;
      } catch {
        /* ignore */
      }
    }),
  );
  return out;
}

/** Populate derived search fields (watch counts + auction stats) before rowToJson. */
export async function enrichSearchRows(
  rows: Record<string, unknown>[],
  _opts: { sort: string },
): Promise<void> {
  const ids = rows.map((r) => String(r.id ?? "")).filter(Boolean);
  let wc: Record<string, number> = {};
  let auctionStats: Awaited<ReturnType<typeof fetchAuctionStatsByListingId>> = {};
  try {
    wc = await fetchWatchCountsByListingId(ids);
  } catch {
    wc = {};
  }
  try {
    auctionStats = await fetchAuctionStatsByListingId(ids);
  } catch {
    auctionStats = {};
  }
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (id && wc[id] != null) row.watch_count = wc[id];
    else if (row.watch_count == null) row.watch_count = 0;
    const stats = id ? auctionStats[id] : undefined;
    if (stats) {
      row.auction_current_bid_cents =
        stats.current_bid_cents > 0 ? stats.current_bid_cents : stats.starting_bid_cents;
      row.auction_bid_count = stats.bid_count;
      row.auction_ends_at = stats.ends_at;
      row.auction_status = stats.status;
    }
  }
}
