/**
 * HTTP reverse proxies for RP marketplace services (messaging, media, trust, notification).
 */
import type { Request, Response, NextFunction } from "express";
import type { ServerResponse as NodeServerResponse } from "http";
import type { Socket } from "net";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { Agent as HttpAgent } from "http";
import {
  MESSAGING_HTTP_TARGET,
  TRUST_HTTP_TARGET,
  MEDIA_HTTP_TARGET,
  NOTIFICATION_HTTP_TARGET,
} from "../service-targets.js";

type AuthedRequest = Request & { user?: { sub?: string; email?: string; jti?: string } };

/** http-proxy-middleware accepts object or function pathRewrite. */
type PathRewrite = Record<string, string> | ((path: string) => string);

type MarketplaceProxyOptions = {
  target: string;
  changeOrigin: boolean;
  pathRewrite: PathRewrite;
  proxyTimeout: number;
  timeout: number;
  agent: HttpAgent | undefined;
  on: {
    error(err: Error, _req: Request, res: Response | Socket): void;
  };
};

export type MarketplaceProxyDeps = {
  app: import("express").Express;
  keepAliveAgent: HttpAgent;
  injectIdentityHeadersIfAny: (req: AuthedRequest, res: Response, next: NextFunction) => void;
  sendJson502: (res: NodeServerResponse | Socket, msg: string) => void;
};

function proxyOpts(
  target: string,
  pathRewrite: PathRewrite,
  timeoutMs = 30_000,
): MarketplaceProxyOptions {
  return {
    target,
    changeOrigin: true,
    pathRewrite,
    proxyTimeout: timeoutMs,
    timeout: timeoutMs,
    agent: undefined as HttpAgent | undefined,
    on: {
      error(err: Error, _req: Request, res: Response | Socket) {
        console.error(`[gw] proxy error → ${target}:`, err.message);
        return sendJson502Proxy(res, "upstream error");
      },
    },
  };
}

function sendJson502Proxy(res: Response | Socket, msg: string) {
  if ("setHeader" in res) {
    const sr = res as NodeServerResponse;
    if (!sr.headersSent) {
      sr.statusCode = 502;
      sr.setHeader("Content-Type", "application/json");
      sr.end(JSON.stringify({ error: msg }));
    }
    return;
  }
  try {
    (res as Socket).destroy();
  } catch {
    /* ignore */
  }
}

