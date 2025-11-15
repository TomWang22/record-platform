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

import { register, httpCounter } from "@common/utils/metrics";
import { verifyJwt, type JwtPayload as TokenPayload } from "@common/utils/auth";
import {
  createAuthClient,
  createRecordsClient,
  promisifyGrpcCall,
} from "@common/utils/grpc-clients";

import { createClient } from "redis";
import type { ServerResponse as NodeServerResponse } from "http";
import { Agent as HttpAgent } from "http";
import type { Socket } from "net";


// one shared agent (tune if needed)
const keepAliveAgent = new HttpAgent({
  keepAlive: true,
  maxSockets: 512,
  maxFreeSockets: 256,
  keepAliveMsecs: 30_000,
});

const AUTH_GRPC_TARGET = process.env.AUTH_GRPC_TARGET || "auth-service:50051";
const RECORDS_GRPC_TARGET =
  process.env.RECORDS_GRPC_TARGET || "records-service:50051";

const authGrpcClient = createAuthClient(AUTH_GRPC_TARGET);
const recordsGrpcClient = createRecordsClient(RECORDS_GRPC_TARGET);

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
  const status = grpcStatusToHttp[err?.code ?? -1] ?? 500;
  const message = err?.details || err?.message || "grpc error";
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

/* ----------------------- App init ----------------------- */
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

/* ----------------------- Gateway own endpoints ----------------------- */
app.get("/whoami", (_req, res) =>
  res.json({ pod: process.env.HOSTNAME || require("os").hostname() })
);
app.get("/healthz", (_req: Request, res: Response) => res.json({ ok: true }));
app.get("/metrics", async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

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
  windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.path === "/healthz" || req.path === "/metrics",
});
app.use(limiter);

/* =========================================================
   PRE-GUARD DIRECT HEALTH/METRICS (never require auth)
   ========================================================= */
app.use(
  "/auth/healthz",
  createProxyMiddleware({
    target: "http://auth-service:4001",
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 10000,
    agent: keepAliveAgent,
  })
);
app.use(
  "/auth/metrics",
  createProxyMiddleware({
    target: "http://auth-service:4001",
    changeOrigin: true,
    pathRewrite: () => "/metrics",
    proxyTimeout: 10000,
    agent: keepAliveAgent,
  })
);
app.use(
  "/records/healthz",
  createProxyMiddleware({
    target: "http://records-service:4002",
    changeOrigin: true,
    pathRewrite: () => "/healthz",
    proxyTimeout: 10000,
    agent: keepAliveAgent,
  })
);
app.use(
  "/records/metrics",
  createProxyMiddleware({
    target: "http://records-service:4002",
    changeOrigin: true,
    pathRewrite: () => "/metrics",
    proxyTimeout: 10000,
    agent: keepAliveAgent,
  })
);

/* ----------------------- Open-route matcher (for other cases) ----------------------- */
type RouteRule = { method: string; pattern: RegExp };
const OPEN_ROUTES: RouteRule[] = [
  { method: "GET",  pattern: /^\/(?:api\/)?healthz\/?$/ },
  { method: "HEAD", pattern: /^\/(?:api\/)?healthz\/?$/ },
  { method: "GET",  pattern: /^\/(?:api\/)?metrics\/?$/ },
  { method: "HEAD", pattern: /^\/(?:api\/)?metrics\/?$/ },

  // auth entrypoints
  { method: "POST", pattern: /^\/(?:api\/)?auth\/(login|register)\/?$/ },

  // public GETs
  { method: "GET",  pattern: /^\/(?:api\/)?listings(?:\/|$)/ },
  { method: "GET",  pattern: /^\/(?:api\/)?ai(?:\/|$)/ },
];
const isOpenRoute = (req: Request) => {
  // Check both path and originalUrl (path is what Express sees, originalUrl includes query)
  const path = req.path || req.url || "";
  const originalPath = req.originalUrl?.split('?')[0] || path;
  // Try both paths in case ingress rewrites differently
  return OPEN_ROUTES.some((r) => 
    r.method === req.method && (r.pattern.test(path) || r.pattern.test(originalPath))
  );
};

/* ----------------------- Logging (helpful while stabilizing) ----------------------- */
app.use((req, _res, next) => {
  console.log(
    `[gw] ${req.method} path=${req.path} orig=${req.originalUrl} open=${isOpenRoute(req)} auth=${!!req.headers.authorization}`
  );
  next();
});

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

/* ----------------------- gRPC-backed Auth Routes ----------------------- */
app.post("/auth/register", jsonParser, async (req: Request, res: Response) => {
  const { email, password } = (req.body ?? {}) as {
    email?: string;
    password?: string;
  };
  if (!email || !password) {
    return res.status(400).json({ error: "email/password required" });
  }

  try {
    const response = await promisifyGrpcCall<any>(authGrpcClient, "Register", {
      email,
      password,
    });
    res.status(201).json({
      token: response?.token ?? "",
      user: response?.user ?? null,
    });
  } catch (err) {
    handleGrpcError(res, err);
  }
});

app.post("/auth/login", jsonParser, async (req: Request, res: Response) => {
  const { email, password } = (req.body ?? {}) as {
    email?: string;
    password?: string;
  };
  if (!email || !password) {
    return res.status(400).json({ error: "email/password required" });
  }

  try {
    const response = await promisifyGrpcCall<any>(
      authGrpcClient,
      "Authenticate",
      { email, password }
    );
    res.json({
      token: response?.token ?? "",
      refreshToken: response?.refresh_token ?? "",
      user: response?.user ?? null,
    });
  } catch (err) {
    handleGrpcError(res, err);
  }
});

/* ----------------------- gRPC-backed Records Routes ----------------------- */
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

/* Listings — public GETs, but forward identity if present */
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
        if (!h["cache-control"]) h["cache-control"] = "public, max-age=60, s-maxage=300";
      },
      error(err, _req, res) {
        console.error("[gw] listings proxy error:", err);
        sendJson502(res as NodeServerResponse | Socket, "listings upstream error");
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
        sendJson502(res as NodeServerResponse | Socket, "analytics upstream error");
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
        if (!h["cache-control"]) h["cache-control"] = "public, max-age=120, s-maxage=600";
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