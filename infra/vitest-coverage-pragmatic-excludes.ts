/** Shared vitest coverage excludes for ported RP/RP services. */
export function coverageExcludeForPlatformService(_profile: "default"): string[] {
  return [
    "dist/**",
    "**/*.d.ts",
    "src/generated/**",
    "src/**/index.ts",
    "tests/**",
    "vitest.config.ts",
  ];
}
