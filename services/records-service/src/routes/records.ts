import {
  Router,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from "express";
import type { PrismaClient } from "../../generated/records-client";

type AuthedReq = Request & { userId?: string; userEmail?: string };

/** Keep types independent of Prisma.$Enums so older client typings work */
type Condition =
  | "M" | "NM" | "NM_MINUS"
  | "EX_PLUS" | "EX" | "EX_MINUS"
  | "VG_PLUS" | "VG" | "VG_MINUS"
  | "G_PLUS" | "G" | "G_MINUS"
  | "F" | "P";

type MediumKind = "VINYL" | "CD" | "CASSETTE" | "OTHER";

// ----------------- helpers -----------------
function asyncHandler(
  fn: (req: AuthedReq, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthedReq, res, next)).catch(next);
  };
}

const GRADE_IN: Record<string, Condition> = {
  M: "M",
  NM: "NM",
  "M-": "NM",
  "NM-": "NM_MINUS",
  "EX+": "EX_PLUS",
  EX: "EX",
  "EX-": "EX_MINUS",
  "VG+": "VG_PLUS",
  VG: "VG",
  "VG-": "VG_MINUS",
  "G+": "G_PLUS",
  G: "G",
  "G-": "G_MINUS",
  F: "F",
  P: "P",
};
function normGrade(x: unknown): Condition | undefined {
  if (typeof x !== "string") return undefined;
  const key = x.trim().toUpperCase();
  return GRADE_IN[key];
}

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// shape & normalize incoming payload (top level + nested mediaPieces)
function pickUpdate(body: any) {
  const allow = [
    "artist",
    "name",
    "format",
    "catalogNumber",
    "notes",
    "purchasedAt",
    "pricePaid",
    "isPromo",

    // presence flags
    "hasInsert",
    "hasBooklet",
    "hasObiStrip",
    "hasFactorySleeve",

    // top-level grades
    "recordGrade",
    "sleeveGrade",

    // extra paper bits grades
    "insertGrade",
    "bookletGrade",
    "obiStripGrade",
    "factorySleeveGrade",

    // nested pieces
    "mediaPieces",
  ] as const;

  const out: any = {};
  for (const k of allow) if ((body as any)[k] !== undefined) out[k] = (body as any)[k];

  if (typeof out.purchasedAt === "string") {
    const d = new Date(out.purchasedAt);
    if (!Number.isNaN(+d)) out.purchasedAt = d;
  }
  if (out.pricePaid != null) out.pricePaid = String(out.pricePaid);

  ["hasInsert", "hasBooklet", "hasObiStrip", "hasFactorySleeve", "isPromo"].forEach((k) => {
    if (typeof out[k] === "string") out[k] = out[k] === "true";
  });

  const gradeKeys = [
    "recordGrade",
    "sleeveGrade",
    "insertGrade",
    "bookletGrade",
    "obiStripGrade",
    "factorySleeveGrade",
  ] as const;
  for (const k of gradeKeys) {
    if (out[k] !== undefined) {
      const g = normGrade(out[k]);
      if (!g) throw Object.assign(new Error(`invalid grade for ${k}`), { status: 400 });
      out[k] = g;
    }
  }

  if (Array.isArray(out.mediaPieces)) {
    out.mediaPieces = out.mediaPieces.map((p: any, i: number) => {
      const idx = Number(p.index ?? i + 1);
      const kindKey = String(p.kind ?? "").toUpperCase();
      const kind: MediumKind | undefined =
        ["VINYL", "CD", "CASSETTE", "OTHER"].includes(kindKey)
          ? (kindKey as MediumKind)
          : undefined;

      const discGrade = p.discGrade !== undefined ? normGrade(p.discGrade) : undefined;

      let sides = undefined as any;
      if (p.sides && typeof p.sides === "object") {
        sides = {};
        for (const [side, val] of Object.entries(p.sides)) {
          const g = normGrade(val as string);
          if (!g) throw Object.assign(new Error(`invalid grade for sides.${side}`), { status: 400 });
          (sides as any)[side] = g;
        }
      }

      return {
        index: idx,
        kind,
        sizeInch: p.sizeInch != null ? Number(p.sizeInch) : null,
        speedRpm: p.speedRpm != null ? Number(p.speedRpm) : null,
        discGrade: discGrade ?? null,
        sides: sides ?? null, // stored as JSON
        notes: p.notes ?? null,
      };
    });

    // quick validation
    const seen = new Set<number>();
    for (const p of out.mediaPieces) {
      if (!p.kind) throw Object.assign(new Error("mediaPieces.kind required"), { status: 400 });
      if (seen.has(p.index))
        throw Object.assign(new Error("mediaPieces.index must be unique"), { status: 400 });
      seen.add(p.index);
    }
  }

  return out;
}

