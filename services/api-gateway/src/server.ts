import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";

import { register, httpCounter } from "@common/utils/metrics";
import { verifyJwt, type JwtPayload as TokenPayload } from "@common/utils/auth";

import { createClient } from "redis";
import type {
  IncomingMessage,
  ServerResponse as NodeServerResponse,
} from "http";
import { Agent as HttpAgent } from "http";
import type { Socket } from "net";

// one shared agent (tune if needed)
const keepAliveAgent = new HttpAgent({
  keepAlive: true,
  maxSockets: 512,
  maxFreeSockets: 256,
  keepAliveMsecs: 30_000,
});

/* ----------------------- Types ----------------------- */
type AuthedRequest = Request & {
  user?: { sub?: string; email?: string; jti?: string };
};

/* ----------------------- Small helpers ----------------------- */
function sendJson502(res: NodeServerResponse | Socket, msg: string) {
  // In v3, `res` can be Node ServerResponse *or* a raw Socket.
  if ("setHeader" in res) {
    const sr = res as NodeServerResponse;
    if (!sr.headersSent) {
      sr.statusCode = 502;
      sr.setHeader("Content-Type", "application/json");
      sr.end(JSON.stringify({ error: msg }));
      return;
    }
  }
  try {
    (res as Socket).destroy();
  } catch {
    /* noop */
  }
}

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

/** Inject x-user-* headers into the outgoing request before proxying. */
function injectIdentityHeadersIfAny(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
) {
  // Anti-spoof: wipe any client-provided values
  delete (req.headers as any)["x-user-id"];
  delete (req.headers as any)["x-user-email"];
  delete (req.headers as any)["x-user-jti"];

  if (req.user?.sub) (req.headers as any)["x-user-id"] = req.user.sub;
  if ((req.user as any)?.email)
    (req.headers as any)["x-user-email"] = (req.user as any).email;
  if ((req.user as any)?.jti)
    (req.headers as any)["x-user-jti"] = (req.user as any).jti;

  next();
}

/* ----------------------- App init ----------------------- */
const app = express();
app.disable("x-powered-by");

/** We run behind nginx: required for express-rate-limit & real client IPs */
app.set("trust proxy", 1);

/* ----------------------- Redis (revocation check) ----------------------- */
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

/* ----------------------- Security / CORS / gzip ----------------------- */
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

app.use(
  cors({
    origin: [/localhost:8080$/, /localhost:3001$/],
    credentials: false,
  })
);

app.use(compression() as unknown as import("express").RequestHandler);

/* ----------------------- Basic endpoints ----------------------- */
app.get("/whoami", (_req, res) =>
  res.json({ pod: process.env.HOSTNAME || require("os").hostname() })
);

app.get("/healthz", (_req: Request, res: Response) => res.json({ ok: true }));

app.get("/metrics", async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

/* ----------------------- Tiny query sanitizer ----------------------- */
app.use((req: Request, _res: Response, next: NextFunction) => {
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === "string")
      (req.query as any)[k] = v.replace(/[<>\"'`;(){}]/g, "");
  }
  next();
});

/* ----------------------- Metrics counter ----------------------- */
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

/* ----------------------- Rate limit ----------------------- */
const limiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/healthz" || req.path === "/metrics",
});
app.use(limiter);

/* ----------------------- Open routes ----------------------- */
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

/* ----------------------- Logging (helpful while stabilizing) ----------------------- */
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

/* ----------------------- AUTH GUARD ----------------------- */
app.use(async (req: AuthedRequest, res: Response, next: NextFunction) => {
  if (isOpenRoute(req)) return next();

  // Clear any spoofed identity headers from clients (we set them ourselves)
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

/* ----------------------- Debug helper after guard ----------------------- */
app.get("/__whoami", (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user ?? null });
});

/* ----------------------- Local error logging (pre-proxy) ----------------------- */
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error) {
    console.error("records service error:", err.stack || err.message);
  } else {
    console.error("records service error:", err);
  }
  if (!res.headersSent) res.status(500).json({ error: "internal" });
});

