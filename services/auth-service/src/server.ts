/* cspell:ignore healthz */
import express, { type Request, type Response, type NextFunction } from "express";
import { PrismaClient } from "../prisma/generated/client";
import { register, httpCounter } from "@common/utils";
import { signJwt, verifyJwt, type JwtPayload as TokenPayload } from "@common/utils/auth";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { setupOAuthRoutes } from "./routes/oauth.js";
import { setupMFARoutes } from "./routes/mfa.js";
import { setupVerificationRoutes } from "./routes/verification.js";
import passkeyRouter from "./routes/passkey.js";
import { verifyMFA } from "./lib/mfa.js";

const app = express();
// Initialize Prisma
// Note: With @@schema("auth") and schemas = ["auth"], Prisma should use auth schema
// Connection string has search_path=auth which should be respected
const prisma = new PrismaClient();

/** Extend the shared JwtPayload with fields we also put/read */
type WithJti = TokenPayload & { jti?: string; exp?: number };

// --- Redis (revocation list) ---
// Support both REDIS_URL (with password) and REDIS_PASSWORD env var
let REDIS_URL = process.env.REDIS_URL || "redis://redis:6379/0";
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
// If REDIS_PASSWORD is set and URL doesn't have password, add it
if (REDIS_PASSWORD && !REDIS_URL.includes('@') && !REDIS_URL.includes('://:')) {
  // Insert password after redis://
  REDIS_URL = REDIS_URL.replace('redis://', `redis://:${REDIS_PASSWORD}@`);
}
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
  let dbOk = false;
  let redisOk = false;
  
  // Check database (non-blocking, with timeout)
  try {
    // Use Promise.race to add a timeout to the database query
    const dbCheck = prisma.$queryRaw`SELECT 1`;
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("DB check timeout")), 500)
    );
    await Promise.race([dbCheck, timeout]);
    dbOk = true;
  } catch (e: any) {
    // Silently fail - don't log timeout errors to reduce noise
    if (!e?.message?.includes("timeout")) {
      console.warn("auth-service healthz db check failed:", e?.message || "db error");
    }
  }
  
  // Check Redis (non-blocking, with timeout)
  try {
    const redisCheck = redis.ping();
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Redis check timeout")), 500)
    );
    await Promise.race([redisCheck, timeout]);
    redisOk = true;
  } catch (redisErr: any) {
    // Silently fail - don't log timeout errors to reduce noise
    if (!redisErr?.message?.includes("timeout")) {
      console.warn("auth-service healthz redis ping failed:", redisErr);
    }
  }
  
  // Return 200 immediately - allows service to start and gRPC to be available
  // The service can still handle requests, they'll just fail if DB is down
  res.status(200).json({ 
    ok: true, 
    db: dbOk ? 'connected' : 'disconnected',
    redis: redisOk ? 'connected' : 'disconnected'
  });
});

app.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password, sendVerification } = (req.body ?? {}) as {
      email?: string;
      password?: string;
      sendVerification?: boolean;
    };
    if (!email || !password) return res.status(400).json({ error: "email/password required" });

    // Use raw SQL query to access auth.users table directly
    const existing = await prisma.$queryRaw<Array<{ id: string; email: string }>>`
      SELECT id, email FROM auth.users WHERE email = ${email}
    `.then((r: Array<any>) => r[0] || null);
    if (existing) return res.status(409).json({ error: "email already exists" });

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.$queryRaw<Array<{ id: string; email: string; created_at: Date }>>`
      INSERT INTO auth.users (email, password_hash, email_verified, created_at)
      VALUES (${email}, ${hash}, ${sendVerification ? false : true}, NOW())
      RETURNING id, email, created_at
    `.then((r: Array<{ id: string; email: string; created_at: Date }>) => r[0]);

    // Send verification email if requested
    if (sendVerification) {
      try {
        const { sendEmailVerificationCode } = await import("./lib/verification.js");
        await sendEmailVerificationCode(prisma, user.id, email);
      } catch (e) {
        console.warn("Failed to send verification email:", e);
        // Continue anyway - user is registered
      }
    }

    const jti = randomUUID();
    const payload: WithJti = { sub: user.id, email: user.email, jti };
    const token = signJwt(payload);
    res.status(201).json({
      token,
      emailVerified: !sendVerification,
      message: sendVerification ? "Verification email sent" : undefined,
    });
  } catch (e: any) {
    console.error("register error:", e);
    res.status(500).json({ error: "internal" });
  }
});

