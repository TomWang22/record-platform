/** Shared vitest coverage excludes for ported OCH/RP services. */
export function coverageExcludeForHousingService(_profile: "default"): string[] {
  return [
    "dist/**",
    "**/*.d.ts",
    "src/generated/**",
    "src/**/index.ts",
    "tests/**",
    "vitest.config.ts",
  ];
}
