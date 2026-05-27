import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import * as grpc from "@grpc/grpc-js";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";

import { register, httpCounter } from "@common/utils";
import { verifyJwt, type JwtPayload as TokenPayload } from "@common/utils/auth";
import {
  createAuthClient,
  createRecordsClient,
  createListingsClient,
  createShoppingClient,
  createAuctionMonitorClient,
  createPythonAIClient,
  promisifyGrpcCall,
} from "@common/utils/grpc-clients";

import { createClient } from "redis";
import type { ServerResponse as NodeServerResponse } from "http";
import { Agent as HttpAgent } from "http";
import type { Socket } from "net";

import { registerMarketplaceHttpProxies } from "./proxy/marketplace-routes.js";
import { mountGatewayHealth } from "./health.js";
import { isOpenRoute } from "./middleware/open-routes.js";
import {
  AUTH_GRPC_TARGET,
  AUTH_HTTP_TARGET,
  RECORDS_GRPC_TARGET,
  RECORDS_HTTP_TARGET,
  LISTINGS_GRPC_TARGET,
  LISTINGS_HTTP_TARGET,
  SHOPPING_GRPC_TARGET,
  SHOPPING_HTTP_TARGET,
  AUCTION_MONITOR_GRPC_TARGET,
  AUCTION_MONITOR_HTTP_TARGET,
  PYTHON_AI_GRPC_TARGET,
  PYTHON_AI_HTTP_TARGET,
  ANALYTICS_HTTP_TARGET,
} from "./service-targets.js";


// one shared agent (tune if needed) - increased for high concurrency
const keepAliveAgent = new HttpAgent({
  keepAlive: true,
  maxSockets: 1000,  // Increased from 512 to 1000 for high concurrency (50+ VUs)
  maxFreeSockets: 500,  // Increased from 256 to 500 for better connection reuse
  keepAliveMsecs: 30_000,
});

// Separate agent for validate/refresh endpoints (no keep-alive to avoid connection reuse issues)
// These endpoints have connection reset issues, so we use a fresh connection for each request
const noKeepAliveAgent = new HttpAgent({
  keepAlive: false,  // No keep-alive - fresh connection for each request
  maxSockets: Infinity,  // No limit since we're not reusing connections
});

/** social-service removed — messaging-service owns community/messaging HTTP. */
const RP_SKIP_SOCIAL = true;

const authGrpcClient = createAuthClient(AUTH_GRPC_TARGET);
const recordsGrpcClient = createRecordsClient(RECORDS_GRPC_TARGET);
const listingsGrpcClient = createListingsClient(LISTINGS_GRPC_TARGET);
const shoppingGrpcClient = createShoppingClient(SHOPPING_GRPC_TARGET);
const auctionMonitorGrpcClient = createAuctionMonitorClient(AUCTION_MONITOR_GRPC_TARGET);
const pythonAiGrpcClient = createPythonAIClient(PYTHON_AI_GRPC_TARGET);

/* ----------------------- Types ----------------------- */
type AuthedRequest = Request & {
  user?: { sub?: string; email?: string; jti?: string };
};

/* ----------------------- Small helpers ----------------------- */
function sendJson502(res: NodeServerResponse | Socket, msg: string) {
  if ("setHeader" in res) {
    const sr = res as NodeServerResponse;
    if (!sr.headersSent) {
      sr.statusCode = 502;
      sr.setHeader("Content-Type", "application/json");
      sr.end(JSON.stringify({ error: msg }));
      return;
    }
  }
  try { (res as Socket).destroy(); } catch {}
}

function extractBearer(req: Request): string | undefined {
  const raw =
    req.get("authorization") ??
    (Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization) ??
    "";
  const s = String(raw).trim();
  
  // Debug logging for token extraction issues
  if (!s || s.length === 0) {
    console.warn(`[gw] extractBearer: empty authorization header`, {
      hasGet: !!req.get("authorization"),
      hasHeadersAuth: !!req.headers.authorization,
      headersAuthType: typeof req.headers.authorization,
      headersAuthIsArray: Array.isArray(req.headers.authorization),
    });
    return undefined;
  }
  
  const i = s.toLowerCase().indexOf("bearer ");
  if (i === -1) {
    console.warn(`[gw] extractBearer: "bearer " not found in header`, {
      headerPreview: s.substring(0, 50),
      headerLength: s.length,
    });
    return undefined;
  }
  
  const token = s.slice(i + "bearer ".length).trim();
  if (!token || token.length === 0) {
    console.warn(`[gw] extractBearer: token is empty after extraction`);
    return undefined;
  }
  
  return token;
}

/** Inject x-user-* headers into the outgoing request before proxying. */
function injectIdentityHeadersIfAny(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
) {
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

const grpcStatusToHttp: Record<number, number> = {
  [grpc.status.INVALID_ARGUMENT ?? 3]: 400,
  [grpc.status.UNAUTHENTICATED ?? 16]: 401,
  [grpc.status.PERMISSION_DENIED ?? 7]: 403,
  [grpc.status.NOT_FOUND ?? 5]: 404,
  [grpc.status.ALREADY_EXISTS ?? 6]: 409,
  [grpc.status.UNAVAILABLE ?? 14]: 503,
};

function handleGrpcError(res: Response, err: any) {
  const code = err?.code ?? -1;
  const status = grpcStatusToHttp[code] ?? 500;
  const message = err?.details || err?.message || "grpc error";
  // Diagnostic: log gRPC failure for strict TLS/cert-chain and backend debugging (Runbook #42)
  console.error("[gw] gRPC error → HTTP", status, {
    grpcCode: code,
    grpcMessage: err?.message,
    details: err?.details,
    route: (res as any).req?.path,
    hint: code === 2 ? "auth-service returned INTERNAL (check auth pod logs, DB/Redis)" : code === 14 ? "UNAVAILABLE (connection/TLS? verify cert chain)" : undefined,
  });
  res.status(status).json({ error: message });
}

const jsonParser = express.json({ limit: "1mb" });

function mapHttpRecordToGrpcInput(body: Record<string, any> | undefined | null) {
  if (!body) return {};
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    const snake = key.includes("_")
      ? key
      : key.replace(/([A-Z])/g, "_$1").toLowerCase();
    out[snake] = value;
  }
  return out;
}