/* =========================================================
   PROXIES
   - nginx strips /api, so HPM sees paths starting with /auth, /records, ...
   - Identity headers are injected via middleware *before* the proxy.
   - No on.proxyReq needed → avoids Express vs. Node type clashes.
   ========================================================= */

/* Auth service (strip /auth) — no identity injection */
app.use(
  "/auth",
  createProxyMiddleware({
    target: "http://auth-service:4001",
    changeOrigin: true,
    pathRewrite: { "^/auth": "" },
    proxyTimeout: 15000,
    agent: keepAliveAgent,
    on: {
      error(_err, _req, res) {
        sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
      },
    },
  })
);

// --- TEMP DEBUG: show what the records service actually receives
app.use((req, _res, next) => {
  if (req.method === 'PUT' && (req.path === '/records' || req.path.startsWith('/records/'))) {
    console.log('[records] saw', req.method, req.originalUrl, 'authz:', req.headers.authorization || '<none>');
  }
  next();
});

/* Records service — inject identity, forward /records as-is (no rewrite) */
app.use(
  "/records",
  injectIdentityHeadersIfAny,
  createProxyMiddleware({
    target: "http://records-service:4002",
    changeOrigin: true,
    proxyTimeout: 15000,
    agent: keepAliveAgent,
    pathRewrite: (path) =>
      path.startsWith("/records") ? path : `/records${path}`,
    on: {
      proxyRes(proxyRes: IncomingMessage) {
        console.log("[gw] /records upstream status:", proxyRes.statusCode);
      },
      error(err, _req, res) {
        console.error("[gw] records proxy error:", err);
        sendJson502(res as NodeServerResponse | Socket, "records upstream error");
      },
    },
  })
);

/* Listings — public GETs, but we still forward identity if present */
app.use(
  "/listings",
  injectIdentityHeadersIfAny,
  createProxyMiddleware({
    target: "http://listings-service:4003",
    changeOrigin: true,
    proxyTimeout: 15000,
    agent: keepAliveAgent,
    on: {
      proxyRes(proxyRes) {
        const h = proxyRes.headers as Record<string, string>;
        if (!h["cache-control"]) {
          h["cache-control"] = "public, max-age=60, s-maxage=300";
        }
      },
      error(err, _req, res) {
        console.error("[gw] listings proxy error:", err);
        sendJson502(
          res as NodeServerResponse | Socket,
          "listings upstream error"
        );
      },
    },
  })
);

/* Analytics — protected */
app.use(
  "/analytics",
  injectIdentityHeadersIfAny,
  createProxyMiddleware({
    target: "http://analytics-service:4004",
    changeOrigin: true,
    proxyTimeout: 15000,
    agent: keepAliveAgent,
    on: {
      error(err, _req, res) {
        console.error("[gw] analytics proxy error:", err);
        sendJson502(
          res as NodeServerResponse | Socket,
          "analytics upstream error"
        );
      },
    },
  })
);

/* Python AI — strip /ai, forward identity if present */
app.use(
  "/ai",
  injectIdentityHeadersIfAny,
  createProxyMiddleware({
    target: "http://python-ai-service:5005",
    changeOrigin: true,
    pathRewrite: { "^/ai": "" },
    proxyTimeout: 15000,
    agent: keepAliveAgent,
    on: {
      proxyRes(proxyRes) {
        const h = proxyRes.headers as Record<string, string>;
        if (!h["cache-control"]) {
          h["cache-control"] = "public, max-age=120, s-maxage=600";
        }
      },
      error(err, _req, res) {
        console.error("[gw] ai proxy error:", err);
        sendJson502(res as NodeServerResponse | Socket, "ai upstream error");
      },
    },
  })
);

/* ----------------------- Final safety net ----------------------- */
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("gateway error:", msg);
  if (!res.headersSent) res.status(500).json({ error: "internal" });
});

app.listen(process.env.GATEWAY_PORT || 4000, () => console.log("gateway up"));
