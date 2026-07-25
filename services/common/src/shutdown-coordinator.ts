/**
 * Shared graceful-shutdown coordinator for Node RP services.
 * State: RUNNING → DRAINING → CLOSING_DEPENDENCIES → TELEMETRY_FLUSH → TERMINATED
 */
export type ShutdownPhase =
  | "RUNNING"
  | "DRAINING"
  | "CLOSING_DEPENDENCIES"
  | "TELEMETRY_FLUSH"
  | "TERMINATED";

export type ShutdownResource = {
  name: string;
  close: () => void | Promise<void>;
  /** Lower runs earlier during CLOSING_DEPENDENCIES (default 100). */
  order?: number;
};

type CoordinatorState = {
  phase: ShutdownPhase;
  service: string;
  resources: ShutdownResource[];
  drainDeadlineMs: number;
  hooksInstalled: boolean;
  drainStartedAt: number | null;
};

const state: CoordinatorState = {
  phase: "RUNNING",
  service: process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME || "unknown",
  resources: [],
  drainDeadlineMs: Number(process.env.RP_SHUTDOWN_DRAIN_MS || "8000"),
  hooksInstalled: false,
  drainStartedAt: null,
};

export function getShutdownPhase(): ShutdownPhase {
  return state.phase;
}

export function isDraining(): boolean {
  return state.phase !== "RUNNING";
}

export function registerShutdownResource(resource: ShutdownResource): void {
  state.resources.push(resource);
}

export function setShutdownServiceName(name: string): void {
  if (name) state.service = name;
}

/** Mark readiness false; safe to call from preStop /drain. */
export function beginDrain(reason = "manual"): void {
  if (state.phase !== "RUNNING") return;
  state.phase = "DRAINING";
  state.drainStartedAt = Date.now();
  console.info(`[shutdown] ${state.service} DRAINING reason=${reason}`);
}

async function closeResources(): Promise<void> {
  state.phase = "CLOSING_DEPENDENCIES";
  const ordered = [...state.resources].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  const errors: string[] = [];
  for (const r of ordered) {
    try {
      await Promise.resolve(r.close());
      console.info(`[shutdown] closed ${r.name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${r.name}: ${msg}`);
      console.error(`[shutdown] close failed ${r.name}:`, e);
    }
  }
  if (errors.length) {
    console.error(`[shutdown] resource close errors: ${errors.join("; ")}`);
  }
}

async function flushTelemetry(): Promise<void> {
  state.phase = "TELEMETRY_FLUSH";
  try {
    const otel = await import("./otel/start-telemetry.js");
    if (typeof (otel as { shutdownTracing?: () => Promise<void> }).shutdownTracing === "function") {
      await (otel as { shutdownTracing: () => Promise<void> }).shutdownTracing();
    }
  } catch {
    /* optional */
  }
}

let inFlight: Promise<void> | null = null;

export async function runShutdown(signal: string): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    beginDrain(signal);
    const remain = Math.max(0, state.drainDeadlineMs - (Date.now() - (state.drainStartedAt || Date.now())));
    if (remain > 0) await new Promise((r) => setTimeout(r, Math.min(remain, 500)));
    await closeResources();
    await flushTelemetry();
    state.phase = "TERMINATED";
    console.info(`[shutdown] ${state.service} TERMINATED after ${signal}`);
  })();
  return inFlight;
}

/** Install once: SIGTERM/SIGINT await cleanup then exit 0. Second signal forces exit 1. */
export function installShutdownSignalHandlers(opts?: { service?: string; drainMs?: number }): void {
  if (opts?.service) setShutdownServiceName(opts.service);
  if (opts?.drainMs) state.drainDeadlineMs = opts.drainMs;
  if (state.hooksInstalled) return;
  state.hooksInstalled = true;

  let forced = false;
  const onSignal = (signal: string) => {
    if (forced) {
      console.error(`[shutdown] second ${signal} — forcing exit`);
      process.exit(1);
    }
    forced = true;
    void runShutdown(signal)
      .catch((e) => console.error("[shutdown] error", e))
      .finally(() => {
        process.exit(0);
      });
  };

  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));

  process.on("uncaughtException", (err) => {
    console.error("[shutdown] uncaughtException", err);
    void runShutdown("uncaughtException").finally(() => process.exit(1));
  });
  process.on("unhandledRejection", (err) => {
    console.error("[shutdown] unhandledRejection", err);
    void runShutdown("unhandledRejection").finally(() => process.exit(1));
  });
}
