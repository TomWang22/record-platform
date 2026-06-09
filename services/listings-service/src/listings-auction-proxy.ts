/**
 * eBay-style proxy bid settlement — visible increments only; proxy max stays secret.
 */

export type ProxyBidInput = {
  bidderUserId: string;
  maxBidCents: number;
};

export type ProxySettlement = {
  currentBidCents: number;
  highBidderUserId: string | null;
  reserveMet: boolean;
  /** New visible increments to record (amount + source). */
  increments: Array<{
    bidderUserId: string;
    amountCents: number;
    bidSource: "manual" | "proxy_auto";
  }>;
  outbidUserIds: string[];
};

export function computeProxySettlement(input: {
  startingBidCents: number;
  bidIncrementCents: number;
  reserveCents: number | null;
  previousCurrentBidCents: number;
  previousHighBidderId: string | null;
  proxies: ProxyBidInput[];
  newBidderUserId: string;
  newMaxBidCents: number;
  bidSource: "manual" | "proxy_auto";
}): ProxySettlement {
  const merged = new Map<string, number>();
  for (const p of input.proxies) {
    merged.set(String(p.bidderUserId).trim().toLowerCase(), p.maxBidCents);
  }
  merged.set(
    String(input.newBidderUserId).trim().toLowerCase(),
    Math.max(merged.get(String(input.newBidderUserId).trim().toLowerCase()) ?? 0, input.newMaxBidCents),
  );

  const ranked = [...merged.entries()]
    .map(([bidderUserId, maxBidCents]) => ({ bidderUserId, maxBidCents }))
    .sort((a, b) => b.maxBidCents - a.maxBidCents || a.bidderUserId.localeCompare(b.bidderUserId));

  if (ranked.length === 0) {
    return {
      currentBidCents: 0,
      highBidderUserId: null,
      reserveMet: false,
      increments: [],
      outbidUserIds: [],
    };
  }

  const top = ranked[0];
  const second = ranked[1];
  let currentBidCents: number;
  if (!second) {
    currentBidCents = Math.min(top.maxBidCents, input.startingBidCents);
  } else {
    const minToWin = second.maxBidCents + input.bidIncrementCents;
    currentBidCents = Math.min(top.maxBidCents, minToWin);
  }
  currentBidCents = Math.max(currentBidCents, input.startingBidCents);

  const reserveMet =
    input.reserveCents == null || currentBidCents >= input.reserveCents;

  const increments: ProxySettlement["increments"] = [];
  const prevHigh = input.previousHighBidderId
    ? String(input.previousHighBidderId).trim().toLowerCase()
    : null;
  const prevCurrent = input.previousCurrentBidCents;

  if (currentBidCents > prevCurrent) {
    increments.push({
      bidderUserId: top.bidderUserId,
      amountCents: currentBidCents,
      bidSource: input.bidSource,
    });
  }

  const outbidUserIds: string[] = [];
  if (prevHigh && prevHigh !== top.bidderUserId) {
    outbidUserIds.push(prevHigh);
  }

  return {
    currentBidCents,
    highBidderUserId: top.bidderUserId,
    reserveMet,
    increments,
    outbidUserIds,
  };
}

export function minimumNextBidCents(input: {
  startingBidCents: number;
  currentBidCents: number;
  bidIncrementCents: number;
  hasBids: boolean;
}): number {
  if (!input.hasBids || input.currentBidCents <= 0) {
    return input.startingBidCents;
  }
  return input.currentBidCents + input.bidIncrementCents;
}
