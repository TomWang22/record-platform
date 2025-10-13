/* cspell:ignore healthz maxage s-maxage */
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import type { ClientRequest, IncomingMessage } from "http";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";
import { register, httpCounter } from "@common/utils/metrics";
import { verifyJwt, type JwtPayload as TokenPayload } from "@common/utils/auth";
import { createClient } from "redis";

type AuthedRequest = Request & { user?: { sub?: string; email?: string; jti?: string } };

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
    if (typeof v === "string")
      (req.query as any)[k] = v.replace(/[<>\"'`;(){}]/g, "");
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

// Add this helper (replace your current one)
// replace your current extractBearer with this:
function extractBearer(req: Request): string | undefined {
  const raw =
    req.get("authorization") ??
    (Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization) ??
    "";
  const s = String(raw).trim();
  const i = s.toLowerCase().indexOf("bearer ");
  if (i === -1) return undefined;
  const token = s.slice(i + "bearer ".length).trim();
  return token || undefined;
}

app.get("/__echo_authz", (req, res) => {
  res.json({ path: req.path, authz: req.headers.authorization ?? null });
});

type RouteRule = { method: string; pattern: RegExp };
const OPEN_ROUTES: RouteRule[] = [
  { method: "GET", pattern: /^\/(?:api\/)?healthz\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?metrics\/?$/ },
  { method: "POST", pattern: /^\/(?:api\/)?auth\/login\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?listings(?:\/|$)/ },
  { method: "GET", pattern: /^\/(?:api\/)?ai(?:\/|$)/ },
];

const isOpenRoute = (req: Request) => {
  const url =
    (req.headers["x-original-uri"] as string) ||
    (req.headers["x-forwarded-uri"] as string) ||
    req.originalUrl ||
    req.url ||
    req.path ||
    "";
  return OPEN_ROUTES.some(
    (rule) => rule.method === req.method && rule.pattern.test(url)
  );
};

app.use((req, _res, next) => {
  console.log(
    `[gw] ${req.method} path=${req.path} orig=${req.originalUrl} raw=${
      (req.headers["x-original-uri"] as string) ??
      (req.headers["x-forwarded-uri"] as string) ??
      req.originalUrl
    } open=${isOpenRoute(req)} auth=${!!req.headers.authorization}`
  );
  next();
});

app.use((req, _res, next) => {
  if (req.path === "/records" || req.path.startsWith("/records/")) {
    console.log(
      "[gw] before guard",
      req.method,
      req.path,
      "authz:",
      req.headers.authorization || "<none>"
    );
  }
  next();
});

app.use((req, _res, next) => {
  if (req.path === "/records" || req.path.startsWith("/records/")) {
    console.log("[gw] /records authz:", req.headers.authorization || "<none>");
  }
  next();
});

// log just before the guard, only for /records paths
app.use((req, _res, next) => {
  if (req.path === "/records" || req.path.startsWith("/records/")) {
    console.log(
      "[gw] before guard",
      req.method,
      req.path,
      "authz:",
      req.headers.authorization ?? "<none>"
    );
  }
  next();
});

// -------------------- AUTH GUARD --------------------
app.use(async (req: AuthedRequest, res: Response, next: NextFunction) => {
  if (isOpenRoute(req)) return next();

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
        console.warn(
          "revocation check failed, proceeding:",
          (e as Error)?.message
        );
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

app.use((req: AuthedRequest, _res, next) => {
  if (req.path === "/__whoami") {
    console.log("[debug] whoami user:", req.user);
  }
  next();
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error) {
    console.error("records service error:", err.stack || err.message);
  } else {
    console.error("records service error:", err);
  }
  if (!res.headersSent) res.status(500).json({ error: "internal" });
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

app.use("/records", (req: AuthedRequest, _res, next) => {
  // anti-spoof: ensure we write, not trust client
  delete (req.headers as any)["x-user-id"];
  delete (req.headers as any)["x-user-email"];
  delete (req.headers as any)["x-user-jti"];

  if (req.user?.sub)   (req.headers as any)["x-user-id"]    = req.user.sub;
  if ((req.user as any)?.email) (req.headers as any)["x-user-email"] = (req.user as any).email;
  if ((req.user as any)?.jti)   (req.headers as any)["x-user-jti"]   = (req.user as any).jti;

  next();
});
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
      if (!res.headersSent)
        res.status(502).json({ error: "auth upstream error" });
    },
  } as any)
);

// 3) records proxy: target includes /records so upstream sees the right path
// PROXY: make sure upstream sees /records prefix
app.use(
  "/records",
  createProxyMiddleware({
    target: "http://records-service:4002",
    changeOrigin: true,
    proxyTimeout: 15000,

    // 👇 Make sure upstream sees /records + the path after the mount
    pathRewrite: (path: string, req: Request) => {
      const rewritten = "/records" + (path.startsWith("/") ? path : `/${path}`);
      console.log(`[gw] rewrite ${req.method} ${req.baseUrl}${path} -> ${rewritten}`);
      return rewritten;
    },

    onProxyReq: (proxyReq: ClientRequest, req: AuthedRequest) => {
      const u = req.user as any;
      if (u?.sub)   proxyReq.setHeader("x-user-id", u.sub);
      if (u?.email) proxyReq.setHeader("x-user-email", u.email);
      if (u?.jti)   proxyReq.setHeader("x-user-jti", u.jti);
    },

    onProxyRes: (proxyRes: IncomingMessage) => {
      console.log("[gw] /records upstream status:", proxyRes.statusCode);
    },

    onError: (err: unknown, _req: Request, res: Response) => {
      console.error("[gw] records proxy error:", err);
      if (!res.headersSent) res.status(502).json({ error: "records upstream error" });
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
      proxyRes.headers["Cache-Control"] =
        proxyRes.headers["cache-control"] || "public, max-age=60, s-maxage=300";
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
        proxyRes.headers["cache-control"] ||
        "public, max-age=120, s-maxage=600";
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
