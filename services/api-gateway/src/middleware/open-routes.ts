import type { Request } from "express";

type RouteRule = { method: string; pattern: RegExp };

export const OPEN_ROUTES: RouteRule[] = [
  { method: "GET", pattern: /^\/(?:api\/)?healthz\/?$/ },
  { method: "HEAD", pattern: /^\/(?:api\/)?healthz\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?readyz\/?$/ },
  { method: "HEAD", pattern: /^\/(?:api\/)?readyz\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?metrics\/?$/ },
  { method: "HEAD", pattern: /^\/(?:api\/)?metrics\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?dependencies\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?readyz\/details\/?$/ },

  { method: "GET", pattern: /^\/auctions\/healthz\/?$/ },
  { method: "GET", pattern: /^\/ai\/healthz\/?$/ },
  {
    method: "GET",
    pattern:
      /^\/(?:api\/)?(auth|records|listings|shopping|analytics|ai|auctions|auction-monitor|python-ai|messaging|media|trust|notification)\/healthz\/?$/,
  },
  {
    method: "HEAD",
    pattern:
      /^\/(?:api\/)?(auth|records|listings|shopping|analytics|ai|auctions|auction-monitor|python-ai|messaging|media|trust|notification)\/healthz\/?$/,
  },

  { method: "GET", pattern: /^\/(?:api\/)?(listings|shopping)\/cache\/stats\/?$/ },

  { method: "POST", pattern: /^\/(?:api\/)?auth\/(login|register|validate|refresh)\/?$/ },
  { method: "POST", pattern: /^\/(?:api\/)?auth\/dev\/align-password\/?$/ },

  { method: "GET", pattern: /^\/(?:api\/)?listings\/(search|$)/ },
  /** Public marketplace detail (vinyl cards; contact-seller reads seller_id). */
  {
    method: "GET",
    pattern:
      /^\/(?:api\/)?listings\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/?$/i,
  },
  { method: "GET", pattern: /^\/(?:api\/)?ai(?:\/|$)/ },

  { method: "POST", pattern: /^\/auth\/logout\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?auth\/google\/?$/ },
  { method: "GET", pattern: /^\/(?:api\/)?auth\/google\/callback\/?$/ },
  { method: "POST", pattern: /^\/auth\/passkeys\/authenticate\/start\/?$/ },
  { method: "POST", pattern: /^\/auth\/passkeys\/authenticate\/finish\/?$/ },
  { method: "POST", pattern: /^\/auth\/verify\/email\/send\/?$/ },
  { method: "POST", pattern: /^\/auth\/verify\/email\/verify\/?$/ },
  { method: "POST", pattern: /^\/auth\/verify\/phone\/send\/?$/ },
  { method: "POST", pattern: /^\/auth\/verify\/phone\/verify\/?$/ },
  { method: "POST", pattern: /^\/auth\/mfa\/verify-login\/?$/ },
];

export function isOpenRoute(req: Request): boolean {
  const path = req.path || req.url || "";
  const originalPath = req.originalUrl?.split("?")[0] || path;
  return OPEN_ROUTES.some(
    (r) => r.method === req.method && (r.pattern.test(path) || r.pattern.test(originalPath))
  );
}