function grpcRecordToHttp(record: any) {
  if (!record) return null;
  return {
    id: record.id,
    userId: record.user_id,
    artist: record.artist,
    name: record.name,
    format: record.format,
    catalogNumber: record.catalog_number ?? null,
    notes: record.notes ?? null,
    recordGrade: record.record_grade ?? null,
    sleeveGrade: record.sleeve_grade ?? null,
    hasInsert: !!record.has_insert,
    hasBooklet: !!record.has_booklet,
    hasObiStrip: !!record.has_obi_strip,
    hasFactorySleeve: !!record.has_factory_sleeve,
    isPromo: !!record.is_promo,
    pricePaid: record.price_paid ?? null,
    purchasedAt: record.purchased_at || null,
    receivedAt: record.received_at || null,
    purchaseType: record.purchase_type ?? null,
    purchaseSource: record.purchase_source ?? null,
    sellerName: record.seller_name ?? null,
    orderReference: record.order_reference ?? null,
    purchasePriceCents: record.purchase_price_cents ?? null,
    shippingPaidCents: record.shipping_paid_cents ?? null,
    taxesFeesPaidCents: record.taxes_fees_paid_cents ?? null,
    purchaseCurrency: record.purchase_currency ?? "USD",
    purchaseNotes: record.purchase_notes ?? null,
    createdAt: record.created_at || null,
    updatedAt: record.updated_at || null,
  };
}

function requireUserIdFromRequest(
  req: AuthedRequest,
  res: Response
): string | undefined {
  const userId = req.user?.sub;
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return undefined;
  }
  return userId;
}

export function createApp(): express.Express {
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// DEV: trust x-user-id and short-circuit auth if DEBUG_FAKE_AUTH is on
const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FAKE_AUTH = process.env.DEBUG_FAKE_AUTH === '1' || process.env.DEBUG_FAKE_AUTH === 'true';

if (FAKE_AUTH) {
  console.log('[gateway] DEBUG_FAKE_AUTH is ON — trusting x-user-id header');
  // Put this BEFORE any real auth middleware
  app.use((req, _res, next) => {
    const hdr = req.get('x-user-id') || '';
    if (UUID_RX.test(hdr)) {
      (req as any).userId = hdr;            // downstream expects this
      (req as any).userEmail = 'dev@local'; // optional
      (req as any).__devAuth = true;
    }
    next();
  });
}

/* ----------------------- Redis (revocation check) ----------------------- */
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const redis = createClient({
  url: REDIS_URL,
      socket: { connectTimeout: 10_000 },
});
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
    origin: [
      /^https:\/\/record-platform\.test$/,
      process.env.RP_PUBLIC_ORIGIN
        ? new RegExp(`^${String(process.env.RP_PUBLIC_ORIGIN).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
        : /^https:\/\/record-platform\.test$/,
    ].filter(Boolean) as (string | RegExp)[],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

app.use(compression() as unknown as import("express").RequestHandler);

/* ----------------------- API Analytics Routes (BEFORE URL Rewrite) ----------------------- */
// Handle /api/analytics/* routes BEFORE URL rewrite middleware
// This ensures the route matches before the URL is rewritten
app.use(
  "/api/analytics",
  injectIdentityHeadersIfAny,
  createProxyMiddleware({
    target: ANALYTICS_HTTP_TARGET,
    changeOrigin: true,
    pathRewrite: (path, req) => {
      // Health check endpoint is at root level, not under /analytics
      if (path === '/healthz') {
        console.log(`[gw] pathRewrite analytics health: ${req.originalUrl || req.url} -> ${path} -> /healthz`);
        return '/healthz';
      }
      // Other paths need /analytics prefix (e.g., /log-search -> /analytics/log-search)
      const newPath = `/analytics${path}`;
      console.log(`[gw] pathRewrite analytics: ${req.originalUrl || req.url} -> ${path} -> ${newPath}`);
      return newPath;
    },
    proxyTimeout: 30000,
    agent: keepAliveAgent,
    on: {
      proxyReq(proxyReq, req, res) {
        console.log(`[gw] Proxying ${req.method} ${req.originalUrl || req.url} to analytics-service${proxyReq.path}`);
      },
      error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
        console.error("[gw] api/analytics proxy error:", err);
        sendJson502(res as NodeServerResponse | Socket, "analytics upstream error");
      },
    },
  })
);

/* ----------------------- API Python AI Routes (BEFORE URL Rewrite) ----------------------- */
// Handle /api/ai/* routes BEFORE URL rewrite middleware
// This ensures the route matches before the URL is rewritten
app.use(
  "/api/ai",
  injectIdentityHeadersIfAny,
  createProxyMiddleware({
    target: PYTHON_AI_HTTP_TARGET,
    changeOrigin: true,
    pathRewrite: (path, req) => {
      // Health check endpoint is at root level, not under /ai
      if (path === '/healthz') {
        console.log(`[gw] pathRewrite python-ai health: ${req.originalUrl || req.url} -> ${path} -> /healthz`);
        return '/healthz';
      }
      // Other paths need /ai prefix removed (e.g., /selling-advice -> /ai/selling-advice)
      // Python AI service expects /ai/* paths
      const newPath = `/ai${path}`;
      console.log(`[gw] pathRewrite python-ai: ${req.originalUrl || req.url} -> ${path} -> ${newPath}`);
      return newPath;
    },
    proxyTimeout: 30000,
    agent: keepAliveAgent,
    on: {
      proxyReq(proxyReq, req, res) {
        console.log(`[gw] Proxying ${req.method} ${req.originalUrl || req.url} to python-ai-service${proxyReq.path}`);
      },
      error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
        console.error("[gw] api/python-ai proxy error:", err);
        sendJson502(res as NodeServerResponse | Socket, "python-ai upstream error");
      },
    },
  })
);

/* ----------------------- API Prefix Middleware ----------------------- */
// Rewrite /api/* paths to /* so existing routes work with both /api/ and non-/api/ prefixes
// This must be early in the middleware chain, before route matching
// We modify req.url (mutable) instead of req.path (read-only)
// NOTE: /api/analytics is handled above, so it won't be rewritten
app.use((req: Request, _res: Response, next: NextFunction) => {
  const originalUrl = req.originalUrl || req.url || '';
  if (originalUrl.startsWith('/api/')) {
    // Skip rewriting if already handled by specific route above
    if (originalUrl.startsWith('/api/analytics')) {
      return next(); // Already handled by /api/analytics route above
    }
    if (originalUrl.startsWith('/api/ai')) {
      return next(); // Already handled by /api/ai route above
    }
    // Listings settings/ratings: keep /api prefix so later put/post routes match
    if (originalUrl.startsWith('/api/listings/settings') || originalUrl.startsWith('/api/listings/ratings')) {
      return next();
    }
    // Rewrite URL by removing /api prefix
    const newUrl = originalUrl.replace(/^\/api/, '') || '/';
    // Only set req.url (mutable). Do NOT set req.path or req.originalUrl — they are read-only
    // getters on IncomingMessage; setting them throws "has only a getter".
    (req as any).url = newUrl;
  }
  next();
});

/* ----------------------- Gateway own endpoints ----------------------- */
mountGatewayHealth(app, { authGrpcClient });

/* ----------------------- Sanitizer + counters + rate limit ----------------------- */
app.use((req: Request, _res: Response, next: NextFunction) => {
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === "string")
      (req.query as any)[k] = v.replace(/[<>\"'`;(){}]/g, "");
  }
  next();
});
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () =>
    httpCounter.inc({ service: "gateway", route: req.path, method: req.method, code: res.statusCode })
  );
  next();
});
const limiter = rateLimit({
  windowMs: 60_000, 
  max: process.env.DISABLE_RATE_LIMIT === "true" ? 999999 : 300,  // Temporarily allow high rate for load testing
  standardHeaders: true, 
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health/metrics endpoints
    if (req.path === "/healthz" || req.path === "/readyz" || req.path === "/metrics") return true;
    // Skip rate limiting when X-Loadtest header is present (for load testing)
    if (req.get("x-loadtest") === "1" || req.get("X-Loadtest") === "1") return true;
    return false;
  },
});
app.use(limiter);

