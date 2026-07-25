import * as grpc from "@grpc/grpc-js";
import { createGrpcServerTracingInterceptor } from "./otel/grpc-server-interceptor.js";
import { createRpGrpcPeerAuthInterceptor } from "./grpc-peer-auth.js";

export type CreateRpGrpcServerOptions = grpc.ServerOptions & {
  /** When set, enforces SAN/SPIFFE service-call graph (CA trust alone is insufficient). */
  peerAuthServiceName?: string;
};

/**
 * Construct a gRPC server with the platform tracing interceptor always registered.
 * Optionally registers peer-identity authorization when peerAuthServiceName is set.
 */
export function createRpGrpcServer(
  options: CreateRpGrpcServerOptions = {},
): grpc.Server {
  const { peerAuthServiceName, ...serverOptions } = options;
  const existing = serverOptions.interceptors || [];
  const interceptors: grpc.ServerInterceptor[] = [
    createGrpcServerTracingInterceptor(),
  ];
  if (peerAuthServiceName) {
    interceptors.push(createRpGrpcPeerAuthInterceptor(peerAuthServiceName));
  } else if (process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME) {
    const name = (process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME || "").trim();
    if (name && process.env.RP_MTLS_PEER_AUTH_DISABLE !== "1") {
      interceptors.push(createRpGrpcPeerAuthInterceptor(name));
    }
  }
  interceptors.push(...existing);
  return new grpc.Server({
    ...serverOptions,
    interceptors,
  });
}
