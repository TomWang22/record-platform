import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const manifestPath = join(repoRoot, "backups/hybrid-rp-och/assembled/manifest.json");

describe("hybrid backup manifest (optional)", () => {
  it("parses manifest when assemble script has been run", () => {
    if (!existsSync(manifestPath)) {
      return;
    }
    const doc = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      restore_order: string[];
      excluded_services: string[];
      assignments: { service: string; link_path: string }[];
    };
    expect(doc.restore_order[0]).toBe("auth");
    expect(doc.excluded_services).toContain("bookings");
    expect(doc.assignments.some((a) => a.service === "messaging")).toBe(true);
    expect(doc.assignments.some((a) => a.service === "records")).toBe(true);
  });
});