/* =========================================================
   PRE-GUARD DIRECT HEALTH/METRICS (never require auth)
   ========================================================= */
app.use(
  "/auth/healthz",
  createProxyMiddleware({
    target: AUTH_HTTP_TARGET,
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 10000,
    agent: keepAliveAgent,
  })
);
app.use(
  "/auth/metrics",
  createProxyMiddleware({
    target: AUTH_HTTP_TARGET,
    changeOrigin: true,
    pathRewrite: () => "/metrics",
    proxyTimeout: 10000,
    agent: keepAliveAgent,
  })
);
app.use(
  "/records/healthz",
  createProxyMiddleware({
    target: RECORDS_HTTP_TARGET,
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 10000,
    agent: keepAliveAgent,
  })
);
// Cache stats endpoints (public, before auth guard)
app.get("/listings/cache/stats", createProxyMiddleware({
  target: LISTINGS_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: () => "/cache/stats",
  proxyTimeout: 10000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] listings/cache/stats proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "listings upstream error");
    },
  },
}));

app.get("/api/listings/cache/stats", createProxyMiddleware({
  target: LISTINGS_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: () => "/cache/stats",
  proxyTimeout: 10000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] api/listings/cache/stats proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "listings upstream error");
    },
  },
}));

app.get("/shopping/cache/stats", createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: () => "/cache/stats",
  proxyTimeout: 10000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] shopping/cache/stats proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

app.get("/api/shopping/cache/stats", createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: () => "/cache/stats",
  proxyTimeout: 10000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] api/shopping/cache/stats proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

// Python AI and Auction Monitor health (Caddy routes /ai/healthz and /auctions/healthz here; must be public, no auth)
app.get("/ai/healthz", createProxyMiddleware({
  target: PYTHON_AI_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: () => "/healthz",
  proxyTimeout: 10000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] ai/healthz proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "python-ai upstream error");
    },
  },
}));
app.get("/auctions/healthz", createProxyMiddleware({
  target: AUCTION_MONITOR_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: () => "/healthz",
  proxyTimeout: 10000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auctions/healthz proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auction-monitor upstream error");
    },
  },
}));

// Listings health check - must be before auth guard
app.get("/listings/healthz", createProxyMiddleware({
  target: LISTINGS_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: () => "/healthz",
  proxyTimeout: 10000, // Increased timeout for health checks
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      console.log(`[gw] Proxying GET ${req.path} to listings-service${proxyReq.path}`);
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] listings/healthz GET proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "listings upstream error");
    },
  },
}));

app.head("/listings/healthz", createProxyMiddleware({
  target: LISTINGS_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: () => "/healthz",
  proxyTimeout: 5000, // Reduced timeout to fail faster
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] listings/healthz HEAD proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "listings upstream error");
    },
  },
}));
app.use(
  "/records/metrics",
  createProxyMiddleware({
    target: RECORDS_HTTP_TARGET,
    changeOrigin: true,
    pathRewrite: () => "/metrics",
    proxyTimeout: 10000,
    agent: keepAliveAgent,
  })
);

