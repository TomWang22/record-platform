import * as grpc from "@grpc/grpc-js";
import { createGrpcServerTracingInterceptor } from "./otel/grpc-server-interceptor.js";

/**
 * Construct a gRPC server with the platform tracing interceptor always registered.
 * Merges any caller ChannelOptions / ServerOptions.
 */
export function createRpGrpcServer(
  options: grpc.ServerOptions = {},
): grpc.Server {
  const existing = options.interceptors || [];
  return new grpc.Server({
    ...options,
    interceptors: [createGrpcServerTracingInterceptor(), ...existing],
  });
}
