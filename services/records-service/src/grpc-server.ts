/* cspell:ignore grpc */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { PrismaClient, Prisma } from "../generated/records-client";
import * as path from "path";
import * as fs from "fs";

const prisma = new PrismaClient();

// Load proto file
const PROTO_PATH = path.join(__dirname, "../../proto/records.proto");
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const recordsProto = grpc.loadPackageDefinition(packageDefinition) as any;

const hasOwn = (obj: any, key: string) =>
  obj != null && Object.prototype.hasOwnProperty.call(obj, key);

function readField(input: any, ...keys: string[]) {
  for (const key of keys) {
    if (hasOwn(input, key)) {
      return { present: true, value: input[key] };
    }
  }
  return { present: false, value: undefined };
}

function toStringValue(value: any): string {
  return String(value ?? "").trim();
}

function toNullableString(value: any): string | null {
  if (value === undefined || value === null) return null;
  return String(value);
}

function toBoolValue(value: any, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return fallback;
}

function toNullableDate(value: any): Date | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildRecordCreateData(
  userId: string,
  record: any
): Prisma.RecordUncheckedCreateInput {
  const catalogNumber = readField(record, "catalog_number", "catalogNumber");
  const notes = readField(record, "notes");
  const recordGrade = readField(record, "record_grade", "recordGrade");
  const sleeveGrade = readField(record, "sleeve_grade", "sleeveGrade");
  const insertGrade = readField(record, "insert_grade", "insertGrade");
  const bookletGrade = readField(record, "booklet_grade", "bookletGrade");
  const obiStripGrade = readField(record, "obi_strip_grade", "obiStripGrade");
  const factorySleeveGrade = readField(
    record,
    "factory_sleeve_grade",
    "factorySleeveGrade"
  );
  const purchasedAt = readField(record, "purchased_at", "purchasedAt");
  const pricePaid = readField(record, "price_paid", "pricePaid");

  const data: Prisma.RecordUncheckedCreateInput = {
    userId,
    artist: toStringValue(record?.artist),
    name: toStringValue(record?.name),
    format: toStringValue(record?.format),
    hasInsert: toBoolValue(readField(record, "has_insert", "hasInsert").value, false),
    hasBooklet: toBoolValue(
      readField(record, "has_booklet", "hasBooklet").value,
      false
    ),
    hasObiStrip: toBoolValue(
      readField(record, "has_obi_strip", "hasObiStrip").value,
      false
    ),
    hasFactorySleeve: toBoolValue(
      readField(record, "has_factory_sleeve", "hasFactorySleeve").value,
      false
    ),
    isPromo: toBoolValue(readField(record, "is_promo", "isPromo").value, false),
  };

  if (catalogNumber.present)
    data.catalogNumber = toNullableString(catalogNumber.value);
  if (notes.present) data.notes = toNullableString(notes.value);
  if (recordGrade.present)
    data.recordGrade = toNullableString(recordGrade.value);
  if (sleeveGrade.present)
    data.sleeveGrade = toNullableString(sleeveGrade.value);
  if (insertGrade.present)
    data.insertGrade = toNullableString(insertGrade.value);
  if (bookletGrade.present)
    data.bookletGrade = toNullableString(bookletGrade.value);
  if (obiStripGrade.present)
    data.obiStripGrade = toNullableString(obiStripGrade.value);
  if (factorySleeveGrade.present)
    data.factorySleeveGrade = toNullableString(factorySleeveGrade.value);
  if (purchasedAt.present) {
    const date = toNullableDate(purchasedAt.value);
    if (date) data.purchasedAt = date;
  }
  if (pricePaid.present) {
    data.pricePaid =
      pricePaid.value === null || pricePaid.value === undefined
        ? null
        : String(pricePaid.value);
  }

  return data;
}

