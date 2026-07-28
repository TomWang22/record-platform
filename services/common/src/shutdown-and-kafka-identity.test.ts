import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveKafkaClientId } from "./kafka.js";
import {
  beginDrain,
  getShutdownPhase,
  isDraining,
  registerHttpServerForShutdown,
  registerShutdownResource,
  runShutdown,
} from "./shutdown-coordinator.js";

describe("resolveKafkaClientId", () => {
  const prev: Record<string, string | undefined> = {};
  const keys = [
    "KAFKA_CLIENT_ID",
    "OTEL_SERVICE_NAME",
    "SERVICE_NAME",
    "POD_UID",
    "POD_NAME",
    "HOSTNAME",
  ];

  beforeEach(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("requires role suffix", () => {
    process.env.OTEL_SERVICE_NAME = "media-service";
    process.env.POD_UID = "60ee5388-aaaa-bbbb-cccc-dddddddddddd";
    const id = resolveKafkaClientId("consumer");
    expect(id).toBe("record-platform.media-service.60ee5388.consumer");
  });

  it("appends role when override lacks it", () => {
    process.env.KAFKA_CLIENT_ID = "record-platform.media-service.deadbeef";
    const id = resolveKafkaClientId("producer");
    expect(id).toBe("record-platform.media-service.deadbeef.producer");
  });
});

describe("shutdown coordinator", () => {
  it("drains and closes registered resources once", async () => {
    if (getShutdownPhase() !== "RUNNING") {
      // Singleton already advanced in this process; skip rather than flake.
      return;
    }
    const closed: string[] = [];
    registerShutdownResource({
      name: "test-res",
      order: 1,
      close: () => {
        closed.push("test-res");
      },
    });
    let httpClosed = false;
    registerHttpServerForShutdown(
      {
        close: (cb?: (err?: Error) => void) => {
          httpClosed = true;
          cb?.();
        },
      },
      { name: "http-test", order: 2 },
    );
    beginDrain("unit");
    expect(isDraining()).toBe(true);
    expect(getShutdownPhase()).toBe("DRAINING");
    await runShutdown("unit");
    expect(getShutdownPhase()).toBe("TERMINATED");
    expect(closed).toEqual(["test-res"]);
    expect(httpClosed).toBe(true);
  });
});