/* ----------------------- Auth Routes (before auth guard) ----------------------- */
// Logout must be before auth guard to allow token revocation
app.post("/auth/logout", createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: (path) => {
    console.log(`[gw] pathRewrite auth logout: ${path}`);
    return path.replace(/^\/auth/, ''); // Strip /auth prefix
  },
  proxyTimeout: 15000, // Increased timeout for logout (Redis operations)
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      console.log(`[gw] Proxying POST ${req.path} to auth-service${proxyReq.path}`);
      const authHeader = req.headers.authorization;
      if (authHeader) {
        proxyReq.setHeader('Authorization', authHeader);
      }
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/logout proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

// OAuth routes (public, before auth guard)
// Support both /auth/google and /api/auth/google paths
app.get(["/auth/google", "/api/auth/google"], createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: (path) => {
    // Remove /api/auth or /auth prefix, keep /auth/google
    return path.replace(/^\/api\/auth/, "/auth").replace(/^\/auth\/auth/, "/auth");
  },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/google proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

app.get(["/auth/google/callback", "/api/auth/google/callback"], createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: (path) => {
    // Remove /api/auth or /auth prefix, keep /auth/google/callback
    return path.replace(/^\/api\/auth/, "/auth").replace(/^\/auth\/auth/, "/auth");
  },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/google/callback proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

// Passkey authentication start (public, before auth guard - needs email)
// Note: Don't use jsonParser for proxy routes - http-proxy-middleware needs the raw body stream
app.post("/auth/passkeys/authenticate/start", createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/passkeys/authenticate/start proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

// Verification routes (public, before auth guard)
// Note: Don't use jsonParser for proxy routes - http-proxy-middleware needs the raw body stream
app.post("/auth/verify/email/send", createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/verify/email/send proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

app.post("/auth/verify/email/verify", createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/verify/email/verify proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

app.post("/auth/verify/phone/send", createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/verify/phone/send proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

app.post("/auth/verify/phone/verify", createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/verify/phone/verify proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));



/* ----------------------- Logging (helpful while stabilizing) ----------------------- */
app.use((req, _res, next) => {
  console.log(
    `[gw] ${req.method} path=${req.path} orig=${req.originalUrl} open=${isOpenRoute(req)} auth=${!!req.headers.authorization}`
  );
  next();
});

/* ----------------------- gRPC-backed Auth Routes (BEFORE auth guard) ----------------------- */
// Support both /auth/register and /api/auth/register
// These must be defined BEFORE the auth guard middleware
const registerHandler = async (req: Request, res: Response) => {
  const { email, password } = (req.body ?? {}) as {
    email?: string;
    password?: string;
  };
  if (!email || !password) {
    return res.status(400).json({ error: "email/password required" });
  }

  try {
    // Register can be slow (password hashing, DB writes), so use 30s timeout
    // Under load, bcrypt queue can back up and DB queries can be slow
    const response = await promisifyGrpcCall<any>(authGrpcClient, "Register", {
      email,
      password,
    }, 30000); // 30 second timeout for registration (increased from 20s)
    res.status(201).json({
      token: response?.token ?? "",
      user: response?.user ?? null,
    });
  } catch (err: any) {
    console.error("[gw] Register gRPC failed:", err?.code, err?.message, err?.details);
    handleGrpcError(res, err);
  }
};
// Register routes BEFORE auth guard
app.post("/auth/register", jsonParser, registerHandler);
app.post("/api/auth/register", jsonParser, registerHandler);

// Support both /auth/login and /api/auth/login
const loginHandler = async (req: Request, res: Response) => {
  const { email, password, mfaCode } = (req.body ?? {}) as {
    email?: string;
    password?: string;
    mfaCode?: string;
  };
  if (!email || !password) {
    return res.status(400).json({ error: "email/password required" });
  }

  try {
    // Login can be slow under load (bcrypt verification, DB queries), so use 30s timeout
    const response = await promisifyGrpcCall<any>(
      authGrpcClient,
      "Authenticate",
      { email, password, mfa_code: mfaCode }, // Use proto field name (snake_case)
      30000 // 30 second timeout for authentication (increased from default 10s)
    );
    
    // Log full response structure for debugging
    console.log(`[gw] Login response structure:`, JSON.stringify({
      hasToken: !!response?.token,
      tokenLength: response?.token?.length ?? 0,
      requiresMFA: response?.requiresMFA,
      userRequiresMFA: response?.user?.requiresMFA,
      userId: response?.userId ?? response?.user?.id,
      hasUser: !!response?.user,
      message: response?.message,
      fullResponseKeys: Object.keys(response || {}),
    }));
    
    // Check if MFA is required (explicit requires_mfa flag from proto)
    // Support both snake_case (proto) and camelCase (legacy) for compatibility
    const requiresMFA = response?.requires_mfa === true || response?.requiresMFA === true;
    const hasEmptyToken = !response?.token || response?.token === "";
    const hasUserId = !!(response?.user_id || response?.userId || response?.user?.id);
    
    // If requires_mfa is true OR (token is empty AND we have a userId) - this indicates MFA required
    // Empty token + userId means MFA is required (gRPC returns empty token when MFA needed)
    if (requiresMFA || (hasEmptyToken && hasUserId)) {
      console.log(`[gw] ✅ MFA required detected - requires_mfa=${response?.requires_mfa}, requiresMFA=${response?.requiresMFA}, hasEmptyToken=${hasEmptyToken}, hasUserId=${hasUserId}`);
      return res.status(200).json({
        requiresMFA: true,
        userId: response?.user_id ?? response?.userId ?? response?.user?.id ?? null,
        message: response?.message ?? "MFA code required",
      });
    }
    
    // If we have an empty token but no userId, log warning
    if (hasEmptyToken && !hasUserId) {
      console.warn(`[gw] ⚠️ Empty token but no userId - unexpected response structure:`, JSON.stringify(response));
    }
    
    // Normal login response with token
    res.json({
      token: response?.token ?? "",
      refreshToken: response?.refresh_token ?? "",
      user: response?.user ?? null,
    });
  } catch (err: any) {
    console.error("[gw] Login gRPC failed:", err?.code, err?.message, err?.details);
    handleGrpcError(res, err);
  }
};
// Register routes BEFORE auth guard
app.post("/auth/login", jsonParser, loginHandler);
app.post("/api/auth/login", jsonParser, loginHandler);

/* ----------------------- Auth Service gRPC Routes (public, before auth guard) ----------------------- */
// Token validation and refresh endpoints - MOVED TO gRPC for better connection handling
// gRPC uses HTTP/2 with proper connection management, avoiding HTTP proxy connection issues
// These endpoints validate the token themselves, so they're public (no auth guard)

// Validate token handler (gRPC) - with connection logging
const validateTokenHandler = async (req: Request, res: Response) => {
  const connectionStart = Date.now();
  const token = extractBearer(req);
  
  console.log(`[gw] ValidateToken: request received (${Date.now() - connectionStart}ms)`);
  
  if (!token) {
    console.log(`[gw] ValidateToken: missing token (${Date.now() - connectionStart}ms)`);
    return res.status(401).json({ error: "missing token", valid: false });
  }

  try {
    console.log(`[gw] ValidateToken: calling gRPC ValidateToken (${Date.now() - connectionStart}ms)`);
    const response = await promisifyGrpcCall<any>(
      authGrpcClient,
      "ValidateToken",
      { token },
      30000 // 30 second timeout
    );
    
    const duration = Date.now() - connectionStart;
    console.log(`[gw] ValidateToken: success in ${duration}ms`);
    
    if (response?.valid) {
      return res.status(200).json({
        valid: true,
        user: response.user,
      });
    } else {
      return res.status(401).json({ error: "invalid token", valid: false });
    }
  } catch (err: any) {
    const duration = Date.now() - connectionStart;
    console.error(`[gw] ValidateToken: error after ${duration}ms:`, {
      code: err?.code,
      message: err?.message,
      details: err?.details,
    });
    handleGrpcError(res, err);
  }
};

// Refresh token handler (gRPC) - with connection logging
const refreshTokenHandler = async (req: Request, res: Response) => {
  const connectionStart = Date.now();
  
  // Debug logging for token extraction
  const authHeader = req.get("authorization") || req.headers.authorization;
  console.log(`[gw] RefreshToken: request received (${Date.now() - connectionStart}ms)`, {
    hasAuthHeader: !!authHeader,
    authHeaderType: typeof authHeader,
    authHeaderLength: authHeader ? String(authHeader).length : 0,
    authHeaderPreview: authHeader ? String(authHeader).substring(0, 50) : 'none',
  });
  
  const token = extractBearer(req);
  
  if (!token) {
    console.error(`[gw] RefreshToken: missing token (${Date.now() - connectionStart}ms)`, {
      authHeader: authHeader ? String(authHeader).substring(0, 100) : 'none',
      headers: Object.keys(req.headers),
    });
    return res.status(401).json({ error: "missing token" });
  }
  
  console.log(`[gw] RefreshToken: token extracted (${Date.now() - connectionStart}ms)`, {
    tokenLength: token.length,
    tokenPreview: token.substring(0, 20) + '...',
  });

  try {
    console.log(`[gw] RefreshToken: calling gRPC RefreshToken (${Date.now() - connectionStart}ms)`, {
      tokenLength: token.length,
      tokenPreview: token.substring(0, 30) + '...',
    });
    // Proto expects 'refresh_token' field, not 'token'
    const response = await promisifyGrpcCall<any>(
      authGrpcClient,
      "RefreshToken",
      { refresh_token: token }, // Fixed: proto expects refresh_token, not token
      30000 // 30 second timeout
    );
    
    const duration = Date.now() - connectionStart;
    console.log(`[gw] RefreshToken: success in ${duration}ms`);
    
    if (response?.token) {
      return res.status(200).json({ token: response.token });
    } else {
      return res.status(401).json({ error: "invalid token" });
    }
  } catch (err: any) {
    const duration = Date.now() - connectionStart;
    console.error(`[gw] RefreshToken: error after ${duration}ms:`, {
      code: err?.code,
      message: err?.message,
      details: err?.details,
    });
    handleGrpcError(res, err);
  }
};

// Register routes BEFORE auth guard
app.post("/auth/validate", jsonParser, validateTokenHandler);
app.post("/api/auth/validate", jsonParser, validateTokenHandler);
app.post("/auth/refresh", jsonParser, refreshTokenHandler);
app.post("/api/auth/refresh", jsonParser, refreshTokenHandler);

/* ----------------------- OLD HTTP Proxy Routes (REMOVED - replaced with gRPC above) ----------------------- */
// HTTP proxy routes have been replaced with gRPC handlers above for better connection handling
// gRPC uses HTTP/2 with proper connection management, avoiding HTTP proxy connection reset issues

/* ----------------------- AUTH GUARD ----------------------- */
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
        // Add timeout to Redis check to prevent hanging
        const revoked = await Promise.race([
          redis.get(`revoked:${payload.jti}`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redis check timeout')), 500))
        ]) as string | null;
        if (revoked) return res.status(401).json({ error: "token revoked" });
      } catch (e) {
        // If Redis check fails, log but proceed (non-blocking)
        // This allows the service to continue working even if Redis is temporarily unavailable
        console.warn("revocation check failed, proceeding:", (e as Error)?.message);
      }
    }
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
});

/* ----------------------- Listings settings/ratings (first after auth so path /api/listings/* matches) ----------------------- */
// Note: Don't use jsonParser for proxy routes - http-proxy-middleware needs the raw body stream
app.put(["/listings/settings", "/api/listings/settings"], injectIdentityHeadersIfAny, createProxyMiddleware({
  target: LISTINGS_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: () => "/settings",
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      if (req.user?.sub) proxyReq.setHeader("x-user-id", req.user.sub);
      if (req.headers.authorization) proxyReq.setHeader("Authorization", req.headers.authorization as string);
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] listings/settings proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "listings upstream error");
    },
  },
}));
app.post(["/listings/ratings", "/api/listings/ratings"], injectIdentityHeadersIfAny, createProxyMiddleware({
  target: LISTINGS_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: () => "/ratings",
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      if (req.user?.sub) proxyReq.setHeader("x-user-id", req.user.sub);
      if (req.headers.authorization) proxyReq.setHeader("Authorization", req.headers.authorization as string);
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] listings/ratings proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "listings upstream error");
    },
  },
}));

