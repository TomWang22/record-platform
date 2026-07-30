/**
 * Housing backend service dirs → Jaeger-style service names (OTEL_SERVICE_NAME matches folder).
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** @param {string} repoRoot */
export function discoverPlatformServiceDirs(repoRoot) {
  const servicesDir = join(repoRoot, "services");
  if (!existsSync(servicesDir)) return [];
  return readdirSync(servicesDir)
    .filter((d) => d.endsWith("-service") && d !== "common-service")
    .sort();
}

/** api-gateway + every *-service (Jaeger process names). */
export function discoverJaegerPlatformServices(repoRoot) {
  const dirs = discoverPlatformServiceDirs(repoRoot);
  return ["api-gateway", ...dirs];
}
