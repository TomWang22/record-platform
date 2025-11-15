/* cspell:ignore healthz */
import express, { type Request, type Response, type NextFunction } from "express";
import { PrismaClient } from "../prisma/generated/client";
import { register, httpCounter } from "@common/utils/metrics";
import { signJwt, verifyJwt, type JwtPayload as TokenPayload } from "@common/utils/auth";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";

const app = express();
// Initialize Prisma
// Note: With @@schema("auth") and schemas = ["auth"], Prisma should use auth schema
// Connection string has search_path=auth which should be respected
const prisma = new PrismaClient();

/** Extend the shared JwtPayload with fields we also put/read */
type WithJti = TokenPayload & { jti?: string; exp?: number };

// --- Redis (revocation list) ---
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const redis = createClient({ url: REDIS_URL });
redis.on("error", (e: unknown) => console.error("auth-service redis error:", e));
(async () => {
  try {
    await redis.connect();
    console.log("auth-service redis connected");
  } catch (e) {
    console.error("auth-service redis connect failed:", e);
  }
})();

app.use(express.json({ limit: "1mb" }));

// metrics
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () =>
    httpCounter.inc({ service: "auth", route: req.path, method: req.method, code: res.statusCode })
  );
  next();
});

app.get("/metrics", async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.get("/healthz", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    try {
      await redis.ping();
    } catch (redisErr) {
      console.warn("auth-service healthz redis ping failed:", redisErr);
    }
    res.json({ ok: true });
  } catch (e: any) {
    console.error("auth-service healthz failed:", e);
    res.status(500).json({ ok: false, error: e?.message || "db error" });
  }
});

app.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ error: "email/password required" });

    // Use raw SQL query to access auth.users table directly
    const existing = await prisma.$queryRaw<Array<{ id: string; email: string }>>`
      SELECT id, email FROM auth.users WHERE email = ${email}
    `.then((r) => r[0] || null);
    if (existing) return res.status(409).json({ error: "email already exists" });

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.$queryRaw<Array<{ id: string; email: string; created_at: Date }>>`
      INSERT INTO auth.users (email, password_hash, created_at)
      VALUES (${email}, ${hash}, NOW())
      RETURNING id, email, created_at
    `.then((r) => r[0]);

    const jti = randomUUID();
    const payload: WithJti = { sub: user.id, email: user.email, jti };
    const token = signJwt(payload);
    res.status(201).json({ token });
  } catch (e: any) {
    console.error("register error:", e);
    res.status(500).json({ error: "internal" });
  }
});

app.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ error: "email/password required" });

    // Use raw SQL query to access auth.users table directly
    const user = await prisma.$queryRaw<Array<{ id: string; email: string; passwordHash: string; createdAt: Date }>>`
      SELECT id, email, password_hash as "passwordHash", created_at as "createdAt"
      FROM auth.users
      WHERE email = ${email}
    `.then((r) => r[0] || null);
    if (!user || !user.passwordHash) return res.status(401).json({ error: "invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });

    const jti = randomUUID();
    const payload: WithJti = { sub: user.id, email: user.email, jti };
    const token = signJwt(payload);
    res.json({ token });
  } catch (e: any) {
    console.error("login error:", e);
    res.status(500).json({ error: "internal" });
  }
});

/**
 * Server-side logout (token revocation):
 * - Reads Authorization: Bearer <token>
 * - Verifies it, extracts jti and exp
 * - Stores jti in Redis with TTL = exp - now (or 24h fallback if exp missing)
 * - Returns 204 (idempotent)
 */
app.post("/logout", async (req: Request, res: Response) => {
  const raw = req.headers.authorization?.split(" ")[1];
  if (!raw) return res.status(204).end();

  try {
    const payload = verifyJwt(raw) as WithJti;
    if (payload.jti) {
      const now = Math.floor(Date.now() / 1000);
      const exp = typeof payload.exp === "number" ? payload.exp : now + 24 * 60 * 60; // fallback 24h
      const ttl = Math.max(1, exp - now);
      await redis.set(`revoked:${payload.jti}`, "1", { EX: ttl });
      console.log("auth-service: revoked jti", payload.jti, "ttl", ttl, "s");
    }
    return res.status(204).end();
  } catch {
    return res.status(204).end();
  }
});

app.get("/me", (req: Request, res: Response) => {
  const auth = req.headers.authorization?.split(" ")[1];
  if (!auth) return res.status(401).json({ error: "missing token" });
  try {
    res.json(verifyJwt(auth));
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
});

// safety net
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("auth service error:", msg);
  if (!res.headersSent) res.status(500).json({ error: "internal" });
});

// Start HTTP server
const httpPort = process.env.AUTH_PORT || 4001;
app.listen(httpPort, () => console.log(`auth HTTP server up on port ${httpPort}`));

// Start gRPC server
if (process.env.ENABLE_GRPC !== "false") {
  import("./grpc-server").then(({ startGrpcServer }) => {
    const grpcPort = parseInt(process.env.GRPC_PORT || "50051", 10);
    startGrpcServer(grpcPort);
  }).catch((e) => {
    console.error("Failed to start gRPC server:", e);
  });
}