// Public browse/search — must register before catch-all /listings proxy (which treats "search" as :id).
app.get(["/listings/search", "/api/listings/search"], injectIdentityHeadersIfAny, createProxyMiddleware({
  target: LISTINGS_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: () => "/search",
  proxyTimeout: 30000,
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      if (req.user?.sub) proxyReq.setHeader("x-user-id", req.user.sub);
      if (req.headers.authorization) proxyReq.setHeader("Authorization", req.headers.authorization as string);
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] listings/search proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "listings upstream error");
    },
  },
}));

app.get(["/listings/settings", "/api/listings/settings"], injectIdentityHeadersIfAny, createProxyMiddleware({
  target: LISTINGS_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: () => "/settings",
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      if (req.user?.sub) proxyReq.setHeader("x-user-id", req.user.sub);
      if (req.headers.authorization) proxyReq.setHeader("Authorization", req.headers.authorization as string);
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] listings/settings GET proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "listings upstream error");
    },
  },
}));

/* ----------------------- Auth Service HTTP Proxy Routes (protected, after auth guard) ----------------------- */
// These routes require authentication and are proxied to the auth service HTTP endpoint
// Note: /auth/register and /auth/login are handled via gRPC above (and are in OPEN_ROUTES)

// User info endpoint
app.get("/auth/me", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 10000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/me proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

// MFA routes (require auth)
app.post("/auth/mfa/setup", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 30000, // Increased to 30s for bcrypt hashing of backup codes (CPU-intensive)
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/mfa/setup proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

app.post("/auth/mfa/verify", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/mfa/verify proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

app.post("/auth/mfa/disable", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/mfa/disable proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

app.post("/auth/mfa/verify-login", createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/mfa/verify-login proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

// Passkey routes (require auth except authenticate/start which is public)
app.post("/auth/passkeys/register/start", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/passkeys/register/start proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

app.post("/auth/passkeys/register/finish", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/passkeys/register/finish proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

app.post("/auth/passkeys/authenticate/finish", createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/passkeys/authenticate/finish proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

app.get("/auth/passkeys", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 10000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/passkeys proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

app.delete("/auth/passkeys/:id", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 10000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/passkeys/:id proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

// Delete account endpoint
app.delete("/auth/account", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/auth": "" },
  proxyTimeout: 10000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] auth/account DELETE proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

app.delete("/api/auth/account", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: AUTH_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/api/auth": "" },
  proxyTimeout: 10000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] api/auth/account DELETE proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "auth upstream error");
    },
  },
}));

/* ----------------------- Records HTTP passthrough (contract-first; avoids gRPC DTO drift) ----------------------- */
app.use(
  "/records",
  injectIdentityHeadersIfAny,
  createProxyMiddleware({
    target: RECORDS_HTTP_TARGET,
    pathRewrite: (path) => `/records${path}`,
    changeOrigin: false,
    xfwd: true,
    ws: false,
    secure: false,
    proxyTimeout: 10000,
    timeout: 10000,
    agent: keepAliveAgent,
    on: {
      error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
        console.error("[gw] /records proxy error:", err);
        sendJson502(res as NodeServerResponse | Socket, "records upstream error");
      },
    },
  })
);

/* ----------------------- Auth Service HTTP Proxy Routes (protected, after auth guard) ----------------------- */
app.get("/records", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(
      recordsGrpcClient,
      "SearchRecords",
      {
        user_id: userId,
        query: typeof req.query.q === "string" ? req.query.q : "",
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      }
    );
    const items = (response?.records ?? [])
      .map(grpcRecordToHttp)
      .filter(Boolean);
    res.json(items);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.get("/records/:id", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(
      recordsGrpcClient,
      "GetRecord",
      {
        record_id: req.params.id,
        user_id: userId,
      }
    );
    if (!response?.record) {
      return res.status(404).json({ error: "not found" });
    }
    res.json(grpcRecordToHttp(response.record));
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.get(
  "/records/:id/revisions",
  injectIdentityHeadersIfAny,
  createProxyMiddleware({
    target: RECORDS_HTTP_TARGET,
    changeOrigin: false,
    xfwd: true,
    ws: false,
    secure: false,
    proxyTimeout: 10000,
    timeout: 10000,
    agent: keepAliveAgent,
    on: {
      error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
        console.error("[gw] /records/:id/revisions proxy error:", err);
        sendJson502(res as NodeServerResponse | Socket, "records upstream error");
      },
    },
  })
);

app.post("/records", jsonParser, async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(
      recordsGrpcClient,
      "CreateRecord",
      {
        user_id: userId,
        record: mapHttpRecordToGrpcInput(req.body),
      }
    );
    res.status(201).json(grpcRecordToHttp(response?.record));
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.put(
  "/records/:id",
  jsonParser,
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserIdFromRequest(req, res);
    if (!userId) return;

    try {
      const response = await promisifyGrpcCall<any>(
        recordsGrpcClient,
        "UpdateRecord",
        {
          record_id: req.params.id,
          user_id: userId,
          record: mapHttpRecordToGrpcInput(req.body),
        }
      );
      res.json(grpcRecordToHttp(response?.record));
    } catch (err) {
      handleGrpcError(res, err);
    }
  }
);

app.delete("/records/:id", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    await promisifyGrpcCall(recordsGrpcClient, "DeleteRecord", {
      record_id: req.params.id,
      user_id: userId,
    });
    res.status(204).end();
  } catch (err) {
    handleGrpcError(res, err);
  }
});

/* ----------------------- Debug helper after guard ----------------------- */
app.get("/__whoami", (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user ?? null });
});

