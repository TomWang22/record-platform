import {
  Router,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from "express";
import type { PrismaClient } from "../../generated/records-client";
import {
  normalizeGradeLoose,
  normalizeMediaPiece,
  deriveOverallGrade,
} from "../lib/grades";
import { normalizeKindInfo, type Kind } from "../lib/kind";
import type Redis from "ioredis";
import {
  cached,
  makeSearchKey,
  normalizeQ,
  invalidateSearchKeysForUser,
} from "../lib/cache";

type AuthedReq = Request & { userId?: string; userEmail?: string };

const DEBUG_ROUTES =
  process.env.DEBUG_ROUTES === "1" || process.env.DEBUG_ROUTES === "true";

function asyncHandler(
  fn: (req: AuthedReq, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthedReq, res, next)).catch((err) => {
      // surface real cause in logs while still returning {error:"internal"}
      console.error("[route error]", req.method, req.path, err);
      next(err);
    });
  };
}

// Strict UUID (v1–v5) and a reusable string for route regex
const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_ROUTE =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";

function requireUserId(req: AuthedReq, res: Response): string | undefined {
  // trust upstream if present
  let userId = req.userId;
  // fallback: accept x-user-id header for tools/curl
  if (!userId) {
    const hdr = req.get("x-user-id");
    if (hdr && UUID_RX.test(hdr)) userId = hdr;
  }
  if (!userId || !UUID_RX.test(userId)) {
    res.status(401).json({ error: "auth required" });
    return undefined;
  }
  return userId;
}

/** Deeply convert BigInt → number (if safe) or string */
function debigint<T>(v: T): T {
  const seen = new WeakSet();
  const walk = (x: any): any => {
    if (x === null || typeof x !== "object") {
      if (typeof x === "bigint") {
        const abs = x < 0n ? -x : x;
        return abs <= 9007199254740991n ? Number(x) : x.toString();
      }
      return x;
    }
    if (seen.has(x)) return x;
    seen.add(x);
    if (Array.isArray(x)) return x.map(walk);
    const out: any = {};
    for (const k of Object.keys(x)) out[k] = walk((x as any)[k]);
    return out;
  };
  return walk(v);
}

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
    "hasInsert",
    "hasBooklet",
    "hasObiStrip",
    "hasFactorySleeve",
    "recordGrade",
    "sleeveGrade",
    "insertGrade",
    "bookletGrade",
    "obiStripGrade",
    "factorySleeveGrade",
    "releaseYear",
    "releaseDate",
    "pressingYear",
    "label",
    "labelCode",
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

  ["hasInsert", "hasBooklet", "hasObiStrip", "hasFactorySleeve", "isPromo"].forEach(
    (k) => {
      if (typeof out[k] === "string") out[k] = out[k] === "true";
    }
  );

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
      const g = normalizeGradeLoose(out[k]);
      if (out[k] != null && !g)
        throw Object.assign(new Error(`invalid grade for ${k}`), {
          status: 400,
        });
      out[k] = g;
    }
  }

  if (Array.isArray(out.mediaPieces)) {
    out.mediaPieces = out.mediaPieces.map((p: any, i: number) => {
      const idx = Number(p.index ?? i + 1);
      const info = normalizeKindInfo(p.kind);
      const kind: Kind = info.kind;

      const normalized = normalizeMediaPiece(
        { index: idx, discGrade: p.discGrade ?? null, sides: p.sides ?? null },
        { autoSideLetters: true }
      );

      const sizeInch =
        p.sizeInch != null ? Number(p.sizeInch) : info.sizeInchHint ?? null;
      const speedRpm =
        p.speedRpm != null ? Number(p.speedRpm) : info.speedRpmHint ?? null;

      return {
        index: idx,
        kind,
        sizeInch,
        speedRpm,
        discGrade: normalized.discGrade ?? null,
        sides: normalized.sides ?? null,
        notes: p.notes ?? null,
        __formatHint: info.formatHint ?? undefined,
      };
    });

    const seen = new Set<number>();
    for (const p of out.mediaPieces) {
      if (!p.kind)
        throw Object.assign(new Error("mediaPieces.kind required"), {
          status: 400,
        });
      if (seen.has(p.index))
        throw Object.assign(new Error("mediaPieces.index must be unique"), {
          status: 400,
        });
      seen.add(p.index);
    }
  }

  return out;
}

