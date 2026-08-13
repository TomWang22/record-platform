/**
 * Gate 3 shard assignment + owner affinity (deterministic).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OWNERS,
  enumerateExpectedPgbenchCells,
} from "../scripts/lib/pgbench_completeness.mjs";
import {
  PER_OWNER_OPERATIONAL_ORDER,
  assignCellShard,
  filterCellsForShard,
  ownerAffinityShardIndex,
  estimateRuntimeFloor,
  cellsPerOwner,
} from "../scripts/lib/pgbench_shard.mjs";

describe("pgbench shard assignment", () => {
  it("assigns each PER_OWNER cell to exactly one owner-affinity shard", () => {
    const cells = enumerateExpectedPgbenchCells().filter(
      (c) => c.mode === "PER_OWNER_CEILING",
    );
    assert.equal(cells.length, 11 * cellsPerOwner());
    const counts = Object.fromEntries(OWNERS.map((o) => [o, 0]));
    for (const cell of cells) {
      const idx = ownerAffinityShardIndex(cell.owner);
      assert.ok(idx >= 0 && idx < 11);
      assert.equal(assignCellShard(cell, { mode: "OWNER_AFFINITY", shard_count: 11 }), idx);
      counts[cell.owner] += 1;
    }
    for (const o of OWNERS) {
      assert.equal(counts[o], cellsPerOwner(), o);
    }
  });

  it("filters shard to one owner without changing cell_id", () => {
    const all = enumerateExpectedPgbenchCells();
    const recordsIdx = ownerAffinityShardIndex("records");
    const filtered = filterCellsForShard(all, {
      mode: "OWNER_AFFINITY",
      shard_count: 11,
      shard_index: recordsIdx,
      phase: "PER_OWNER_CEILING",
    });
    assert.ok(filtered.every((c) => c.owner === "records"));
    assert.ok(filtered.every((c) => c.mode === "PER_OWNER_CEILING"));
    assert.equal(filtered.length, cellsPerOwner());
    assert.equal(filtered[0].cell_id.includes("records"), true);
  });

  it("hash-shards ALL_OWNERS deterministically across N full-stack shards", () => {
    const cells = enumerateExpectedPgbenchCells().filter(
      (c) => c.mode === "ALL_OWNERS_CONCURRENT",
    );
    const shard_count = 4;
    const seen = new Set();
    const counts = [0, 0, 0, 0];
    for (const cell of cells) {
      const s = assignCellShard(cell, { mode: "HASH", shard_count });
      assert.ok(s >= 0 && s < shard_count);
      counts[s] += 1;
      seen.add(`${cell.cell_id}:${s}`);
    }
    assert.equal(seen.size, cells.length);
    // roughly even
    for (const c of counts) {
      assert.ok(c > 200 && c < 400, `unexpected bucket size ${c}`);
    }
    // deterministic
    assert.equal(
      assignCellShard(cells[0], { mode: "HASH", shard_count }),
      assignCellShard(cells[0], { mode: "HASH", shard_count }),
    );
  });

  it("reports theoretical runtime floors", () => {
    const floor = estimateRuntimeFloor({
      owner_environments: 11,
      all_owner_environments: 1,
      cell_seconds: 150,
    });
    assert.equal(floor.total_cells, 14616);
    assert.equal(floor.per_owner_cells, 13398);
    assert.equal(floor.all_owners_cells, 1218);
    assert.ok(Math.abs(floor.sequential_days - 25.4) < 0.2);
    assert.ok(Math.abs(floor.owner_phase_hours_with_11 - 50.75) < 0.1);
    assert.ok(floor.note.includes("theoretical"));
    assert.deepEqual(PER_OWNER_OPERATIONAL_ORDER.length, 11);
  });
});