/* ----------------------- Local error logging (pre-proxy) ----------------------- */
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error) console.error("records service error:", err.stack || err.message);
  else console.error("records service error:", err);
  if (!res.headersSent) res.status(500).json({ error: "internal" });
});

/* =========================================================
   PROXIES
   - nginx strips /api, so HPM sees paths starting with /auth, /records, ...
   - Identity headers are injected via middleware *before* the proxy.
   ========================================================= */

/* Listings — settings and ratings are handled above (first after auth guard). Other /listings/* below. */
// Note: /listings/healthz is handled by specific route above (line 298)
app.use(
  "/listings",
  injectIdentityHeadersIfAny,
  createProxyMiddleware({
    target: LISTINGS_HTTP_TARGET,
    changeOrigin: true,
    // http-proxy-middleware strips the matched path prefix (/listings), so we need to add it back
    // If path is empty or just "/", it means POST /listings, so we keep it as /listings
    // /listings/settings and /listings/ratings are mounted at root on listings-service
    pathRewrite: (path, req) => {
      const raw = path || req.url || "";
      const p = raw.replace(/^\/+/, "") || "";
      if (!p) {
        return "/listings";
      }
      // listings-service has app.use("/settings") and app.use("/ratings") at root
      const withoutListings = p.replace(/^listings\/?/, "");
      if (withoutListings === "settings" || withoutListings.startsWith("settings/")) {
        return "/" + withoutListings;
      }
      if (withoutListings === "ratings" || withoutListings.startsWith("ratings/")) {
        return "/" + withoutListings;
      }
      // listings-service exposes GET /search at app root (not /listings/search).
      if (withoutListings === "search" || withoutListings.startsWith("search/")) {
        return "/" + withoutListings;
      }
      const rest = withoutListings || p;
      return rest ? `/listings/${rest}` : "/listings";
    },
    proxyTimeout: 30000, // Increased timeout for HTTP/3 requests
    agent: keepAliveAgent,
    on: {
      proxyReq: (proxyReq: any, req: AuthedRequest) => {
        console.log(`[gw] Proxying ${req.method} ${req.path} to listings-service${proxyReq.path}`, {
          originalPath: req.originalUrl,
          query: req.query,
          userId: req.user?.sub,
        });
        if (req.user?.sub) {
          proxyReq.setHeader('x-user-id', req.user.sub);
        }
        const authHeader = req.headers.authorization;
        if (authHeader) {
          proxyReq.setHeader('Authorization', authHeader);
        }
      },
      proxyRes: (proxyRes: any) => {
        const h = proxyRes.headers as Record<string, string>;
        if (!h["cache-control"]) h["cache-control"] = "public, max-age=60, s-maxage=300";
        console.log(`[gw] Received response from listings-service: ${proxyRes.statusCode}`);
      },
      error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
        console.error("[gw] listings proxy error:", {
          message: err.message,
          code: (err as any).code,
          path: (_req as any).path,
          stack: (err as any).stack,
        });
        sendJson502(res as NodeServerResponse | Socket, "listings upstream error");
      },
    },
  })
);

app.use(
  "/analytics/healthz",
  createProxyMiddleware({
    target: ANALYTICS_HTTP_TARGET,
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 10000,
    agent: keepAliveAgent,
  })
);

/* Analytics — protected */
app.use(
  "/analytics",
  injectIdentityHeadersIfAny,
  createProxyMiddleware({
    target: ANALYTICS_HTTP_TARGET,
    changeOrigin: true,
    proxyTimeout: 15000,
    agent: keepAliveAgent,
    on: {
      error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
        console.error("[gw] analytics proxy error:", err);
        sendJson502(res as NodeServerResponse | Socket, "analytics upstream error");
      },
    },
  })
);

app.use(
  "/auctions",
  injectIdentityHeadersIfAny,
  createProxyMiddleware({
    target: AUCTION_MONITOR_HTTP_TARGET,
    changeOrigin: true,
    pathRewrite: { "^/auctions": "" },
    proxyTimeout: 30000,
    agent: keepAliveAgent,
    on: {
      error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
        console.error("[gw] auction-monitor proxy error:", err);
        sendJson502(res as NodeServerResponse | Socket, "auction-monitor upstream error");
      },
    },
  })
);

/* Python AI — strip /ai, forward identity if present */
app.use(
  "/ai",
  injectIdentityHeadersIfAny,
  createProxyMiddleware({
    target: PYTHON_AI_HTTP_TARGET,
    changeOrigin: true,
    pathRewrite: { "^/ai": "" },
    proxyTimeout: 15000,
    agent: keepAliveAgent,
    on: {
      proxyRes(proxyRes) {
        const h = proxyRes.headers as Record<string, string>;
        if (!h["cache-control"]) h["cache-control"] = "public, max-age=120, s-maxage=600";
      },
      error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
        console.error("[gw] ai proxy error:", err);
        sendJson502(res as NodeServerResponse | Socket, "ai upstream error");
      },
    },
  })
);

/* ----------------------- Service Health Endpoints (Public, Before Auth Guard) ----------------------- */
// social-service removed — use /messaging via marketplace-http-proxies


