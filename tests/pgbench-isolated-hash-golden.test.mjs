import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { enumerateExpectedPgbenchCells } from "../scripts/lib/pgbench_completeness.mjs";
import {
  FROZEN_HASH_CELL_ID_CATALOG_SHA256,
  FROZEN_HASH_PARTITION_COUNTS,
  assignCellShard,
  concurrentCellIdCatalogSha256,
  filterCellsForShard,
  hashPartitionCounts,
} from "../scripts/lib/pgbench_shard.mjs";

describe("isolated HASH golden contract", () => {
  it("H1/H2 frozen partition counts sum to 1218", () => {
    assert.deepEqual(hashPartitionCounts(4), [311, 296, 309, 302]);
    assert.deepEqual(hashPartitionCounts(4), [...FROZEN_HASH_PARTITION_COUNTS]);
    assert.equal(hashPartitionCounts(4).reduce((a, b) => a + b, 0), 1218);
  });

  it("H3 cell_id catalog sha256 is frozen", () => {
    const ids = enumerateExpectedPgbenchCells()
      .filter((c) => c.mode === "ALL_OWNERS_CONCURRENT")
      .map((c) => c.cell_id)
      .sort();
    const sha = createHash("sha256").update(ids.join("\n")).digest("hex");
    assert.equal(sha, "9c65197dad369894db6fca4534cb4ca487fab5f6a698488096677a5b16166ff9");
    assert.equal(concurrentCellIdCatalogSha256(), FROZEN_HASH_CELL_ID_CATALOG_SHA256);
    assert.equal(sha, FROZEN_HASH_CELL_ID_CATALOG_SHA256);
  });

  it("H4/H5/H6 deterministic disjoint cover", () => {
    const cells = enumerateExpectedPgbenchCells().filter((c) => c.mode === "ALL_OWNERS_CONCURRENT");
    const seen = new Map();
    for (const cell of cells) {
      const a = assignCellShard(cell, { mode: "HASH", shard_count: 4 });
      const b = assignCellShard(cell, { mode: "HASH", shard_count: 4 });
      assert.equal(a, b);
      assert.ok(a >= 0 && a < 4);
      assert.equal(seen.has(cell.cell_id), false);
      seen.set(cell.cell_id, a);
    }
    assert.equal(seen.size, 1218);
    const sets = [0, 1, 2, 3].map((shard_index) =>
      filterCellsForShard(cells, {
        mode: "HASH",
        shard_count: 4,
        shard_index,
        phase: "ALL_OWNERS_CONCURRENT",
      }).map((c) => c.cell_id),
    );
    assert.deepEqual(sets.map((s) => s.length), [311, 296, 309, 302]);
    const union = new Set(sets.flat());
    assert.equal(union.size, 1218);
  });
});