function buildRecordUpdateData(
  record: any
): Prisma.RecordUncheckedUpdateInput {
  const data: Prisma.RecordUncheckedUpdateInput = {};
  if (!record) return data;

  const artist = readField(record, "artist");
  if (artist.present) data.artist = toStringValue(artist.value);

  const name = readField(record, "name");
  if (name.present) data.name = toStringValue(name.value);

  const format = readField(record, "format");
  if (format.present) data.format = toStringValue(format.value);

  const catalogNumber = readField(record, "catalog_number", "catalogNumber");
  if (catalogNumber.present)
    data.catalogNumber = toNullableString(catalogNumber.value);

  const notes = readField(record, "notes");
  if (notes.present) data.notes = toNullableString(notes.value);

  const recordGrade = readField(record, "record_grade", "recordGrade");
  if (recordGrade.present)
    data.recordGrade = toNullableString(recordGrade.value);

  const sleeveGrade = readField(record, "sleeve_grade", "sleeveGrade");
  if (sleeveGrade.present)
    data.sleeveGrade = toNullableString(sleeveGrade.value);

  const insertGrade = readField(record, "insert_grade", "insertGrade");
  if (insertGrade.present)
    data.insertGrade = toNullableString(insertGrade.value);

  const bookletGrade = readField(record, "booklet_grade", "bookletGrade");
  if (bookletGrade.present)
    data.bookletGrade = toNullableString(bookletGrade.value);

  const obiStripGrade = readField(record, "obi_strip_grade", "obiStripGrade");
  if (obiStripGrade.present)
    data.obiStripGrade = toNullableString(obiStripGrade.value);

  const factorySleeveGrade = readField(
    record,
    "factory_sleeve_grade",
    "factorySleeveGrade"
  );
  if (factorySleeveGrade.present)
    data.factorySleeveGrade = toNullableString(factorySleeveGrade.value);

  const hasInsert = readField(record, "has_insert", "hasInsert");
  if (hasInsert.present)
    data.hasInsert = toBoolValue(hasInsert.value, false);

  const hasBooklet = readField(record, "has_booklet", "hasBooklet");
  if (hasBooklet.present)
    data.hasBooklet = toBoolValue(hasBooklet.value, false);

  const hasObiStrip = readField(record, "has_obi_strip", "hasObiStrip");
  if (hasObiStrip.present)
    data.hasObiStrip = toBoolValue(hasObiStrip.value, false);

  const hasFactorySleeve = readField(
    record,
    "has_factory_sleeve",
    "hasFactorySleeve"
  );
  if (hasFactorySleeve.present)
    data.hasFactorySleeve = toBoolValue(hasFactorySleeve.value, false);

  const isPromo = readField(record, "is_promo", "isPromo");
  if (isPromo.present) data.isPromo = toBoolValue(isPromo.value, false);

  const purchasedAt = readField(record, "purchased_at", "purchasedAt");
  if (purchasedAt.present) {
    const date = toNullableDate(purchasedAt.value);
    data.purchasedAt = date ?? null;
  }

  const pricePaid = readField(record, "price_paid", "pricePaid");
  if (pricePaid.present) {
    data.pricePaid =
      pricePaid.value === null || pricePaid.value === undefined
        ? null
        : String(pricePaid.value);
  }

  return data;
}

function toGrpcRecord(record: any) {
  if (!record) return null;
  const toIso = (value: any) => (value ? new Date(value).toISOString() : "");
  const toNum = (value: any) => {
    if (value == null) return 0;
    if (typeof value === "number") return value;
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "string") return Number(value);
    if (typeof value?.toNumber === "function") return value.toNumber();
    return Number(value) || 0;
  };

  return {
    id: record.id,
    user_id: record.userId,
    artist: record.artist || "",
    name: record.name || "",
    format: record.format || "",
    catalog_number: record.catalogNumber || "",
    record_grade: record.recordGrade || "",
    sleeve_grade: record.sleeveGrade || "",
    has_insert: record.hasInsert || false,
    has_booklet: record.hasBooklet || false,
    has_obi_strip: record.hasObiStrip || false,
    has_factory_sleeve: record.hasFactorySleeve || false,
    is_promo: record.isPromo || false,
    notes: record.notes || "",
    purchased_at: toIso(record.purchasedAt),
    price_paid: toNum(record.pricePaid),
    created_at: toIso(record.createdAt),
    updated_at: toIso(record.updatedAt),
  };
}

// gRPC logging middleware
function withLogging(handler: any, methodName: string) {
  return async (call: any, callback: any) => {
    const start = Date.now();
    console.log(`[gRPC] ${methodName} called`);
    try {
      await handler(call, callback);
      const duration = Date.now() - start;
      console.log(`[gRPC] ${methodName} completed in ${duration}ms`);
    } catch (err: any) {
      const duration = Date.now() - start;
      console.error(`[gRPC] ${methodName} failed after ${duration}ms:`, err);
      callback({
        code: grpc.status.INTERNAL,
        message: err.message || "internal error",
      });
    }
  };
}