/* ----------------------- Shopping Service HTTP Route Aliases (for /api/cart, /api/orders, etc.) ----------------------- */
// MOVED AFTER AUTH GUARD - These routes require authentication
// Test script calls /api/cart which becomes /cart after Caddy strips /api
// Shopping service uses requireUser middleware which checks Authorization header directly
// We forward both Authorization header and inject x-user-id for compatibility

// Cart checkout route (must be BEFORE general /cart route to match /cart/checkout first)
// Note: For app.post() specific routes, http-proxy-middleware doesn't strip the prefix
// So pathRewrite receives the full path /cart/checkout
// Shopping service has router.post('/checkout', ...) mounted at /cart, so it expects /cart/checkout
app.post("/cart/checkout", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: (path, req) => {
    // path is /cart/checkout (full path, not stripped for specific routes)
    // Shopping service has router.post('/checkout', ...) mounted at /cart
    // So the full path in shopping service is /cart/checkout
    // We need to keep /cart/checkout as-is (don't strip /cart)
    const rewritten = path; // Keep /cart/checkout as-is
    console.log(`[gw] pathRewrite cart checkout: originalPath=${req.originalUrl}, path=${path}, rewritten=${rewritten}`);
    return rewritten;
  },
  proxyTimeout: 30000,
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      console.log(`[gw] Proxying POST ${req.path} to shopping-service${proxyReq.path}`);
      const authHeader = req.headers.authorization;
      if (authHeader) {
        proxyReq.setHeader('Authorization', authHeader);
      }
      const userId = req.headers['x-user-id'];
      if (userId) {
        proxyReq.setHeader('x-user-id', userId as string);
      }
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] /cart/checkout proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

// General /cart route (excludes /cart/checkout which is handled by specific route above)
app.use("/cart", (req, res, next) => {
  // Skip /cart/checkout - it's handled by the specific route above
  if (req.path === "/checkout" || req.originalUrl?.startsWith("/cart/checkout")) {
    return next("route"); // Skip this middleware, try next route
  }
  next();
});
app.use("/cart", injectIdentityHeadersIfAny);
app.use("/cart", createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  // http-proxy-middleware strips the matched prefix (/cart) before pathRewrite
  // So /cart becomes /, and /cart/checkout becomes /checkout
  // We need to add /cart back
  pathRewrite: (path, req) => {
    const rewritten = `/cart${path === '/' ? '' : path}`;
    console.log(`[gw] pathRewrite: ${req.path} -> ${path} -> ${rewritten}`);
    return rewritten;
  },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      console.log(`[gw] Proxying ${req.method} ${req.path} to shopping-service${proxyReq.path}`);
      // Ensure Authorization header is forwarded to shopping service
      const authHeader = req.headers.authorization;
      if (authHeader) {
        proxyReq.setHeader('Authorization', authHeader);
      }
      // Also ensure x-user-id is set (from injectIdentityHeadersIfAny)
      const userId = req.headers['x-user-id'];
      if (userId) {
        proxyReq.setHeader('x-user-id', userId as string);
      }
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] /cart proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

app.use("/orders", injectIdentityHeadersIfAny);
app.use("/orders", createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: (path, req) => {
    // http-proxy-middleware strips /orders prefix, so path is / or empty
    // Shopping service has router.get('/', ...) mounted at /orders
    // So we need to send /orders (or /orders/ if path is /)
    const rewritten = path === '/' || !path ? '/orders' : `/orders${path}`;
    console.log(`[gw] pathRewrite orders: originalPath=${req.originalUrl}, path=${path}, rewritten=${rewritten}`);
    return rewritten;
  },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      console.log(`[gw] Proxying ${req.method} ${req.path} to shopping-service${proxyReq.path}`);
      const authHeader = req.headers.authorization;
      if (authHeader) {
        proxyReq.setHeader('Authorization', authHeader);
      }
      const userId = req.headers['x-user-id'];
      if (userId) {
        proxyReq.setHeader('x-user-id', userId as string);
      }
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] /orders proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

app.use("/history", injectIdentityHeadersIfAny);
app.use("/history", createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: (path, req) => {
    const rewritten = `/history${path === '/' ? '' : path}`;
    console.log(`[gw] pathRewrite history: ${req.path} -> ${path} -> ${rewritten}`);
    return rewritten;
  },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      const authHeader = req.headers.authorization;
      if (authHeader) {
        proxyReq.setHeader('Authorization', authHeader);
      }
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] /history proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

// /api/resell/* — same as /resell but for clients that call /api/resell (e.g. Test 13j7/13j8 via HTTP/3)
// Without this, GET /api/resell/purchases and POST /api/resell/:id return 404.
// pathRewrite: request path is full e.g. /api/resell/<uuid> → upstream must be /resell/<uuid> (shopping mounts router at /resell).
app.use("/api/resell", injectIdentityHeadersIfAny);
app.use("/api/resell", createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: (path) => (path?.replace(/^\/api\/resell/, "/resell") || "/resell"),
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      const authHeader = req.headers.authorization;
      if (authHeader) proxyReq.setHeader("Authorization", authHeader);
      const userId = req.headers["x-user-id"];
      if (userId) proxyReq.setHeader("x-user-id", userId as string);
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] /api/resell proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

app.use("/resell", injectIdentityHeadersIfAny);
app.use("/resell", createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: (path, req) => {
    // http-proxy-middleware strips /resell prefix, so /resell/purchases becomes /purchases
    // Shopping service has router.get('/purchases', ...) mounted at /resell
    // So we need to send /resell/purchases
    const rewritten = path === '/' || !path ? '/resell' : `/resell${path}`;
    console.log(`[gw] pathRewrite resell: originalPath=${req.originalUrl}, path=${path}, rewritten=${rewritten}`);
    return rewritten;
  },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      console.log(`[gw] Proxying ${req.method} ${req.path} to shopping-service${proxyReq.path}`);
      const authHeader = req.headers.authorization;
      if (authHeader) {
        proxyReq.setHeader('Authorization', authHeader);
      }
      const userId = req.headers['x-user-id'];
      if (userId) {
        proxyReq.setHeader('x-user-id', userId as string);
      }
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] /resell proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

// Returns (eBay-style) — Test 13g; shopping-service has /returns with GET / and POST /
app.use("/returns", injectIdentityHeadersIfAny);
app.use("/returns", createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: (path, req) => {
    const rewritten = path === '/' || !path ? '/returns' : `/returns${path}`;
    console.log(`[gw] pathRewrite returns: originalPath=${req.originalUrl}, path=${path}, rewritten=${rewritten}`);
    return rewritten;
  },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq: any, req: AuthedRequest) => {
      console.log(`[gw] Proxying ${req.method} ${req.path} to shopping-service${proxyReq.path}`);
      const authHeader = req.headers.authorization;
      if (authHeader) {
        proxyReq.setHeader('Authorization', authHeader);
      }
      const userId = req.headers['x-user-id'];
      if (userId) {
        proxyReq.setHeader('x-user-id', userId as string);
      }
    },
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] /returns proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));


