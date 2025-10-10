/* cspell:ignore healthz maxage s-maxage */
import express, { type Request, type Response, type NextFunction } from "express";
import type { ClientRequest } from "http";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";
import { register, httpCounter } from "@common/utils/metrics";
import { verifyJwt, type JwtPayload as TokenPayload } from "@common/utils/auth";
import { createClient } from "redis";

type AuthedRequest = Request & { user?: TokenPayload };

const app = express();
app.disable("x-powered-by");

/** We run behind nginx: required for express-rate-limit & real client IPs */
app.set("trust proxy", 1);

// --- Redis (revocation list check) ---
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const redis = createClient({ url: REDIS_URL });
redis.on("error", (e: unknown) => console.error("gateway redis error:", e));
(async () => {
  try {
    await redis.connect();
    console.log("gateway redis connected");
  } catch (e) {
    console.error("gateway redis connect failed:", e);
  }
})();

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "https:"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": [],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// CORS — allow browser app through nginx:8080 and direct dev webapp:3001
app.use(
  cors({
    origin: [/localhost:8080$/, /localhost:3001$/],
    credentials: false,
  })
);

// gzip (response only; does not touch request bodies)
app.use(compression() as unknown as import("express").RequestHandler);

// NOTE: DO NOT use express.json() globally; the gateway streams bodies to upstreams.

// Tiny query sanitizer
app.use((req: Request, _res: Response, next: NextFunction) => {
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === "string") (req.query as any)[k] = v.replace(/[<>\"'`;(){}]/g, "");
  }
  next();
});

// Metrics counter
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () =>
    httpCounter.inc({
      service: "gateway",
      route: req.path,
      method: req.method,
      code: res.statusCode,
    })
  );
  next();
});

// ----- Public endpoints (no auth) -----
app.get("/healthz", (_req: Request, res: Response) => res.json({ ok: true }));
app.get("/metrics", async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// Rate limit (skip health/metrics so probes/Prom don't get throttled)
const limiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/healthz" || req.path === "/metrics",
});
app.use(limiter);

// add near the top
function extractBearer(req: Request): string | undefined {
  const raw = (req.headers["authorization"] as string | undefined) ?? "";
  const [scheme, token] = raw.split(/\s+/);
  if (scheme && scheme.toLowerCase() === "bearer" && token) return token.trim();
  return undefined;
}

app.get("/__echo_authz", (req, res) => {
  res.json({ path: req.path, authz: req.headers.authorization ?? null });
});

// -------------------- AUTH GUARD --------------------
app.use(async (req: AuthedRequest, res: Response, next: NextFunction) => {
  const p = req.path;

  if (p === "/healthz" || p === "/metrics" || p.startsWith("/auth/")) return next();
  if (req.method === "GET" && (p.startsWith("/listings/") || p.startsWith("/ai/"))) return next();

  delete (req.headers as any)["x-user-id"];
  delete (req.headers as any)["x-user-email"];
  delete (req.headers as any)["x-user-jti"];

  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: "auth required" });

  try {
    const payload = verifyJwt(token) as TokenPayload & { jti?: string };
    if (payload?.jti) {
      try {
        const revoked = await redis.get(`revoked:${payload.jti}`);
        if (revoked) return res.status(401).json({ error: "token revoked" });
      } catch (e) {
        console.warn("revocation check failed, proceeding:", (e as Error)?.message);
      }
    }
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
});

// 2) put __whoami *after* the guard so req.user is populated
app.get("/__whoami", (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user ?? null });
});

// Helper: attach identity headers for proxied calls (only if JWT verified)
function attachIdentityHeaders() {
  return (proxyReq: ClientRequest, req: AuthedRequest) => {
    const uid = req.user?.sub;
    if (uid) proxyReq.setHeader("x-user-id", uid);
    const email = (req.user as any)?.email;
    if (email) proxyReq.setHeader("x-user-email", email);
    const jti = (req.user as any)?.jti;
    if (jti) proxyReq.setHeader("x-user-jti", jti);
  };
}

// ----- Proxies -----
// Note: nginx maps /api/* -> gateway /* (strips /api)

// Auth service: strip /auth (no identity headers forwarded)
app.use(
  "/auth",
  createProxyMiddleware({
    target: "http://auth-service:4001",
    changeOrigin: true,
    pathRewrite: { "^/auth": "" },
    proxyTimeout: 15000,
    onError: (_err: unknown, _req: Request, res: Response) => {
      if (!res.headersSent) res.status(502).json({ error: "auth upstream error" });
    },
  } as any)
);

// 3) records proxy: target includes /records so upstream sees the right path
app.use(
  "/records",
  createProxyMiddleware({
    target: "http://records-service:4002/records",
    changeOrigin: true,
    proxyTimeout: 15000,
    onProxyReq: (proxyReq: ClientRequest, req: AuthedRequest) => {
      const u = req.user as any;
      if (u?.sub)   proxyReq.setHeader("x-user-id", u.sub);
      if (u?.email) proxyReq.setHeader("x-user-email", u.email);
      if (u?.jti)   proxyReq.setHeader("x-user-jti", u.jti);
    },
  } as any)
);

// Listings (GET public, others protected by guard above) — still forward identity if present
app.use(
  "/listings",
  createProxyMiddleware({
    target: "http://listings-service:4003",
    changeOrigin: true,
    proxyTimeout: 15000,
    onProxyReq: attachIdentityHeaders(),
    onProxyRes: (proxyRes: any) => {
      proxyRes.headers["Cache-Control"] = proxyRes.headers["cache-control"] || "public, max-age=60, s-maxage=300";
    },
  } as any)
);

// Analytics (protected)
app.use(
  "/analytics",
  createProxyMiddleware({
    target: "http://analytics-service:4004",
    changeOrigin: true,
    proxyTimeout: 15000,
    onProxyReq: attachIdentityHeaders(),
  } as any)
);

// Python AI (GET public via guard; strip /ai)
app.use(
  "/ai",
  createProxyMiddleware({
    target: "http://python-ai-service:5005",
    changeOrigin: true,
    pathRewrite: { "^/ai": "" },
    proxyTimeout: 15000,
    onProxyReq: attachIdentityHeaders(),
    onProxyRes: (proxyRes: any) => {
      proxyRes.headers["Cache-Control"] =
        proxyRes.headers["cache-control"] || "public, max-age=120, s-maxage=600";
    },
  } as any)
);

// Generic error handler (so proxy errors don’t crash the process)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("gateway error:", msg);
  if (!res.headersSent) res.status(500).json({ error: "internal" });
});

app.listen(process.env.GATEWAY_PORT || 4000, () => console.log("gateway up"));
