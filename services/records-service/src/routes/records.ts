import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import type { PrismaClient } from "../../generated/records-client";

type AuthedReq = Request & { userId?: string; userEmail?: string };

// wrap async handlers so TS is happy and errors go to Express
function asyncHandler(
  fn: (req: AuthedReq, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthedReq, res, next)).catch(next);
  };
}

function pickUpdate(body: any) {
  // allow updating these fields
  const allow = [
    "artist",
    "name",
    "format",
    "catalogNumber",
    "recordGrade",
    "sleeveGrade",
    "hasInsert",
    "hasBooklet",
    "hasObiStrip",
    "hasFactorySleeve",
    "isPromo",
    "notes",
    "purchasedAt",
    "pricePaid",
  ] as const;

  const out: any = {};
  for (const k of allow) {
    if (body[k] !== undefined) out[k] = body[k];
  }

  // normalize a couple of fields
  if (out.purchasedAt && typeof out.purchasedAt === "string") {
    const d = new Date(out.purchasedAt);
    if (!isNaN(+d)) out.purchasedAt = d;
  }
  if (out.pricePaid != null) {
    // Prisma Decimal accepts string/number; pass string for safety
    out.pricePaid = String(out.pricePaid);
  }
  return out;
}

export function recordsRouter(prisma: PrismaClient): Router {
  const r = Router();

  // GET /records → list latest 100 for this user
  r.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedReq).userId!;
      const items = await prisma.record.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 100,
      });
      res.json(items);
    })
  );

  // POST /records → create
  r.post(
    "/",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedReq).userId!;
      const { artist, name, format } = req.body ?? {};
      if (!artist || !name || !format) {
        return res.status(400).json({ error: "artist, name, format are required" });
      }
      const data = pickUpdate({ ...req.body, userId });
      data.userId = userId;

      const created = await prisma.record.create({ data });
      res.status(201).json(created);
    })
  );

  // PUT /records/:id → update if owned
  r.put(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedReq).userId!;
      const id = req.params.id;

      const existing = await prisma.record.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "not found" });
      }

      const data = pickUpdate(req.body);
      const updated = await prisma.record.update({ where: { id }, data });
      res.json(updated);
    })
  );

  // DELETE /records/:id → delete if owned
  r.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedReq).userId!;
      const id = req.params.id;

      const existing = await prisma.record.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "not found" });
      }

      await prisma.record.delete({ where: { id } });
      res.status(204).end();
    })
  );

  return r;
}
