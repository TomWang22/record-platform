/* cspell:ignore grpc */
export function startGrpcServer(port: number) {
  console.warn(
    `[records] gRPC server placeholder started on port ${port} (no-op until fully implemented)`
  );
  return {
    tryShutdown(cb?: () => void) {
      if (cb) cb();
    },
  };
}

