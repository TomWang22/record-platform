import type { Express, Request, Response } from "express";
import { register } from "@common/utils";
import { GATEWAY_ROUTE_MANIFEST } from "./gateway-route-manifest.js";

const READY_PROBE_MS = 2000;

export type HealthDeps = {
  authGrpcClient: { waitForReady: (deadline: number, cb: (err: Error | null) => void) => void };
};

async function probeDependency(
  label: string,
  probe: () => Promise<void>
): Promise<"ready" | "degraded" | "skipped"> {
  try {
    await Promise.race([
      probe(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} probe timeout`)), READY_PROBE_MS)
      ),
    ]);
    return "ready";
  } catch {
    return "degraded";
  }
}

export function mountGatewayHealth(app: Express, deps: HealthDeps): void {
  app.get("/whoami", (_req: Request, res: Response) =>
    res.json({ pod: process.env.HOSTNAME || require("os").hostname() })
  );

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true, service: "api-gateway", process: "up" });
  });

  app.get("/readyz", async (_req: Request, res: Response) => {
    const dependencies: Record<string, string> = {};
    const auth = await probeDependency("auth", () =>
      new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + READY_PROBE_MS;
        deps.authGrpcClient.waitForReady(deadline, (err: Error | null) =>
          err ? reject(err) : resolve()
        );
      })
    );
    dependencies.auth = auth;
    for (const group of GATEWAY_ROUTE_MANIFEST) {
      if (group.id === "auth") continue;
      dependencies[group.id] = "skipped";
    }
    res.json({ ok: true, service: "api-gateway", dependencies });
  });

  app.get(["/readyz/details", "/dependencies"], async (_req: Request, res: Response) => {
    const dependencies: Record<string, string> = {};
    dependencies.auth = await probeDependency("auth", () =>
      new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + READY_PROBE_MS;
        deps.authGrpcClient.waitForReady(deadline, (err: Error | null) =>
          err ? reject(err) : resolve()
        );
      })
    );
    for (const group of GATEWAY_ROUTE_MANIFEST) {
      if (group.id === "auth") continue;
      dependencies[group.id] = "skipped";
    }
    res.json({ ok: true, service: "api-gateway", dependencies, manifest: GATEWAY_ROUTE_MANIFEST.length });
  });

  app.get("/metrics", async (_req: Request, res: Response) => {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  });
}
