import { coverageExcludeForPlatformService } from "../../infra/vitest-coverage-pragmatic-excludes";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "json-summary"],
      reportsDirectory: "./coverage",
      exclude: [...coverageExcludeForPlatformService("default")],
    },
  },
});
