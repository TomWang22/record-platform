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

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'","'unsafe-inline'"],
      "style-src": ["'self'","'unsafe-inline'"],
      "img-src": ["'self'","data:","https:"],
      "connect-src": ["'self'"],
      "frame-ancestors": ["'none'"],
      "upgrade-insecure-requests": []
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(cors({ origin: [/localhost:8080$/, /localhost:3001$/], credentials: false }));

// Cast to RequestHandler; avoids overload confusion on some @types combos
app.use(compression() as unknown as import("express").RequestHandler);

app.use(express.json({ limit: "1mb" }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === "string") (req.query as any)[k] = v.replace(/[<>\"'`;(){}]/g, "");
  }
  next();
});
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () => httpCounter.inc({ service: "gateway", route: req.path, method: req.method, code: res.statusCode }));
  next();
});

app.get("/healthz", (_req: Request, res: Response) => res.json({ ok: true }));
app.get("/metrics", async (_req: Request, res: Response) => { res.setHeader("Content-Type", register.contentType); res.end(await register.metrics()); });

const limiter = rateLimit({ windowMs: 60_000, max: 300 });
app.use(limiter);

function authGuard(req: Request & { user?: any }, res: Response, next: NextFunction) {
  if (req.path.startsWith("/auth/")) return next();
  if (req.method === "GET" && (req.path.startsWith("/listings/") || req.path.startsWith("/ai/"))) return next();
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "auth required" });
  try { req.user = verifyJwt(token); next(); } catch { res.status(401).json({ error: "invalid token" }); }
}
app.use(authGuard);

// Use `as any` to allow onProxyRes without fighting d.ts variance
app.use("/auth", createProxyMiddleware({ target: "http://auth-service:4001", changeOrigin: true, pathRewrite: { "^/auth": "" } } as any));
app.use("/records", createProxyMiddleware({ target: "http://records-service:4002", changeOrigin: true } as any));
app.use("/listings", createProxyMiddleware({
  target: "http://listings-service:4003", changeOrigin: true,
  onProxyRes(proxyRes: any){ proxyRes.headers["Cache-Control"] = proxyRes.headers["cache-control"] || "public, max-age=60, s-maxage=300"; }
} as any));
app.use("/analytics", createProxyMiddleware({ target: "http://analytics-service:4004", changeOrigin: true } as any));
app.use("/ai", createProxyMiddleware({
  target: "http://python-ai-service:5005", changeOrigin: true, pathRewrite: {"^/ai": ""},
  onProxyRes(proxyRes: any){ proxyRes.headers["Cache-Control"] = proxyRes.headers["cache-control"] || "public, max-age=120, s-maxage=600"; }
} as any));

app.listen(process.env.GATEWAY_PORT || 4000, () => console.log("gateway up"));
