/* cspell:ignore grpc */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type { PrismaClient } from "../generated/records-client";
import { PrismaClient as PrismaClientCtor, Prisma } from "../generated/records-client";
import path from "path";
import fs from "fs";

type LoadedRecord = Awaited<ReturnType<PrismaClient["record"]["findFirst"]>>;

const PROTO_PATH = path.join(__dirname, "../../proto/records.proto");
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const recordsProto = grpc.loadPackageDefinition(packageDefinition) as any;

function normalizeDecimal(value: any) {
  if (value == null) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object" && "toNumber" in value) {
    try {
      return (value as { toNumber: () => number }).toNumber();
    } catch {
      return Number(value as any);
    }
  }
  return Number(value);
}

function mapRecord(record?: LoadedRecord | null) {
  if (!record) return null;
  return {
    id: record.id,
    user_id: record.userId,
    artist: record.artist,
    name: record.name,
    format: record.format,
    catalog_number: record.catalogNumber ?? "",
    record_grade: record.recordGrade ?? "",
    sleeve_grade: record.sleeveGrade ?? "",
    has_insert: record.hasInsert ?? false,
    has_booklet: record.hasBooklet ?? false,
    has_obi_strip: record.hasObiStrip ?? false,
    has_factory_sleeve: record.hasFactorySleeve ?? false,
    is_promo: record.isPromo ?? false,
    notes: record.notes ?? "",
    purchased_at: record.purchasedAt ? new Date(record.purchasedAt).toISOString() : "",
    price_paid: normalizeDecimal(record.pricePaid) ?? 0,
    created_at: record.createdAt ? new Date(record.createdAt).toISOString() : "",
    updated_at: record.updatedAt ? new Date(record.updatedAt).toISOString() : "",
  };
}

function buildWhere(userId: string, query?: string | null) {
  if (!query) {
    return { userId };
  }
  const q = query.trim();
  if (!q) return { userId };
  const containsFilter = { contains: q, mode: Prisma.QueryMode.insensitive };
  return {
    userId,
    OR: [{ artist: containsFilter }, { name: containsFilter }, { catalogNumber: containsFilter }],
  };
}

function recordInputFromProto(proto: any, userId: string) {
  const data: any = {
    userId,
    artist: proto.artist ?? "",
    name: proto.name ?? "",
    format: proto.format ?? "LP",
    catalogNumber: proto.catalog_number ?? null,
    recordGrade: proto.record_grade ?? null,
    sleeveGrade: proto.sleeve_grade ?? null,
    hasInsert: proto.has_insert ?? false,
    hasBooklet: proto.has_booklet ?? false,
    hasObiStrip: proto.has_obi_strip ?? false,
    hasFactorySleeve: proto.has_factory_sleeve ?? false,
    isPromo: proto.is_promo ?? false,
    notes: proto.notes ?? null,
  };
  if (proto.purchased_at) data.purchasedAt = new Date(proto.purchased_at);
  if (proto.price_paid != null) data.pricePaid = String(proto.price_paid);
  return data;
}

