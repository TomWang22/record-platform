import * as grpc from "@grpc/grpc-js";
import type { Response } from "express";
import type { ServerResponse as NodeServerResponse } from "http";
import type { Socket } from "net";

export const grpcStatusToHttp: Record<number, number> = {
  [grpc.status.INVALID_ARGUMENT ?? 3]: 400,
  [grpc.status.UNAUTHENTICATED ?? 16]: 401,
  [grpc.status.PERMISSION_DENIED ?? 7]: 403,
  [grpc.status.NOT_FOUND ?? 5]: 404,
  [grpc.status.ALREADY_EXISTS ?? 6]: 409,
  [grpc.status.UNAVAILABLE ?? 14]: 503,
};

export function sendJson502(res: NodeServerResponse | Socket, msg: string) {
  if ("setHeader" in res) {
    const sr = res as NodeServerResponse;
    if (!sr.headersSent) {
      sr.statusCode = 502;
      sr.setHeader("Content-Type", "application/json");
      sr.end(JSON.stringify({ error: msg }));
      return;
    }
  }
  try {
    (res as Socket).destroy();
  } catch {
    /* ignore */
  }
}

export function handleGrpcError(res: Response, err: { code?: number; details?: string; message?: string }) {
  const code = err?.code ?? -1;
  const status = grpcStatusToHttp[code] ?? 500;
  const message = err?.details || err?.message || "grpc error";
  console.error("[gw] gRPC error → HTTP", status, {
    grpcCode: code,
    grpcMessage: err?.message,
    details: err?.details,
    route: (res as Response & { req?: { path?: string } }).req?.path,
    hint:
      code === 2
        ? "auth-service returned INTERNAL (check auth pod logs, DB/Redis)"
        : code === 14
          ? "UNAVAILABLE (connection/TLS? verify cert chain)"
          : undefined,
  });
  res.status(status).json({ error: message });
}
