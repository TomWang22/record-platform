/* cspell:ignore healthz */
import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import { PrismaClient } from "../generated/records-client";
import { register, httpCounter } from "@common/utils/metrics";
import { recordsRouter } from "./routes/records";
import { exportRouter } from "./routes/export";

const app = express();
const prisma = new PrismaClient();

app.disable("x-powered-by");

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

//quick probe
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

// /healthz — check DB
app.get("/healthz", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "db error" });
  }
});

/**
 * Identity guard
 * The gateway strips client-sent x-user-* and sets them AFTER JWT verification.
 * We still only trust the gateway (this service should be network-private).
 */
function requireUser(req: Request & { userId?: string; userEmail?: string }, res: Response, next: NextFunction) {
  const uid = String(req.headers["x-user-id"] || "");
  if (!uid) return res.status(401).json({ error: "auth required" });
  req.userId = uid;
  const email = req.headers["x-user-email"];
  if (typeof email === "string") req.userEmail = email;
  next();
}

// Routes
app.use("/records", requireUser, recordsRouter(prisma));
app.use("/records", requireUser, exportRouter(prisma));

// Safety net
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("records service error:", msg);
  if (!res.headersSent) res.status(500).json({ error: "internal" });
});

// Start + graceful shutdown
const port = Number(process.env.RECORDS_PORT || 4002);
const server = app.listen(port, () => console.log("records up on", port));

function shutdown(signal: string) {
  console.log(`[records] received ${signal}, shutting down...`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
