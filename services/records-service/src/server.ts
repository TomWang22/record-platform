/* cspell:ignore healthz */
import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import { PrismaClient } from "../generated/records-client";
import { register, httpCounter } from "@common/utils/metrics";
import { recordsRouter } from "./routes/records";
import { exportRouter } from "./routes/export";
import { makeRedis, attachPgInvalidationListener } from "./lib/cache";
import { Client as PgClient } from "pg";

const app = express();
app.disable("x-powered-by");

// --- Prisma: force runtime DATABASE_URL ---
const RUNTIME_DB_URL = process.env.DATABASE_URL || "";
if (!RUNTIME_DB_URL) {
  console.warn("[records] DATABASE_URL is empty at startup");
}
const prisma = new PrismaClient({
  datasources: { db: { url: RUNTIME_DB_URL } },
});

// --- Redis (for cache + rate-limit) ---
const redis = makeRedis();

// --- PG LISTEN/NOTIFY -> bump per-user cache versions ---
const pgListener = new PgClient({ connectionString: RUNTIME_DB_URL });
pgListener
  .connect()
  .then(() => attachPgInvalidationListener(pgListener, redis))
  .catch((e) => console.warn("[records] pg LISTEN skipped:", e?.message || String(e)));

// Security headers, gzip, JSON body, CORS (same origins as gateway)
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression() as unknown as import("express").RequestHandler);
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: [/localhost:8080$/, /localhost:3001$/],
    credentials: false,
  })
);

// quick probe (K8s probes use this path)
app.get("/_ping", (_req, res) => res.json({ ok: true }));

// legacy/probe
app.get("/records/_ping", (_req, res) => res.json({ ok: true }));

// Metrics
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () =>
    httpCounter.inc({
      service: "records",
      route: req.path,
      method: req.method,
      code: res.statusCode,
    })
  );
  next();
});

// /metrics
app.get("/metrics", async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// /healthz — cheap DB + optional Redis ping
app.get("/healthz", async (_req: Request, res: Response) => {
  try {
    const row = await prisma.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
    const user = row?.[0]?.current_user ?? "unknown";
    let r = "skipped";
    try {
      r = redis ? await redis.ping() : "disabled";
    } catch {
      r = "error";
    }
    res.json({ ok: true, db_user: user, redis: r });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "db error" });
  }
});

/** Identity guard */
function requireUser(
  req: Request & { userId?: string; userEmail?: string },
  res: Response,
  next: NextFunction
) {
  const uid = String(req.headers["x-user-id"] || "");
  if (!uid) return res.status(401).json({ error: "auth required" });
  req.userId = uid;
  const email = req.headers["x-user-email"];
  if (typeof email === "string") req.userEmail = email;
  next();
}

/** Lightweight per-user rate limit using Redis buckets (windowed). */
function userRateLimit(opts?: { windowSec?: number; max?: number }): import("express").RequestHandler {
  const windowSec = opts?.windowSec ?? Number(process.env.RL_WINDOW_SEC ?? 60);
  const max = opts?.max ?? Number(process.env.RL_MAX_PER_WINDOW ?? 240);
  return (req, res, next) => {
    (async () => {
      if (!redis) return next();
      const uid = (req as any).userId || req.ip;
      const now = Math.floor(Date.now() / 1000);
      const bucket = Math.floor(now / windowSec);
      const key = `rl:u:${uid}:${bucket}`;

      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, windowSec + 1);

      if (n > max) {
        res.setHeader("Retry-After", String(windowSec));
        return res.status(429).json({ error: "rate limited" });
      }
      return next();
    })().catch(next);
  };
}

// Routes (order matters)
app.use("/records", requireUser, userRateLimit(), recordsRouter(prisma, redis));
app.use("/records", requireUser, exportRouter(prisma));

// Safety net
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("records service error:", msg);
  if (!res.headersSent) res.status(500).json({ error: "internal" });
});

// Start HTTP server
const port = Number(process.env.RECORDS_PORT || 4002);
const server = app.listen(port, () => {
  const safeUrl = (RUNTIME_DB_URL || "").replace(/:(.+?)@/, ":****@");
  console.log("records HTTP server up on", port, "| DB:", safeUrl);
});

// Start gRPC server
if (process.env.ENABLE_GRPC !== "false") {
  import("./grpc-server").then(({ startGrpcServer }) => {
    const grpcPort = parseInt(process.env.GRPC_PORT || "50051", 10);
    startGrpcServer(grpcPort);
  }).catch((e) => {
    console.error("Failed to start gRPC server:", e);
  });
}

function shutdown(signal: string) {
  console.log(`[records] received ${signal}, shutting down...`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
      if (redis) await redis.quit();
      try {
        await pgListener.end();
      } catch {}
    } finally {
      process.exit(0);
    }
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));