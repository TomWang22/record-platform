/**
 * Auction bidding HTTP routes (gateway injects x-user-id from JWT).
 */
import type { NextFunction, Request, Response } from "express";
import { validateListingId } from "./validation.js";
import {
  AuctionServiceError,
  closeAuction,
  getAuctionStateForListing,
  listAuctionBids,
  placeAuctionBid,
} from "./listings-auction-service.js";

export type AuthedAuctionRequest = Request & { userId?: string };

function requireUser(req: AuthedAuctionRequest, res: Response, next: NextFunction): void {
  const userId = (req.get("x-user-id") || "").trim();
  if (!userId) {
    res.status(401).json({ error: "missing x-user-id" });
    return;
  }
  req.userId = userId;
  next();
}

function parseBidCents(body: Record<string, unknown>): {
  amountCents: number | null;
  maxBidCents: number | null;
  useProxy: boolean;
} {
  const useProxy = body.useProxy === true || body.use_proxy === true || body.maxBidCents != null || body.max_bid_cents != null;
  const read = (k: string) => {
    const n = Number(body[k]);
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  let amountCents = read("amountCents") ?? read("amount_cents");
  let maxBidCents = read("maxBidCents") ?? read("max_bid_cents");
  if (amountCents == null && (body.amountDisplay != null || body.amount != null)) {
    const raw = String(body.amountDisplay ?? body.amount).replace(/[^0-9.]/g, "");
    const dollars = Number(raw);
    if (Number.isFinite(dollars) && dollars > 0) amountCents = Math.round(dollars * 100);
  }
  if (maxBidCents == null && body.maxBidDisplay != null) {
    const raw = String(body.maxBidDisplay).replace(/[^0-9.]/g, "");
    const dollars = Number(raw);
    if (Number.isFinite(dollars) && dollars > 0) maxBidCents = Math.round(dollars * 100);
  }
  return { amountCents, maxBidCents, useProxy };
}

function handleAuctionError(res: Response, err: unknown): void {
  if (err instanceof AuctionServiceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("[listings-auction-http]", err);
  res.status(500).json({ error: "internal" });
}

export function mountListingsAuctionHttp(app: import("express").Application): void {
  app.get("/listings/:id/auction/state", async (req: AuthedAuctionRequest, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    try {
      const viewer = (req.get("x-user-id") || "").trim() || null;
      const data = await getAuctionStateForListing(validation.value, viewer);
      res.json(data);
    } catch (e) {
      handleAuctionError(res, e);
    }
  });

  app.get("/listings/:id/auction/bids", async (req: AuthedAuctionRequest, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    try {
      const viewer = (req.get("x-user-id") || "").trim() || null;
      const data = await listAuctionBids(validation.value, viewer);
      res.json(data);
    } catch (e) {
      handleAuctionError(res, e);
    }
  });

  app.post("/listings/:id/auction/bids", requireUser, async (req: AuthedAuctionRequest, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const { amountCents, maxBidCents, useProxy } = parseBidCents(body);
    try {
      const data = await placeAuctionBid({
        listingId: validation.value,
        bidderUserId: String(req.userId),
        amountCents,
        maxBidCents,
        useProxy,
      });
      res.status(201).json(data);
    } catch (e) {
      handleAuctionError(res, e);
    }
  });

  app.post("/listings/:id/auction/close", requireUser, async (req: AuthedAuctionRequest, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    const force =
      req.query.force === "1" ||
      (req.body && typeof req.body === "object" && (req.body as Record<string, unknown>).force === true);
    try {
      const data = await closeAuction(validation.value, { force: Boolean(force) });
      res.json(data);
    } catch (e) {
      handleAuctionError(res, e);
    }
  });
}