export function startGrpcServer(port: number = 50051, prismaClient?: PrismaClient) {
  const prisma = prismaClient ?? new PrismaClientCtor();

  const server = new grpc.Server({
    "grpc.keepalive_time_ms": 30000,
    "grpc.keepalive_timeout_ms": 5000,
    "grpc.keepalive_permit_without_calls": 1,
    "grpc.http2.max_pings_without_data": 0,
    "grpc.http2.min_time_between_pings_ms": 10000,
    "grpc.http2.min_ping_interval_without_data_ms": 300000,
  });

  const service = recordsProto.records.RecordsService.service;

  const handlers = {
    async SearchRecords(call: any, callback: any) {
      try {
        const { user_id, query, limit, offset } = call.request;
        if (!user_id) {
          return callback({ code: grpc.status.INVALID_ARGUMENT, message: "user_id required" });
        }
        const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
        const skip = Math.max(Number(offset) || 0, 0);
        const records = await prisma.record.findMany({
          where: buildWhere(user_id, query),
          orderBy: { updatedAt: "desc" },
          take,
          skip,
        });
        callback(null, {
          records: records.map(mapRecord),
          total: records.length,
        });
      } catch (err: any) {
        console.error("[records grpc] SearchRecords error", err);
        callback({ code: grpc.status.INTERNAL, message: err?.message || "internal error" });
      }
    },

    async GetRecord(call: any, callback: any) {
      try {
        const { record_id, user_id } = call.request;
        if (!record_id || !user_id) {
          return callback({ code: grpc.status.INVALID_ARGUMENT, message: "record_id and user_id required" });
        }
        const record = await prisma.record.findFirst({ where: { id: record_id, userId: user_id } });
        if (!record) {
          return callback({ code: grpc.status.NOT_FOUND, message: "record not found" });
        }
        callback(null, { record: mapRecord(record) });
      } catch (err: any) {
        console.error("[records grpc] GetRecord error", err);
        callback({ code: grpc.status.INTERNAL, message: err?.message || "internal error" });
      }
    },

    async CreateRecord(call: any, callback: any) {
      try {
        const { user_id, record } = call.request;
        if (!user_id || !record) {
          return callback({ code: grpc.status.INVALID_ARGUMENT, message: "user_id and record required" });
        }
        const created = await prisma.record.create({
          data: recordInputFromProto(record, user_id),
        });
        callback(null, { record: mapRecord(created) });
      } catch (err: any) {
        console.error("[records grpc] CreateRecord error", err);
        callback({ code: grpc.status.INTERNAL, message: err?.message || "internal error" });
      }
    },

    async UpdateRecord(call: any, callback: any) {
      try {
        const { record_id, user_id, record } = call.request;
        if (!record_id || !user_id || !record) {
          return callback({ code: grpc.status.INVALID_ARGUMENT, message: "record_id, user_id and record required" });
        }
        const updated = await prisma.record.update({
          where: { id_userId: { id: record_id, userId: user_id } },
          data: recordInputFromProto(record, user_id),
        });
        callback(null, { record: mapRecord(updated) });
      } catch (err: any) {
        const code = err?.code === "P2025" ? grpc.status.NOT_FOUND : grpc.status.INTERNAL;
        console.error("[records grpc] UpdateRecord error", err);
        callback({ code, message: err?.message || "internal error" });
      }
    },

    async DeleteRecord(call: any, callback: any) {
      try {
        const { record_id, user_id } = call.request;
        if (!record_id || !user_id) {
          return callback({ code: grpc.status.INVALID_ARGUMENT, message: "record_id and user_id required" });
        }
        await prisma.record.delete({ where: { id_userId: { id: record_id, userId: user_id } } });
        callback(null, { success: true });
      } catch (err: any) {
        const code = err?.code === "P2025" ? grpc.status.NOT_FOUND : grpc.status.INTERNAL;
        console.error("[records grpc] DeleteRecord error", err);
        callback({ code, message: err?.message || "internal error" });
      }
    },

    async HealthCheck(_call: any, callback: any) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        callback(null, { healthy: true, version: process.env.SERVICE_VERSION || "1.0.0" });
      } catch (err: any) {
        console.error("[records grpc] HealthCheck error", err);
        callback(null, { healthy: false, version: process.env.SERVICE_VERSION || "1.0.0" });
      }
    },
  };

  server.addService(service, handlers);

  let credentials: grpc.ServerCredentials;
  const keyPath = process.env.TLS_KEY_PATH || "/etc/certs/tls.key";
  const certPath = process.env.TLS_CERT_PATH || "/etc/certs/tls.crt";

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    credentials = grpc.ServerCredentials.createSsl(null, [{ private_key: key, cert_chain: cert }], false as any);
    console.log("[records gRPC] Starting secure server with ALPN h2");
  } else {
    credentials = grpc.ServerCredentials.createInsecure();
    console.warn("[records gRPC] TLS certs missing – starting insecure (dev)");
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (error) => {
    if (error) {
      console.error("[records gRPC] bind error", error);
      return;
    }
    server.start();
    console.log(`[records gRPC] server listening on ${port}`);
  });

  return server;
}