export function registerMarketplaceHttpProxies(deps: MarketplaceProxyDeps): void {
  const { app, keepAliveAgent, injectIdentityHeadersIfAny, sendJson502 } = deps;

  const withAgent = (opts: MarketplaceProxyOptions) => ({
    ...opts,
    agent: keepAliveAgent,
    on: {
      error(err: Error, _req: Request, res: Response | Socket) {
        console.error("[gw] marketplace proxy error:", err.message);
        sendJson502(res as NodeServerResponse | Socket, "upstream error");
      },
    },
  });

  app.use(
    "/messaging",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(withAgent(proxyOpts(MESSAGING_HTTP_TARGET, { "^/messaging": "" })) as any)
  );
  app.use(
    "/api/messaging",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(withAgent(proxyOpts(MESSAGING_HTTP_TARGET, { "^/api/messaging": "" })) as any)
  );
  app.use(
    "/community",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(withAgent(proxyOpts(MESSAGING_HTTP_TARGET, { "^/community": "/community" })) as any)
  );
  app.use(
    "/api/community",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(withAgent(proxyOpts(MESSAGING_HTTP_TARGET, { "^/api/community": "/community" })) as any)
  );
  for (const prefix of ["/threads", "/conversations", "/messages"]) {
    app.use(
      prefix,
      injectIdentityHeadersIfAny,
      createProxyMiddleware(withAgent(proxyOpts(MESSAGING_HTTP_TARGET, { [`^${prefix}`]: prefix })) as any)
    );
  }

  app.use(
    "/api/forum",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(
      withAgent(proxyOpts(`${MESSAGING_HTTP_TARGET}/forum`, { "^/": "/" })) as any
    )
  );
  app.use(
    "/api/messages",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(
      withAgent(proxyOpts(`${MESSAGING_HTTP_TARGET}/messages`, { "^/": "/" })) as any
    )
  );

  app.use(
    "/trust",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(withAgent(proxyOpts(TRUST_HTTP_TARGET, { "^/trust": "" })) as any)
  );
  app.use(
    "/api/trust",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(withAgent(proxyOpts(TRUST_HTTP_TARGET, { "^/api/trust": "" })) as any)
  );
  for (const prefix of ["/reputation", "/verification", "/moderation"]) {
    app.use(
      prefix,
      injectIdentityHeadersIfAny,
      createProxyMiddleware(withAgent(proxyOpts(TRUST_HTTP_TARGET, { [`^${prefix}`]: prefix })) as any)
    );
  }

  app.use(
    "/media",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(withAgent(proxyOpts(MEDIA_HTTP_TARGET, { "^/media": "" })) as any)
  );
  app.use(
    "/api/media",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(withAgent(proxyOpts(MEDIA_HTTP_TARGET, { "^/api/media": "" })) as any)
  );
  for (const prefix of ["/uploads", "/assets"]) {
    app.use(
      prefix,
      injectIdentityHeadersIfAny,
      createProxyMiddleware(withAgent(proxyOpts(MEDIA_HTTP_TARGET, { [`^${prefix}`]: prefix })) as any)
    );
  }

  app.use(
    "/notification",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(withAgent(proxyOpts(NOTIFICATION_HTTP_TARGET, { "^/notification": "" })) as any)
  );
  app.use(
    "/api/notification",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(withAgent(proxyOpts(NOTIFICATION_HTTP_TARGET, { "^/api/notification": "" })) as any)
  );
  app.use(
    "/notifications",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(withAgent(proxyOpts(NOTIFICATION_HTTP_TARGET, { "^/notifications": "/notifications" })) as any)
  );
  const notificationsProxyOpts = withAgent({
    ...proxyOpts(NOTIFICATION_HTTP_TARGET, {}),
    pathRewrite: (path: string) =>
      `/notifications${path === "/" || path === "" ? "" : path}`,
  });
  app.use(
    "/api/notifications",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(notificationsProxyOpts as any),
  );
  const feedbackProxyOpts = withAgent({
    ...proxyOpts(TRUST_HTTP_TARGET, {}),
    pathRewrite: (path: string) =>
      `/marketplace-feedback${path === "/" || path === "" ? "" : path}`,
  });
  app.use("/api/feedback", injectIdentityHeadersIfAny, createProxyMiddleware(feedbackProxyOpts as any));
  app.use("/feedback", injectIdentityHeadersIfAny, createProxyMiddleware(feedbackProxyOpts as any));

  const myFeedbackProxyOpts = withAgent({
    ...proxyOpts(TRUST_HTTP_TARGET, {}),
    pathRewrite: () => "/marketplace-feedback/me",
  });
  app.use(
    "/api/profile/feedback",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(myFeedbackProxyOpts as any),
  );
  app.use(
    "/profile/feedback",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(myFeedbackProxyOpts as any),
  );
  app.use(
    "/preferences/notifications",
    injectIdentityHeadersIfAny,
    createProxyMiddleware(
      withAgent(
        proxyOpts(NOTIFICATION_HTTP_TARGET, { "^/preferences/notifications": "/preferences/notifications" })
      ) as any
    )
  );

  const legacySocial =
    process.env.RP_ENABLE_LEGACY_SOCIAL_ROUTES === "1" ||
    process.env.RP_ENABLE_LEGACY_SOCIAL_ROUTES === "true";
  app.use("/social", (req, res, next) => {
    if (legacySocial) return next();
    const target = req.originalUrl?.replace(/^\/social/, "/community") || "/community";
    res.redirect(308, target);
  });
}