export function recordsRouter(
  prisma: PrismaClient,
  redis?: Redis | null
): Router {
  const r = Router();
  const db = prisma as any;

  // -------------------- DEBUG ROUTES (registered FIRST) --------------------
  if (DEBUG_ROUTES) {
    const logDbg = (...args: any[]) => console.log("[records dbg]", ...args);

    // show every request that hits this router (after app-level requireUser)
    r.use((req: AuthedReq, _res: Response, next: NextFunction) => {
      logDbg(req.method, req.path);
      next();
    });

    // simple sanity check (still requires x-user-id because of app-level requireUser)
    r.get("/__ok", (_req: AuthedReq, res: Response) =>
      res.json({ ok: true, in: "recordsRouter" })
    );

    // minimal whoami (only SELECT current_user) with friendly errors
    r.get(
      "/__whoami",
      asyncHandler(async (req, res) => {
        const userId = requireUserId(req as AuthedReq, res);
        if (!userId) return;

        try {
          const [row] = await (prisma as any).$queryRaw<{ current_user: string }[]>`
            SELECT current_user
          `;
          const dbUser = row?.current_user ?? null;
          res.json({ ok: true, userId, db_user: dbUser, debug: true });
        } catch (e: any) {
          res
            .status(200)
            .json({
              ok: false,
              step: "select_current_user",
              error: e?.message || String(e),
            });
        }
      })
    );

    // full diagnostics; each step isolated; never throws
    r.get(
      "/__diag",
      asyncHandler(async (req, res) => {
        const userId = requireUserId(req as AuthedReq, res);
        if (!userId) return;

        const out: any = { ok: true, userId, steps: {} };

        try {
          const [who] = await (prisma as any).$queryRaw<{ current_user: string }[]>`
            SELECT current_user
          `;
          out.steps.select_current_user = { ok: true, current_user: who?.current_user ?? null };
        } catch (e: any) {
          out.steps.select_current_user = { ok: false, error: e?.message || String(e) };
        }

        try {
          const [sp] = await (prisma as any).$queryRaw<{ setting: string }[]>`
            SHOW search_path
          `;
          out.steps.show_search_path = { ok: true, search_path: sp?.setting ?? null };
        } catch (e: any) {
          out.steps.show_search_path = { ok: false, error: e?.message || String(e) };
        }

        res.json(out);
      })
    );

    r.get("/__echo", (req: AuthedReq, res: Response) => {
      res.json({
        header_user: req.get("x-user-id") ?? null,
        req_user: req.userId ?? null,
        debug: true,
      });
    });
  }

  // ------------------------------ LIST -------------------------------------
  r.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req as AuthedReq, res);
      if (!userId) return;
      const items = await db.record.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: { mediaPieces: { orderBy: { index: "asc" } } },
      });
      res.json(items);
    })
  );

  // ------------------------------ SEARCH -----------------------------------
  r.get(
    "/search",
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req as AuthedReq, res);
      if (!userId) return;

      const qRaw = String(req.query.q ?? "");
      const qNorm = normalizeQ(qRaw);
      const fuzzy = String(req.query.fuzzy ?? "0") === "1";
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100)));
      const offset = Math.max(0, Number(req.query.offset ?? 0));
      if (!qNorm) return res.json([]);

      const short = qNorm.length <= 3;
      const ttlMs = short
        ? Number(process.env.CACHE_TTL_MS_SHORT ?? 15000)
        : Number(process.env.CACHE_TTL_MS_LONG ?? 60000);

      const key = makeSearchKey(userId, qNorm, fuzzy, limit, offset);

      const result = await cached(redis ?? null, key, ttlMs, async () => {
        if (fuzzy) {
          type RankedRow = { id: string; rank: number };
          type Item = { id: string };

          const ranked = await (prisma as any).$queryRaw<RankedRow[]>`
            SELECT id, rank
            FROM public.search_records_fuzzy_ids(
              CAST(${userId} AS uuid),
              CAST(${qRaw}   AS text),
              CAST(${limit}  AS bigint),
              CAST(${offset} AS bigint)
            )
          `;

          const ids: string[] = ranked.map((row: RankedRow) => row.id);
          if (ids.length === 0) return [];

          const items: Item[] = await db.record.findMany({
            where: { userId, id: { in: ids } },
            include: { mediaPieces: { orderBy: { index: "asc" } } },
          });

          const pos = new Map<string, number>(
            ids.map((id: string, i: number): [string, number] => [id, i])
          );

          items.sort(
            (a: Item, b: Item) =>
              (pos.get(a.id) ?? Number.POSITIVE_INFINITY) -
              (pos.get(b.id) ?? Number.POSITIVE_INFINITY)
          );

          return items;
        }

        // non-fuzzy path
        return db.record.findMany({
          where: {
            userId,
            OR: [
              { artist: { contains: qRaw, mode: "insensitive" } },
              { name: { contains: qRaw, mode: "insensitive" } },
              { catalogNumber: { contains: qRaw, mode: "insensitive" } },
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
          include: { mediaPieces: { orderBy: { index: "asc" } } },
        });
      });

      res.json(debigint(result));
    })
  );

  // --------------------------- AUTOCOMPLETE --------------------------------
  r.get(
    "/search/autocomplete",
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req as AuthedReq, res);
      if (!userId) return;

      const fieldRaw = String(req.query.field ?? "artist").toLowerCase();
      const field: "artist" | "label" | "catalog" =
        fieldRaw === "label" || fieldRaw === "catalog" ? fieldRaw : "artist";
      const qRaw = String(req.query.q ?? "");
      const k = Math.min(50, Math.max(1, Number(req.query.k ?? 10)));
      if (!qRaw) return res.json([]);

      const short = normalizeQ(qRaw).length <= 2;
      const key = `records:ac:${userId}:${field}:${normalizeQ(qRaw)}:${k}`;
      const ttlMs = short ? 5_000 : 15_000;

      type Row = { term: string; hits: number | bigint; dist: number };
      const rows = await cached(redis ?? null, key, ttlMs, async () => {
        const out = await (prisma as any).$queryRaw<Row[]>`
          SELECT term, hits, dist
          FROM public.search_autocomplete(
            CAST(${userId} AS uuid),
            CAST(${qRaw}   AS text),
            CAST(${k}      AS int),
            CAST(${field}  AS text)
          )
        `;
        return debigint(out).map((r: any) => ({
          term: r.term,
          hits: r.hits as number,
          dist: r.dist as number,
        }));
      });

      res.json(rows);
    })
  );

  // ------------------------------ FACETS -----------------------------------
  r.get(
    "/search/facets",
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req as AuthedReq, res);
      if (!userId) return;

      const qRaw = String(req.query.q ?? "");
      if (!qRaw) return res.json({ format: [], label: [], year: [] });

      const key = `records:facets:${userId}:${normalizeQ(qRaw)}`;
      const ttlMs = 30_000;

      const payload = await cached(redis ?? null, key, ttlMs, async () => {
        const [row] = await (prisma as any).$queryRaw<any>`
          SELECT public.search_facets(CAST(${userId} AS uuid), CAST(${qRaw} AS text))
        `;
        return row?.search_facets ?? row?.jsonb_build_object ?? {};
      });

      res.json(payload);
    })
  );

  // --------------------------- PRICE STATS ---------------------------------
  r.get(
    "/search/price-stats",
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req as AuthedReq, res);
      if (!userId) return;

      const qRaw = String(req.query.q ?? "");
      if (!qRaw)
        return res.json({
          n: 0,
          min: null,
          p50: null,
          avg: null,
          p90: null,
          max: null,
        });

      const key = `records:pricestats:${userId}:${normalizeQ(qRaw)}`;
      const ttlMs = 60_000;

      type Row = {
        n: number | bigint;
        min: string | null;
        p50: string | null;
        avg: string | null;
        p90: string | null;
        max: string | null;
      };

      const stats = await cached(redis ?? null, key, ttlMs, async () => {
        const [r1] = await (prisma as any).$queryRaw<Row[]>`
          SELECT * FROM public.search_price_stats(CAST(${userId} AS uuid), CAST(${qRaw} AS text))
        `;
        if (!r1) return { n: 0, min: null, p50: null, avg: null, p90: null, max: null };
        const toNum = (v: string | null) => (v == null ? null : Number(v));
        const nNum = typeof r1.n === "bigint" ? Number(r1.n) : r1.n;
        return {
          n: nNum,
          min: toNum(r1.min),
          p50: toNum(r1.p50),
          avg: toNum(r1.avg),
          p90: toNum(r1.p90),
          max: toNum(r1.max),
        };
      });

      res.json(stats);
    })
  );

  // ------------------------------- RECENT ----------------------------------
  r.get(
    "/recent",
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req as AuthedReq, res);
      if (!userId) return;

      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
      const items = await (prisma as any).$queryRaw<any[]>`
        SELECT * FROM public.records_recent(CAST(${userId} AS uuid), CAST(${limit} AS int))
      `;
      res.json(items);
    })
  );

  // ---------------------------- UPSERT ALIASES ------------------------------
  r.post(
    "/:id(" + UUID_ROUTE + ")/aliases",
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req as AuthedReq, res);
      if (!userId) return;

      const id = req.params.id;
      const { terms } = (req.body ?? {}) as { terms?: string[] };

      if (!Array.isArray(terms) || terms.length === 0)
        return res.status(400).json({ error: "terms[] required" });

      const existing = await db.record.findFirst({ where: { id, userId } });
      if (!existing) return res.status(404).json({ error: "not found" });

      const [row] = await (prisma as any).$queryRaw<
        { upsert_aliases: number | bigint }[]
      >`
        SELECT records.upsert_aliases(CAST(${id} AS uuid), ${terms}::text[])
      `;

      await (prisma as any).$executeRawUnsafe(
        "SELECT records.refresh_aliases_mv_concurrent()"
      );

      await invalidateSearchKeysForUser(redis ?? null, userId);

      const added =
        row && typeof row.upsert_aliases === "bigint"
          ? Number(row.upsert_aliases)
          : (row?.upsert_aliases ?? 0);

      res.json({ added });
    })
  );

  // ------------------------------- GET BY ID --------------------------------
  r.get(
    "/:id(" + UUID_ROUTE + ")",
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req as AuthedReq, res);
      if (!userId) return;

      const id = req.params.id;
      const rec = await db.record.findFirst({
        where: { id, userId },
        include: { mediaPieces: { orderBy: { index: "asc" } } },
      });
      if (!rec) return res.status(404).json({ error: "not found" });
      res.json(rec);
    })
  );

  // -------------------------------- CREATE ---------------------------------
  r.post(
    "/",
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req as AuthedReq, res);
      if (!userId) return;

      const { artist, name, format } = req.body ?? {};
      if (!artist || !name || !format)
        return res
          .status(400)
          .json({ error: "artist, name, format are required" });

      const patch = pickUpdate(req.body);

      let formatFinal = String(patch.format ?? format);
      if (!patch.format && Array.isArray(patch.mediaPieces)) {
        const first = patch.mediaPieces[0];
        if (first?.__formatHint === "EP") formatFinal = "EP";
      }

      if (
        patch.recordGrade == null &&
        Array.isArray(patch.mediaPieces) &&
        patch.mediaPieces.length
      ) {
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
          releaseYear: patch.releaseYear ?? null,
          releaseDate: patch.releaseDate ?? null,
          pressingYear: patch.pressingYear ?? null,
          label: patch.label ?? null,
          labelCode: patch.labelCode ?? null,
          ...(patch.mediaPieces?.length
            ? {
                mediaPieces: {
                  create: patch.mediaPieces.map((p: any) => {
                    const { __formatHint, ...rest } = p;
                    return rest;
                  }),
                },
              }
            : {}),
        },
        include: { mediaPieces: { orderBy: { index: "asc" } } },
      });

      await invalidateSearchKeysForUser(redis ?? null, userId);

      res.status(201).json(created);
    })
  );

  // -------------------------------- UPDATE ---------------------------------
  r.put(
    "/:id(" + UUID_ROUTE + ")",
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req as AuthedReq, res);
      if (!userId) return;

      const id = req.params.id;

      const existing = await db.record.findUnique({
        where: { id },
        include: { mediaPieces: true },
      });
      if (!existing || existing.userId !== userId)
        return res.status(404).json({ error: "not found" });

      const patch = pickUpdate(req.body);
      const { mediaPieces, ...recordData } = patch;

      let formatUpdate: string | undefined;
      if (
        !("format" in recordData) &&
        Array.isArray(mediaPieces) &&
        mediaPieces.length
      ) {
        const first = mediaPieces[0];
        if (first?.__formatHint === "EP") formatUpdate = "EP";
      }

      if (
        !("recordGrade" in recordData) &&
        Array.isArray(mediaPieces) &&
        mediaPieces.length
      ) {
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
                  deleteMany: {},
                  create: mediaPieces.map((p: any) => {
                    const { __formatHint, ...rest } = p;
                    return rest;
                  }),
                },
              }
            : {}),
        },
      });

      await invalidateSearchKeysForUser(redis ?? null, userId);

      const fresh = await db.record.findFirst({
        where: { id, userId },
        include: { mediaPieces: { orderBy: { index: "asc" } } },
      });
      res.json(fresh);
    })
  );

  // -------------------------------- DELETE ---------------------------------
  r.delete(
    "/:id(" + UUID_ROUTE + ")",
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req as AuthedReq, res);
      if (!userId) return;

      const id = req.params.id;

      const existing = await db.record.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId)
        return res.status(404).json({ error: "not found" });

      await db.record.delete({ where: { id } });
      await invalidateSearchKeysForUser(redis ?? null, userId);
      res.status(204).end();
    })
  );

  // --------------------------- Router error handler -------------------------
  r.use((err: any, _req: AuthedReq, res: Response, _next: NextFunction) => {
    const status = typeof err?.status === "number" ? err.status : 500;
    const message = err?.message || String(err);
    if (DEBUG_ROUTES) console.error("[records router error]", message);
    res.status(status).json({ error: DEBUG_ROUTES ? message : "internal" });
  });

  return r;
}
