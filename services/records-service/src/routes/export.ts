import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import type { PrismaClient } from "../../generated/records-client";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type AuthedReq = Request & { userId?: string; userEmail?: string };

function asyncHandler(
  fn: (req: AuthedReq, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthedReq, res, next)).catch(next);
  };
}

function toCsv(rows: any[]) {
  const headers = [
    "id",
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
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
  };
  const body = [headers.join(",")]
    .concat(
      rows.map((row) =>
        headers
          .map((h) => {
            const v = row[h] ?? row[h as keyof typeof row];
            return esc(v);
          })
          .join(",")
      )
    )
    .join("\n");
  return body;
}

function s3() {
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

export function exportRouter(prisma: PrismaClient): Router {
  const r = Router();

  // GET /records/export.csv → stream CSV directly
  r.get(
    "/export.csv",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedReq).userId!;
      const data = await prisma.record.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
      });

      const csv = toCsv(data);
      const filename = `records-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    })
  );

  // POST /records/export → upload CSV to S3 and return presigned GET url
  r.post(
    "/export",
    asyncHandler(async (req, res) => {
      const bucket = process.env.S3_BUCKET;
      if (!bucket) return res.status(503).json({ error: "S3 not configured" });

      const userId = (req as AuthedReq).userId!;
      const data = await prisma.record.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
      });
      const csv = toCsv(data);

      const key = `${userId}/exports/${Date.now()}-records.csv`;
      const client = s3();

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: csv,
          ContentType: "text/csv",
        })
      );

      // presign GET so user can download
      const presign_get = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: 60 }
      );

      res.json({ bucket, key, presign_get });
    })
  );

  return r;
}