// Implement RecordsService
const recordsService = {
  async SearchRecords(call: any, callback: any) {
    try {
      const { user_id, query, limit = 50, offset = 0 } = call.request;
      if (!user_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "user_id required",
        });
      }

      const where: any = { userId: user_id };
      if (query) {
        where.OR = [
          { artist: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
          { catalogNumber: { contains: query, mode: "insensitive" } },
        ];
      }

      const records = await prisma.record.findMany({
        where,
        take: Math.min(200, Math.max(1, limit)),
        skip: Math.max(0, offset),
        orderBy: { updatedAt: "desc" },
      });

      callback(null, {
        records: records.map(toGrpcRecord).filter(Boolean),
        total: records.length,
      });
    } catch (error: any) {
      console.error("[gRPC] SearchRecords error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async GetRecord(call: any, callback: any) {
    try {
      const { record_id, user_id } = call.request;
      if (!record_id || !user_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "record_id and user_id required",
        });
      }

      const record = await prisma.record.findUnique({
        where: { id_userId: { id: record_id, userId: user_id } },
      });

      if (!record) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "record not found",
        });
      }

      callback(null, {
        record: toGrpcRecord(record),
      });
    } catch (error: any) {
      console.error("[gRPC] GetRecord error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async CreateRecord(call: any, callback: any) {
    try {
      const { user_id, record } = call.request;
      if (!user_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "user_id required",
        });
      }
      if (!record?.artist || !record?.name || !record?.format) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "artist, name, and format required",
        });
      }

      const data = buildRecordCreateData(user_id, record);

      const created = await prisma.record.create({ data });

      callback(null, { record: toGrpcRecord(created) });
    } catch (error: any) {
      console.error("[gRPC] CreateRecord error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async UpdateRecord(call: any, callback: any) {
    try {
      const { record_id, user_id, record } = call.request;
      if (!record_id || !user_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "record_id and user_id required",
        });
      }
      const recordKey = { id_userId: { id: record_id, userId: user_id } };
      const existing = await prisma.record.findUnique({
        where: recordKey,
      });
      if (!existing) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "record not found",
        });
      }

      const data = buildRecordUpdateData(record);
      const updated = await prisma.record.update({
        where: recordKey,
        data,
      });

      callback(null, { record: toGrpcRecord(updated) });
    } catch (error: any) {
      console.error("[gRPC] UpdateRecord error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async DeleteRecord(call: any, callback: any) {
    try {
      const { record_id, user_id } = call.request;
      if (!record_id || !user_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "record_id and user_id required",
        });
      }

      const recordKey = { id_userId: { id: record_id, userId: user_id } };
      const existing = await prisma.record.findUnique({
        where: recordKey,
      });
      if (!existing) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "record not found",
        });
      }

      await prisma.record.delete({ where: recordKey });
      callback(null, { success: true });
    } catch (error: any) {
      console.error("[gRPC] DeleteRecord error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async HealthCheck(call: any, callback: any) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      callback(null, {
        healthy: true,
        version: process.env.SERVICE_VERSION || "1.0.0",
      });
    } catch (error: any) {
      console.error("[gRPC] HealthCheck error:", error);
      callback(null, {
        healthy: false,
        version: process.env.SERVICE_VERSION || "1.0.0",
      });
    }
  },
};

// Create and start gRPC server with HTTP/2 only
export function startGrpcServer(port: number = 50051) {
  const server = new grpc.Server({
    // Force HTTP/2 only - no HTTP/1.1 fallback
    'grpc.keepalive_time_ms': 30000,
    'grpc.keepalive_timeout_ms': 5000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.max_pings_without_data': 0,
    'grpc.http2.min_time_between_pings_ms': 10000,
    'grpc.http2.min_ping_interval_without_data_ms': 300000,
  });
  
  server.addService(recordsProto.records.RecordsService.service, {
    SearchRecords: withLogging(recordsService.SearchRecords, "SearchRecords"),
    GetRecord: withLogging(recordsService.GetRecord, "GetRecord"),
    CreateRecord: withLogging(recordsService.CreateRecord, "CreateRecord"),
    UpdateRecord: withLogging(recordsService.UpdateRecord, "UpdateRecord"),
    DeleteRecord: withLogging(recordsService.DeleteRecord, "DeleteRecord"),
    HealthCheck: withLogging(recordsService.HealthCheck, "HealthCheck"),
  });

  // Try to load TLS certs (for production with ALPN = h2)
  let credentials: grpc.ServerCredentials;
  const keyPath = process.env.TLS_KEY_PATH || "/etc/certs/tls.key";
  const certPath = process.env.TLS_CERT_PATH || "/etc/certs/tls.crt";
  
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    credentials = grpc.ServerCredentials.createSsl(
      null,
      [{ private_key: key, cert_chain: cert }],
      false as any // TypeScript type issue
    );
    console.log("[gRPC] Starting secure HTTP/2-only server with ALPN = h2");
  } else {
    console.warn("[gRPC] TLS certs not found, starting insecure server (dev only)");
    credentials = grpc.ServerCredentials.createInsecure();
  }

  server.bindAsync(
    `0.0.0.0:${port}`,
    credentials,
    (error, actualPort) => {
      if (error) {
        console.error("[gRPC] Server bind error:", error);
        return;
      }
      server.start();
      console.log(`[gRPC] Server started on port ${actualPort} (HTTP/2 only, no HTTP/1.1 fallback)`);
    }
  );

  return server;
}