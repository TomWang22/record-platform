import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GATEWAY_ROUTE_MANIFEST,
  ACTIVE_GATEWAY_SERVICE_IDS,
} from "../gateway-route-manifest.js";
import {
  AUTH_HTTP_TARGET,
  ANALYTICS_HTTP_TARGET,
  ANALYTICS_GRPC_TARGET,
} from "../service-targets.js";

const REPO_ROOT = join(process.cwd(), "../..");

vi.mock("@common/utils/grpc-clients", () => {
  const stub = { waitForReady: (_d: number, cb: (e: Error | null) => void) => cb(null) };
  return {
    createAuthClient: () => stub,
    createRecordsClient: () => stub,
    createListingsClient: () => stub,
    createShoppingClient: () => stub,
    createAuctionMonitorClient: () => stub,
    createPythonAIClient: () => stub,
    promisifyGrpcCall: vi.fn(),
  };
});

describe("gateway route contract", () => {
  let app: import("express").Express;

  beforeAll(async () => {
    const { createApp } = await import("../app.js");
    app = createApp();
  });

  it("GET /healthz returns 200 without auth", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("GET /readyz returns 200 without auth", async () => {
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dependencies).toBeDefined();
  });

  it("POST /records returns 401 without auth", async () => {
    const res = await request(app).post("/records").send({ name: "x" });
    expect(res.status).toBe(401);
  });

  it("manifest includes all active RP backend services", () => {
    const expected = [
      "auth",
      "records",
      "listings",
      "shopping",
      "messaging",
      "media",
      "trust",
      "notification",
      "analytics",
      "python-ai",
      "auction-monitor",
    ];
    expect(ACTIVE_GATEWAY_SERVICE_IDS.sort()).toEqual(expected.sort());
    expect(GATEWAY_ROUTE_MANIFEST.length).toBe(11);
  });

  it("service-targets ports match runtime contract", () => {
    const contract = JSON.parse(
      readFileSync(join(REPO_ROOT, "infra/contracts/rp-service-runtime-contract.json"), "utf8")
    ) as { services: Record<string, { httpPort: number }> };
    expect(AUTH_HTTP_TARGET).toContain(`:${contract.services["auth-service"].httpPort}`);
    expect(ANALYTICS_HTTP_TARGET).toContain(":4017");
    expect(ANALYTICS_HTTP_TARGET).not.toContain(":4004");
    expect(ANALYTICS_GRPC_TARGET).toContain(":50067");
  });

  it("no excluded peer upstream unless legacy flag", () => {
    const legacy = process.env.RP_ENABLE_LEGACY_SOCIAL_ROUTES;
    if (legacy === "1" || legacy === "true") return;
    const stack = readFileSync(join(process.cwd(), "src/proxy/marketplace-routes.ts"), "utf8");
    // /social may exist only as a 308 rewrite to /community; must not proxy to an excluded peer host.
    expect(stack).toMatch(/replace\(\/\^\\\/social\/,\s*"\/community"\)/);
    expect(stack).not.toMatch(/createProxyMiddleware\([^)]*\/social/);
    expect(stack).not.toMatch(/reservation-mesh/);
  });
});
