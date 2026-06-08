/**
 * OBO offer HTTP routes (gateway injects x-user-id from JWT).
 */
import type { NextFunction, Request, Response } from "express";
import { validateListingId } from "./validation.js";
import {
  acceptOffer,
  counterOffer,
  createOffer,
  getOfferById,
  getOfferSettingsForListing,
  listOffersForListing,
  listOffersInbox,
  listOffersMine,
  listOffersMineForListing,
  listOffersSent,
  OfferServiceError,
  rejectOffer,
  withdrawOffer,
} from "./listings-offers-service.js";

export type AuthedOfferRequest = Request & { userId?: string };

function requireUser(req: AuthedOfferRequest, res: Response, next: NextFunction): void {
  const userId = (req.get("x-user-id") || "").trim();
  if (!userId) {
    res.status(401).json({ error: "missing x-user-id" });
    return;
  }
  req.userId = userId;
  next();
}

function parseAmountCents(body: Record<string, unknown>): number | null {
  if (body.amountCents != null) {
    const n = Number(body.amountCents);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  if (body.amount_cents != null) {
    const n = Number(body.amount_cents);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  if (body.amountDisplay != null || body.amount != null) {
    const raw = String(body.amountDisplay ?? body.amount).replace(/[^0-9.]/g, "");
    const dollars = Number(raw);
    if (Number.isFinite(dollars) && dollars > 0) return Math.round(dollars * 100);
  }
  return null;
}

function handleOfferError(res: Response, err: unknown): void {
  if (err instanceof OfferServiceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("[listings-offers-http]", err);
  res.status(500).json({ error: "internal" });
}

export function mountListingsOffersHttp(app: import("express").Application): void {
  app.use("/offers", requireUser);
  app.get("/offers/mine", async (req: AuthedOfferRequest, res) => {
    try {
      const data = await listOffersMine(String(req.userId));
      res.json(data);
    } catch (e) {
      handleOfferError(res, e);
    }
  });

  app.get("/offers/inbox", async (req: AuthedOfferRequest, res) => {
    try {
      const data = await listOffersInbox(String(req.userId));
      res.json(data);
    } catch (e) {
      handleOfferError(res, e);
    }
  });

  app.get("/offers/sent", async (req: AuthedOfferRequest, res) => {
    try {
      const data = await listOffersSent(String(req.userId));
      res.json(data);
    } catch (e) {
      handleOfferError(res, e);
    }
  });

  app.get("/offers/:offerId", async (req: AuthedOfferRequest, res) => {
    try {
      const data = await getOfferById(req.params.offerId, String(req.userId));
      res.json(data);
    } catch (e) {
      handleOfferError(res, e);
    }
  });

  app.post("/listings/:id/offers", requireUser, async (req: AuthedOfferRequest, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const amountCents = parseAmountCents(body);
    if (amountCents == null || amountCents <= 0) {
      res.status(400).json({ error: "invalid amount" });
      return;
    }
    try {
      const data = await createOffer({
        listingId: validation.value,
        buyerUserId: String(req.userId),
        amountCents,
        message: body.message != null ? String(body.message) : undefined,
      });
      res.status(201).json(data);
    } catch (e) {
      handleOfferError(res, e);
    }
  });

  app.get("/listings/:id/offers/settings", requireUser, async (req: AuthedOfferRequest, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    try {
      const data = await getOfferSettingsForListing(validation.value, String(req.userId));
      res.json(data);
    } catch (e) {
      handleOfferError(res, e);
    }
  });

  app.get("/listings/:id/offers/mine", requireUser, async (req: AuthedOfferRequest, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    try {
      const data = await listOffersMineForListing(validation.value, String(req.userId));
      res.json(data);
    } catch (e) {
      handleOfferError(res, e);
    }
  });

  app.get("/listings/:id/offers", requireUser, async (req: AuthedOfferRequest, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    try {
      const data = await listOffersForListing(validation.value, String(req.userId));
      res.json(data);
    } catch (e) {
      handleOfferError(res, e);
    }
  });

  app.post(
    "/listings/:id/offers/:offerId/withdraw",
    requireUser,
    async (req: AuthedOfferRequest, res) => {
      try {
        const data = await withdrawOffer(req.params.offerId, String(req.userId));
        res.json(data);
      } catch (e) {
        handleOfferError(res, e);
      }
    },
  );

  app.post(
    "/listings/:id/offers/:offerId/accept",
    requireUser,
    async (req: AuthedOfferRequest, res) => {
      try {
        const data = await acceptOffer(req.params.offerId, String(req.userId));
        res.json(data);
      } catch (e) {
        handleOfferError(res, e);
      }
    },
  );

  app.post(
    "/listings/:id/offers/:offerId/reject",
    requireUser,
    async (req: AuthedOfferRequest, res) => {
      try {
        const data = await rejectOffer(req.params.offerId, String(req.userId));
        res.json(data);
      } catch (e) {
        handleOfferError(res, e);
      }
    },
  );

  app.post(
    "/listings/:id/offers/:offerId/decline",
    requireUser,
    async (req: AuthedOfferRequest, res) => {
      try {
        const data = await rejectOffer(req.params.offerId, String(req.userId));
        res.json(data);
      } catch (e) {
        handleOfferError(res, e);
      }
    },
  );

  app.post(
    "/listings/:id/offers/:offerId/counter",
    requireUser,
    async (req: AuthedOfferRequest, res) => {
      const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const amountCents = parseAmountCents(body);
      if (amountCents == null || amountCents <= 0) {
        res.status(400).json({ error: "invalid amount" });
        return;
      }
      try {
        const data = await counterOffer({
          offerId: req.params.offerId,
          sellerUserId: String(req.userId),
          amountCents,
          message: body.message != null ? String(body.message) : undefined,
        });
        res.json(data);
      } catch (e) {
        handleOfferError(res, e);
      }
    },
  );
}
