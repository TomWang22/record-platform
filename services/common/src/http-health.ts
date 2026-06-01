import type { Application, Request, Response } from "express";

export type RpHttpHealthOptions = {
  service: string;
  readiness?: () => Promise<boolean>;
  liveness?: () => Promise<boolean>;
};

/** Standard RP HTTP probes: /healthz, /health, /readyz. */
export function mountRpHttpHealth(app: Application, options: RpHttpHealthOptions): void {
  const { service, readiness, liveness } = options;

  app.get(["/healthz", "/health"], async (_req: Request, res: Response) => {
    let ok = true;
    if (liveness) {
      try {
        ok = await liveness();
      } catch {
        ok = false;
      }
    }
    res.status(ok ? 200 : 503).json({ ok, service });
  });

  app.get("/readyz", async (_req: Request, res: Response) => {
    if (!readiness) {
      res.json({ ok: true, ready: true, service });
      return;
    }
    try {
      const ready = await readiness();
      if (ready) {
        res.json({ ok: true, ready: true, service });
      } else {
        res.status(503).json({ ok: false, ready: false, service });
      }
    } catch {
      res.status(503).json({ ok: false, ready: false, service });
    }
  });
}
