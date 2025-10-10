import {
  Router,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from "express";
import type { PrismaClient } from "../../generated/records-client";

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

function requireUid(req: Request, res: Response): string | undefined {
  const raw = req.headers["x-user-id"];
  const uid = typeof raw === "string" ? raw : undefined;
  if (!uid) res.status(401).json({ error: "auth required" });
  return uid;
}

export function recordsRouter(prisma: PrismaClient) {
  const r = Router();

  // GET /records → list records for user (latest 100)
  r.get(
    "/",
    asyncHandler(async (req, res) => {
      const uid = requireUid(req, res);
      if (!uid) return;

      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
      const items = await prisma.record.findMany({
        where: { userId: uid },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });
      res.json(items);
    })
  );

  // POST /records → create
  r.post(
    "/",
    asyncHandler(async (req, res) => {
      const uid = requireUid(req, res);
      if (!uid) return;

      const body = (req.body ?? {}) as Record<string, unknown>;
      const artist = body.artist;
      const name = body.name;
      const format = body.format;

      if (typeof artist !== "string" || typeof name !== "string" || typeof format !== "string") {
        res.status(400).json({ error: "artist, name, format are required" });
        return;
      }

      const created = await prisma.record.create({
        data: {
          userId: uid,
          artist,
          name,
          format,
          catalogNumber:
            typeof body.catalogNumber === "string" ? (body.catalogNumber as string) : undefined,
          recordGrade:
            typeof body.recordGrade === "string" ? (body.recordGrade as string) : undefined,
          sleeveGrade:
            typeof body.sleeveGrade === "string" ? (body.sleeveGrade as string) : undefined,
          hasInsert: Boolean(body.hasInsert ?? false),
          hasBooklet: Boolean(body.hasBooklet ?? false),
          hasObiStrip: Boolean(body.hasObiStrip ?? false),
          hasFactorySleeve: Boolean(body.hasFactorySleeve ?? false),
          isPromo: Boolean(body.isPromo ?? false),
          notes: typeof body.notes === "string" ? (body.notes as string) : undefined,
          purchasedAt:
            typeof body.purchasedAt === "string" ? new Date(body.purchasedAt as string) : undefined,
          pricePaid:
            typeof body.pricePaid === "number" || typeof body.pricePaid === "string"
              ? (body.pricePaid as any)
              : undefined,
        },
      });

      res.status(201).json(created);
    })
  );

  // PUT /records/:id → update (must own)
  r.put(
    "/:id",
    asyncHandler(async (req, res) => {
      const uid = requireUid(req, res);
      if (!uid) return;
      const { id } = req.params;

      const result = await prisma.record.updateMany({
        where: { id, userId: uid },
        data: req.body ?? {},
      });

      if (result.count === 0) {
        res.status(404).json({ error: "not found" });
        return;
      }

      const updated = await prisma.record.findFirst({ where: { id, userId: uid } });
      res.json(updated);
    })
  );

  // DELETE /records/:id → delete (must own)
  r.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const uid = requireUid(req, res);
      if (!uid) return;
      const { id } = req.params;

      const result = await prisma.record.deleteMany({ where: { id, userId: uid } });
      if (result.count === 0) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.status(204).end();
    })
  );

  return r;
}