// ----------------- router -----------------
export function recordsRouter(prisma: PrismaClient): Router {
  const r = Router();
  // Use a permissive handle so TS stops complaining about include: never
  const db = prisma as any;

  // GET /records
  r.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedReq).userId!;
      const items = await db.record.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: { mediaPieces: true },
      });
      res.json(items);
    })
  );

  // POST /records
  r.post(
    "/",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedReq).userId!;
      if (!userId || !UUID_RX.test(userId)) return res.status(401).json({ error: "auth required" });

      const { artist, name, format } = req.body ?? {};
      if (!artist || !name || !format)
        return res.status(400).json({ error: "artist, name, format are required" });

      const patch = pickUpdate(req.body);

      const created = await db.record.create({
        data: {
          userId,
          artist: String(patch.artist ?? artist),
          name: String(patch.name ?? name),
          format: String(patch.format ?? format),

          catalogNumber: patch.catalogNumber ?? null,
          notes: patch.notes ?? null,
          purchasedAt: patch.purchasedAt ?? null,
          pricePaid: patch.pricePaid ?? null,
          isPromo: !!patch.isPromo,

          hasInsert: !!patch.hasInsert,
          hasBooklet: !!patch.hasBooklet,
          hasObiStrip: !!patch.hasObiStrip,
          hasFactorySleeve: !!patch.hasFactorySleeve,

          recordGrade: patch.recordGrade ?? null,
          sleeveGrade: patch.sleeveGrade ?? null,
          insertGrade: patch.insertGrade ?? null,
          bookletGrade: patch.bookletGrade ?? null,
          obiStripGrade: patch.obiStripGrade ?? null,
          factorySleeveGrade: patch.factorySleeveGrade ?? null,

          ...(patch.mediaPieces?.length
            ? { mediaPieces: { create: patch.mediaPieces } }
            : {}),
        },
        include: { mediaPieces: true },
      });

      res.status(201).json(created);
    })
  );

  // PUT /records/:id (replace mediaPieces if provided)
  r.put(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedReq).userId!;
      const id = req.params.id;

      const existing = await db.record.findUnique({
        where: { id },
        include: { mediaPieces: true },
      });
      if (!existing || existing.userId !== userId)
        return res.status(404).json({ error: "not found" });

      const patch = pickUpdate(req.body);
      const { mediaPieces, ...recordData } = patch;

      await db.record.update({
        where: { id },
        data: {
          ...recordData,
          ...(Array.isArray(mediaPieces)
            ? {
                mediaPieces: {
                  deleteMany: {}, // wipe existing
                  create: mediaPieces, // recreate set
                },
              }
            : {}),
        },
      });

      const fresh = await db.record.findUnique({
        where: { id },
        include: { mediaPieces: true },
      });
      res.json(fresh);
    })
  );

  // DELETE /records/:id
  r.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedReq).userId!;
      const id = req.params.id;

      const existing = await prisma.record.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId)
        return res.status(404).json({ error: "not found" });

      await prisma.record.delete({ where: { id } });
      res.status(204).end();
    })
  );

  return r;
}