app.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password, mfaCode } = (req.body ?? {}) as {
      email?: string;
      password?: string;
      mfaCode?: string;
    };
    if (!email || !password) return res.status(400).json({ error: "email/password required" });

    // Use raw SQL query to access auth.users table directly
    const user = await prisma.$queryRaw<Array<{
      id: string;
      email: string;
      passwordHash: string;
      mfaEnabled: boolean;
      createdAt: Date;
    }>>`
      SELECT id, email, password_hash as "passwordHash", mfa_enabled as "mfaEnabled", created_at as "createdAt"
      FROM auth.users
      WHERE email = ${email}
    `.then((r: Array<any>) => r[0] || null);
    if (!user || !user.passwordHash) return res.status(401).json({ error: "invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });

    // Check if MFA is enabled
    if (user.mfaEnabled) {
      if (!mfaCode) {
        return res.status(200).json({
          requiresMFA: true,
          userId: user.id,
          message: "MFA code required",
        });
      }

      // Verify MFA code
      const mfaValid = await verifyMFA(prisma, user.id, mfaCode);
      if (!mfaValid) {
        return res.status(401).json({ error: "invalid MFA code" });
      }
    }

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
  if (!raw) return res.status(200).json({ ok: true, revoked: false });

  try {
    const payload = verifyJwt(raw) as WithJti;
    if (payload.jti) {
      const now = Math.floor(Date.now() / 1000);
      const exp = typeof payload.exp === "number" ? payload.exp : now + 24 * 60 * 60; // fallback 24h
      const ttl = Math.max(1, exp - now);
      try {
        await redis.set(`revoked:${payload.jti}`, "1", { EX: ttl });
        console.log("auth-service: revoked jti", payload.jti, "ttl", ttl, "s");
        return res.status(200).json({ ok: true, revoked: true });
      } catch (redisErr) {
        console.error("auth-service: failed to revoke token in Redis:", redisErr);
        // Still return 200 but indicate revocation failed
        return res.status(200).json({ ok: true, revoked: false, error: "Redis unavailable" });
      }
    }
    return res.status(200).json({ ok: true, revoked: false });
  } catch (err) {
    console.error("auth-service: logout error:", err);
    return res.status(200).json({ ok: true, revoked: false });
  }
});

app.get("/me", (req: Request, res: Response) => {
  const auth = req.headers.authorization?.split(" ")[1];
  if (!auth) return res.status(401).json({ error: "missing token" });
  try {
    const payload = verifyJwt(auth);
    // Fetch additional user info
    prisma.$queryRaw<Array<{
      email_verified: boolean;
      phone_verified: boolean;
      mfa_enabled: boolean;
    }>>`
      SELECT email_verified, phone_verified, mfa_enabled
      FROM auth.users
      WHERE id = ${payload.sub}::uuid
    `.then((r: any[]) => {
      res.json({
        ...payload,
        emailVerified: r[0]?.email_verified || false,
        phoneVerified: r[0]?.phone_verified || false,
        mfaEnabled: r[0]?.mfa_enabled || false,
      });
    }).catch(() => {
      res.json(payload);
    });
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
});

// OAuth routes
app.use("/auth", setupOAuthRoutes(prisma));
app.use("/passkeys", passkeyRouter);

// MFA routes
app.use("/mfa", setupMFARoutes(prisma));

// Verification routes
app.use("/verify", setupVerificationRoutes(prisma));

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
  import('./grpc-server.js').then(({ startGrpcServer }) => {
    const grpcPort = parseInt(process.env.GRPC_PORT || "50051", 10);
    startGrpcServer(grpcPort);
  }).catch((e) => {
    console.error("Failed to start gRPC server:", e);
  });
}
