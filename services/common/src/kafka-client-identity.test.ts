import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveKafkaClientId } from "./kafka.js";

describe("resolveKafkaClientId", () => {
  const prev: Record<string, string | undefined> = {};
  const keys = [
    "KAFKA_CLIENT_ID",
    "OTEL_SERVICE_NAME",
    "SERVICE_NAME",
    "RP_SERVICE_NAME",
    "POD_UID",
    "RP_POD_UID",
    "POD_NAME",
    "HOSTNAME",
    "RP_KAFKA_CLIENT_ID_STRICT",
    "RP_ACCEPTANCE_MODE",
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

  it("requires role suffix and prefers RP_POD_UID", () => {
    process.env.RP_SERVICE_NAME = "media-service";
    process.env.RP_POD_UID = "60ee5388-aaaa-bbbb-cccc-dddddddddddd";
    const id = resolveKafkaClientId("lifecycle-consumer");
    expect(id).toBe("record-platform.media-service.60ee5388.lifecycle-consumer");
  });

  it("produces distinct IDs for two roles in one pod", () => {
    process.env.RP_SERVICE_NAME = "notification-service";
    process.env.RP_POD_UID = "797dfc25-6856-4f10-af96-063db70cd540";
    const a = resolveKafkaClientId("notification-consumer");
    const b = resolveKafkaClientId("lifecycle-consumer");
    expect(a).not.toBe(b);
    expect(a.endsWith(".notification-consumer")).toBe(true);
    expect(b.endsWith(".lifecycle-consumer")).toBe(true);
  });

  it("produces distinct IDs for two pods same role", () => {
    process.env.RP_SERVICE_NAME = "ollama-worker";
    process.env.RP_POD_UID = "aaaaaaaa-1111-1111-1111-111111111111";
    const a = resolveKafkaClientId("inference-consumer");
    process.env.RP_POD_UID = "bbbbbbbb-2222-2222-2222-222222222222";
    const b = resolveKafkaClientId("inference-consumer");
    expect(a).not.toBe(b);
  });

  it("appends role when override lacks it", () => {
    process.env.KAFKA_CLIENT_ID = "record-platform.media-service.deadbeef";
    const id = resolveKafkaClientId("producer");
    expect(id).toBe("record-platform.media-service.deadbeef.producer");
  });

  it("fails closed in acceptance mode without pod UID", () => {
    process.env.RP_KAFKA_CLIENT_ID_STRICT = "1";
    process.env.RP_SERVICE_NAME = "python-ai-service";
    expect(() => resolveKafkaClientId("producer")).toThrow(/RP_POD_UID/);
  });

  it("fails closed in acceptance mode without service name", () => {
    process.env.RP_ACCEPTANCE_MODE = "1";
    process.env.RP_POD_UID = "60ee5388-aaaa-bbbb-cccc-dddddddddddd";
    expect(() => resolveKafkaClientId("producer")).toThrow(/SERVICE_NAME/);
  });

  it("rejects unknown roles", () => {
    process.env.RP_SERVICE_NAME = "x";
    process.env.RP_POD_UID = "60ee5388-aaaa-bbbb-cccc-dddddddddddd";
    expect(() => resolveKafkaClientId("not-a-role" as never)).toThrow(/invalid client role/);
  });
});
