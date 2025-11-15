/* cspell:ignore grpc */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { PrismaClient } from "../prisma/generated/client";
import { signJwt, verifyJwt } from "@common/utils/auth";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import * as fs from "fs";
import { resolveProtoPath } from "@common/utils/proto";

const prisma = new PrismaClient();

// Load proto file
const PROTO_PATH = resolveProtoPath("auth.proto");
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const authProto = grpc.loadPackageDefinition(packageDefinition) as any;

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

// Implement AuthService
const authService = {
  async Register(call: any, callback: any) {
    try {
      const { email, password } = call.request;
      if (!email || !password) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "email and password required",
        });
      }

      const existing = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM auth.users WHERE email = ${email}
      `.then((r) => r[0] || null);
      if (existing) {
        return callback({
          code: grpc.status.ALREADY_EXISTS,
          message: "email already exists",
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.$queryRaw<
        Array<{ id: string; email: string; createdAt: Date }>
      >`
        INSERT INTO auth.users (email, password_hash, created_at)
        VALUES (${email}, ${passwordHash}, NOW())
        RETURNING id, email, created_at as "createdAt"
      `.then((r) => r[0]);

      const jti = randomUUID();
      const token = signJwt({ sub: user.id, email: user.email, jti } as any);

      callback(null, {
        token,
        user: {
          id: user.id,
          email: user.email,
          created_at: user.createdAt.toISOString(),
        },
      });
    } catch (error: any) {
      console.error("[gRPC] Register error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async Authenticate(call: any, callback: any) {
    try {
      const { email, password } = call.request;
      if (!email || !password) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "email and password required",
        });
      }

      const user = await prisma.$queryRaw<Array<{ id: string; email: string; passwordHash: string; createdAt: Date }>>`
        SELECT id, email, password_hash as "passwordHash", created_at as "createdAt"
        FROM auth.users
        WHERE email = ${email}
      `.then((r) => r[0] || null);

      if (!user || !user.passwordHash) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "invalid credentials",
        });
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "invalid credentials",
        });
      }

      const jti = randomUUID();
      const token = signJwt({ sub: user.id, email: user.email, jti } as any);

      callback(null, {
        token,
        refresh_token: "",
        user: {
          id: user.id,
          email: user.email,
          created_at: user.createdAt.toISOString(),
        },
      });
    } catch (error: any) {
      console.error("[gRPC] Authenticate error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async ValidateToken(call: any, callback: any) {
    try {
      const { token } = call.request;
      if (!token) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "token required",
        });
      }

      const payload = verifyJwt(token);
      const user = await prisma.$queryRaw<Array<{ id: string; email: string; createdAt: Date }>>`
        SELECT id, email, created_at as "createdAt"
        FROM auth.users
        WHERE id = ${payload.sub}::uuid
      `.then((r) => r[0] || null);
      
      if (!user) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "invalid token",
        });
      }

      callback(null, {
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          created_at: user.createdAt.toISOString(),
        },
      });
    } catch (error: any) {
      console.error("[gRPC] ValidateToken error:", error);
      callback(null, { valid: false });
    }
  },

  async RefreshToken(call: any, callback: any) {
    callback({
      code: grpc.status.UNIMPLEMENTED,
      message: "refresh token not implemented",
    });
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
// @grpc/grpc-js uses HTTP/2 internally, we just need to configure it properly
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
  
  server.addService(authProto.auth.AuthService.service, {
    Register: withLogging(authService.Register, "Register"),
    Authenticate: withLogging(authService.Authenticate, "Authenticate"),
    ValidateToken: withLogging(authService.ValidateToken, "ValidateToken"),
    RefreshToken: withLogging(authService.RefreshToken, "RefreshToken"),
    HealthCheck: withLogging(authService.HealthCheck, "HealthCheck"),
  });

  // Try to load TLS certs (for production with ALPN = h2)
  let credentials: grpc.ServerCredentials;
  const keyPath = process.env.TLS_KEY_PATH || "/etc/certs/tls.key";
  const certPath = process.env.TLS_CERT_PATH || "/etc/certs/tls.crt";
  
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    // Create SSL credentials with ALPN = h2
    credentials = grpc.ServerCredentials.createSsl(
      null, // root certs (null = no client cert required)
      [{ private_key: key, cert_chain: cert }],
      false as any // check client cert (TypeScript type issue)
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
