/* cspell:ignore healthz maxage s-maxage */
import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";
import { register, httpCounter } from "@common/utils/metrics";
import { verifyJwt } from "@common/utils/auth";

const app = express();
app.disable("x-powered-by");

/** We run behind nginx: required for express-rate-limit & real client IPs */
app.set("trust proxy", 1);

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

// gzip + JSON body
app.use(compression() as unknown as import("express").RequestHandler);
app.use(express.json({ limit: "1mb" }));

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

// ----- Auth guard (allowlist first, then require JWT) -----
function authGuard(req: Request & { user?: any }, res: Response, next: NextFunction) {
  const p = req.path;

  // Public: health, metrics, all /auth/*
  if (p === "/healthz" || p === "/metrics" || p.startsWith("/auth/")) return next();

  // Optional public GETs (read-only):
  if (req.method === "GET" && (p.startsWith("/listings/") || p.startsWith("/ai/"))) {
    return next();
  }

  // Everything else requires JWT
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "auth required" });

  try {
    req.user = verifyJwt(token);
    return next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}
app.use(authGuard);

// ----- Proxies -----
// Note: nginx maps /api/* -> gateway /* (strips /api), so clients hit /api/auth, /api/records, etc.

// Auth service: strip /auth
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

// Records (protected)
app.use(
  "/records",
  createProxyMiddleware({
    target: "http://records-service:4002",
    changeOrigin: true,
    proxyTimeout: 15000,
  } as any)
);

// Listings (GET public, others protected by guard above)
app.use(
  "/listings",
  createProxyMiddleware({
    target: "http://listings-service:4003",
    changeOrigin: true,
    proxyTimeout: 15000,
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
    onProxyRes: (proxyRes: any) => {
      proxyRes.headers["Cache-Control"] = proxyRes.headers["cache-control"] || "public, max-age=120, s-maxage=600";
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
