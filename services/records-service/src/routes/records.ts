import {
  Router, type Request, type Response, type NextFunction, type RequestHandler,
} from "express";
import type { PrismaClient } from "../../generated/records-client";
import { normalizeGradeLoose, normalizeMediaPiece, deriveOverallGrade } from "../lib/grades";
import { normalizeKindInfo, normalizeKind, type Kind } from "../lib/kind";

type AuthedReq = Request & { userId?: string; userEmail?: string };

// ----------------- helpers -----------------
function asyncHandler(
  fn: (req: AuthedReq, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => { Promise.resolve(fn(req as AuthedReq, res, next)).catch(next); };
}

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// shape & normalize incoming payload (top level + nested mediaPieces)
function pickUpdate(body: any) {
  const allow = [
    "artist","name","format","catalogNumber","notes","purchasedAt","pricePaid","isPromo",
    "hasInsert","hasBooklet","hasObiStrip","hasFactorySleeve",
    "recordGrade","sleeveGrade","insertGrade","bookletGrade","obiStripGrade","factorySleeveGrade",
    // NEW metadata:
    "releaseYear","releaseDate","pressingYear","label","labelCode",
    "mediaPieces",
  ] as const;

  const out: any = {};
  for (const k of allow) if (body?.[k] !== undefined) out[k] = body[k];

  if (typeof out.purchasedAt === "string") {
    const d = new Date(out.purchasedAt);
    if (!Number.isNaN(+d)) out.purchasedAt = d;
  }
  if (typeof out.releaseDate === "string") {
    const d = new Date(out.releaseDate);
    if (!Number.isNaN(+d)) out.releaseDate = d;
  }
  if (out.releaseYear != null) out.releaseYear = Number(out.releaseYear);
  if (out.pressingYear != null) out.pressingYear = Number(out.pressingYear);

  if (out.pricePaid != null) out.pricePaid = String(out.pricePaid);

  ["hasInsert","hasBooklet","hasObiStrip","hasFactorySleeve","isPromo"].forEach((k) => {
    if (typeof out[k] === "string") out[k] = out[k] === "true";
  });

  // normalize all top-level grade strings to canonical
  const gradeKeys = [
    "recordGrade","sleeveGrade","insertGrade","bookletGrade","obiStripGrade","factorySleeveGrade",
  ] as const;
  for (const k of gradeKeys) {
    if (out[k] !== undefined) {
      const g = normalizeGradeLoose(out[k]);
      if (out[k] != null && !g) throw Object.assign(new Error(`invalid grade for ${k}`), { status: 400 });
      out[k] = g;
    }
  }

  if (Array.isArray(out.mediaPieces)) {
    out.mediaPieces = out.mediaPieces.map((p: any, i: number) => {
      const idx = Number(p.index ?? i + 1);

      // normalize kind + hints
      const info = normalizeKindInfo(p.kind);
      const kind: Kind = info.kind;

      // normalize per-piece grades + sides (with A/B remap for multi-disc)
      let normalized = normalizeMediaPiece(
        {
          index: idx,
          discGrade: p.discGrade ?? null,
          sides: p.sides ?? null,
        },
        { autoSideLetters: true }
      );

      // size/rpm defaults (use hints only if not provided)
      const sizeInch = p.sizeInch != null ? Number(p.sizeInch) : (info.sizeInchHint ?? null);
      const speedRpm = p.speedRpm != null ? Number(p.speedRpm) : (info.speedRpmHint ?? null);

      return {
        index: idx,
        kind,
        sizeInch,
        speedRpm,
        discGrade: normalized.discGrade ?? null,
        sides: normalized.sides ?? null, // JSON
        notes: p.notes ?? null,
        __formatHint: info.formatHint ?? undefined, // used by caller (not saved)
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
  const db = prisma as any;

  // GET /records
  r.get("/", asyncHandler(async (req, res) => {
    const userId = (req as AuthedReq).userId!;
    const items = await db.record.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { mediaPieces: { orderBy: { index: 'asc' } } },
    });
    res.json(items);
  }));

  // GET /records/:id
  r.get("/:id", asyncHandler(async (req, res) => {
    const userId = (req as AuthedReq).userId!;
    const id = req.params.id;

    const rec = await db.record.findFirst({
      where: { id, userId },
      include: { mediaPieces: { orderBy: { index: 'asc' } } },
    });
    if (!rec) return res.status(404).json({ error: "not found" });
    res.json(rec);
  }));

  // POST /records
  r.post("/", asyncHandler(async (req, res) => {
    const userId = (req as AuthedReq).userId!;
    if (!userId || !UUID_RX.test(userId)) return res.status(401).json({ error: "auth required" });

    const { artist, name, format } = req.body ?? {};
    if (!artist || !name || !format)
      return res.status(400).json({ error: "artist, name, format are required" });

    const patch = pickUpdate(req.body);

    // If mediaPieces imply EP and no explicit format provided, set EP
    let formatFinal = String(patch.format ?? format);
    if (!patch.format && Array.isArray(patch.mediaPieces)) {
      const first = patch.mediaPieces[0];
      if (first?.__formatHint === 'EP') formatFinal = 'EP';
    }

    // If no explicit overall grade, derive from pieces
    if (patch.recordGrade == null && Array.isArray(patch.mediaPieces) && patch.mediaPieces.length) {
      patch.recordGrade = deriveOverallGrade(patch.mediaPieces);
    }

    const created = await db.record.create({
      data: {
        userId,
        artist: String(patch.artist ?? artist),
        name: String(patch.name ?? name),
        format: formatFinal,

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

        // NEW metadata
        releaseYear: patch.releaseYear ?? null,
        releaseDate: patch.releaseDate ?? null,
        pressingYear: patch.pressingYear ?? null,
        label: patch.label ?? null,
        labelCode: patch.labelCode ?? null,

        ...(patch.mediaPieces?.length
          ? { mediaPieces: { create: patch.mediaPieces.map((p: any) => {
                const { __formatHint, ...rest } = p; return rest;
              }) } }
          : {}),
      },
      include: { mediaPieces: { orderBy: { index: 'asc' } } },
    });

    res.status(201).json(created);
  }));

  // PUT /records/:id
  r.put("/:id", asyncHandler(async (req, res) => {
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

    // If mediaPieces imply EP and you didn't send format, keep existing else set EP
    let formatUpdate: string | undefined;
    if (!('format' in recordData) && Array.isArray(mediaPieces) && mediaPieces.length) {
      const first = mediaPieces[0];
      if (first?.__formatHint === 'EP') formatUpdate = 'EP';
    }

    // If no explicit overall grade in this patch but pieces present, derive
    if (!('recordGrade' in recordData) && Array.isArray(mediaPieces) && mediaPieces.length) {
      recordData.recordGrade = deriveOverallGrade(mediaPieces);
    }

    await db.record.update({
      where: { id },
      data: {
        ...recordData,
        ...(formatUpdate ? { format: formatUpdate } : {}),
        ...(Array.isArray(mediaPieces)
          ? {
              mediaPieces: {
                deleteMany: {}, // replace set
                create: mediaPieces.map((p: any) => { const { __formatHint, ...rest } = p; return rest; }),
              },
            }
          : {}),
      },
    });

    const fresh = await db.record.findFirst({
      where: { id, userId },
      include: { mediaPieces: { orderBy: { index: 'asc' } } },
    });
    res.json(fresh);
  }));

  // DELETE /records/:id
  r.delete("/:id", asyncHandler(async (req, res) => {
    const userId = (req as AuthedReq).userId!;
    const id = req.params.id;

    const existing = await prisma.record.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId)
      return res.status(404).json({ error: "not found" });

    await prisma.record.delete({ where: { id } });
    res.status(204).end();
  }));

  return r;
}