/* ----------------------- gRPC-backed Shopping Routes ----------------------- */
// Shopping Cart routes
app.get("/shopping/cart", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "GetCart", {
      user_id: userId,
    });
    res.json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.post("/shopping/cart", jsonParser, async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "AddToCart", {
      user_id: userId,
      item_type: req.body.item_type,
      item_id: req.body.item_id,
      quantity: req.body.quantity || 1,
      listing_id: req.body.listing_id,
      price: req.body.price,
      metadata: req.body.metadata ? JSON.stringify(req.body.metadata) : undefined,
    });
    res.status(201).json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.delete("/shopping/cart/:itemId", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "RemoveFromCart", {
      user_id: userId,
      cart_item_id: req.params.itemId,
    });
    res.json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.delete("/shopping/cart", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "ClearCart", {
      user_id: userId,
    });
    res.json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

// Watchlist routes
app.get("/shopping/watchlist", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "GetWatchlist", {
      user_id: userId,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.post("/shopping/watchlist", jsonParser, async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "AddToWatchlist", {
      user_id: userId,
      item_type: req.body.item_type,
      item_id: req.body.item_id,
      listing_id: req.body.listing_id,
      notify_on: req.body.notify_on || [],
      metadata: req.body.metadata ? JSON.stringify(req.body.metadata) : undefined,
    });
    res.status(201).json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.delete("/shopping/watchlist/:itemType/:itemId", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "RemoveFromWatchlist", {
      user_id: userId,
      item_type: req.params.itemType,
      item_id: req.params.itemId,
    });
    res.json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

// Recently Viewed routes
app.get("/shopping/recently-viewed", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "GetRecentlyViewed", {
      user_id: userId,
      item_type: req.query.item_type as string,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    res.json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.post("/shopping/recently-viewed", jsonParser, async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "AddRecentlyViewed", {
      user_id: userId,
      item_type: req.body.item_type,
      item_id: req.body.item_id,
      metadata: req.body.metadata ? JSON.stringify(req.body.metadata) : undefined,
    });
    res.status(201).json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

// Wishlist routes
app.get("/shopping/wishlist", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "GetWishlist", {
      user_id: userId,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.post("/shopping/wishlist", jsonParser, async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "AddToWishlist", {
      user_id: userId,
      item_type: req.body.item_type,
      item_id: req.body.item_id,
      listing_id: req.body.listing_id,
      priority: req.body.priority || 0,
      notes: req.body.notes,
      metadata: req.body.metadata ? JSON.stringify(req.body.metadata) : undefined,
    });
    res.status(201).json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.delete("/shopping/wishlist/:itemType/:itemId", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "RemoveFromWishlist", {
      user_id: userId,
      item_type: req.params.itemType,
      item_id: req.params.itemId,
    });
    res.json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

// Purchase History routes
app.get("/shopping/purchases", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "GetPurchaseHistory", {
      user_id: userId,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.post("/shopping/purchases", jsonParser, async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "AddPurchase", {
      user_id: userId,
      order_id: req.body.order_id,
      item_type: req.body.item_type,
      item_id: req.body.item_id,
      listing_id: req.body.listing_id,
      quantity: req.body.quantity || 1,
      price_paid: req.body.price_paid,
      currency: req.body.currency || "USD",
      purchase_type: req.body.purchase_type,
      status: req.body.status || "completed",
      metadata: req.body.metadata ? JSON.stringify(req.body.metadata) : undefined,
    });
    res.status(201).json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

// Search History routes
app.get("/shopping/searches", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "GetSearchHistory", {
      user_id: userId,
      query_type: req.query.query_type as string,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    res.json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.post("/shopping/searches", jsonParser, async (req: AuthedRequest, res: Response) => {
  const userId = requireUserIdFromRequest(req, res);
  if (!userId) return;

  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "AddSearch", {
      user_id: userId,
      query: req.body.query,
      query_type: req.body.query_type,
      filters: req.body.filters ? JSON.stringify(req.body.filters) : undefined,
      result_count: req.body.result_count,
      clicked_item: req.body.clicked_item,
    });
    res.status(201).json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.get("/shopping/searches/trending", async (req: AuthedRequest, res: Response) => {
  try {
    const response = await promisifyGrpcCall<any>(shoppingGrpcClient, "GetTrendingSearches", {
      query_type: req.query.query_type as string,
      limit: req.query.limit ? Number(req.query.limit) : 20,
      time_range: req.query.time_range as string || "24h",
    });
    res.json(response);
  } catch (err) {
    handleGrpcError(res, err);
  }
});


/* ----------------------- Shopping Service HTTP Routes (checkout, orders, resell, history) ----------------------- */
// Shopping Cart Checkout (HTTP proxy to shopping-service)
app.post("/shopping/cart/checkout", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/shopping": "" }, // Remove /shopping prefix, shopping-service expects /cart/checkout
  proxyTimeout: 30000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] shopping/cart/checkout proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

// Shopping Orders Routes (HTTP proxy)
app.get("/shopping/orders", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/shopping": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] shopping/orders proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

app.get("/shopping/orders/:orderId", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/shopping": "" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] shopping/orders/* proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

// Shopping Purchase History Routes (HTTP proxy)
app.get("/shopping/history/purchases", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/shopping/history": "/history" }, // Map /shopping/history to /history
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] shopping/history/purchases proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

// Shopping Resell Routes (HTTP proxy)
app.get("/shopping/resell/purchases", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/shopping/resell": "/resell" }, // Map /shopping/resell to /resell
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] shopping/resell/purchases proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

app.post("/shopping/resell/purchases/:purchaseId", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/shopping/resell": "/resell" },
  proxyTimeout: 30000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] shopping/resell/purchases/* proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));

// Shopping Search History Route (HTTP proxy)
app.post("/shopping/history/search", injectIdentityHeadersIfAny, createProxyMiddleware({
  target: SHOPPING_HTTP_TARGET,
  changeOrigin: true,
  pathRewrite: { "^/shopping/history": "/history" },
  proxyTimeout: 15000,
  agent: keepAliveAgent,
  on: {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error("[gw] shopping/history/search proxy error:", err);
      sendJson502(res as NodeServerResponse | Socket, "shopping upstream error");
    },
  },
}));


/* ----------------------- Marketplace (messaging / media / trust / notification) ----------------------- */
registerMarketplaceHttpProxies({
  app,
  keepAliveAgent,
  injectIdentityHeadersIfAny,
  sendJson502,
});

/* ----------------------- Final safety net ----------------------- */
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error("[gw] Unhandled error (catch-all):", msg, stack || "");
  if (!res.headersSent) res.status(500).json({ error: "internal" });
});

  return app;
}