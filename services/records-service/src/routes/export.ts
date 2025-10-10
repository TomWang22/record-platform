import {
  Router,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from "express";
import type { PrismaClient } from "../../generated/records-client";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

function makeS3() {
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const region = process.env.S3_REGION || "auto";
  const forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE || "").toLowerCase() === "true";
  return new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    },
  });
}

function toCsv(rows: any[]) {
  const headers = [
    "id",
    "userId",
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
    "purchasedAt",
    "pricePaid",
    "notes",
    "createdAt",
    "updatedAt",
  ];

  const escape = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
  };

  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      headers
        .map((h) =>
          escape(
            h === "purchasedAt" || h === "createdAt" || h === "updatedAt"
              ? r[h]?.toISOString?.() ?? r[h] ?? ""
              : r[h]
          )
        )
        .join(",")
    );
  }
  return lines.join("\n");
}

/**
 * Exports:
 *  - GET  /records/export.csv → stream CSV directly
 *  - POST /records/export     → write CSV to S3 (if configured) and return { bucket, key, presign_get }
 */
export default function exportRouter(prisma: PrismaClient) {
  const r = Router();

  // Direct CSV download
  r.get(
    "/export.csv",
    asyncHandler(async (req, res) => {
      const uid = requireUid(req, res);
      if (!uid) return;

      const rows = await prisma.record.findMany({
        where: { userId: uid },
        orderBy: { updatedAt: "desc" },
        take: 10_000,
      });

      const csv = toCsv(rows);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="records.csv"`);
      res.send(csv);
    })
  );

  // Upload to S3
  r.post(
    "/export",
    asyncHandler(async (req, res) => {
      const uid = requireUid(req, res);
      if (!uid) return;

      const bucket = process.env.S3_BUCKET;
      if (!bucket) {
        res
          .status(500)
          .json({ error: "S3_BUCKET not configured (use GET /records/export.csv for direct download)" });
        return;
      }

      const rows = await prisma.record.findMany({
        where: { userId: uid },
        orderBy: { updatedAt: "desc" },
        take: 50_000,
      });

      const csv = toCsv(rows);
      const key = `exports/${uid}/${Date.now()}-records.csv`;
      const client = makeS3();

      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: csv, ContentType: "text/csv" })
      );

      const presign_get = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: 300 }
      );

      res.json({ bucket, key, presign_get });
    })
  );

  return r;
}
