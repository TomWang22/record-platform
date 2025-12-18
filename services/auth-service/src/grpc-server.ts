/* cspell:ignore grpc */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { signJwt, verifyJwt } from "@common/utils/auth";
import { hashPassword, comparePassword, getQueueStatus } from "./lib/bcrypt-queue.js";
import { getUserFromCache, cacheUser, invalidateUserCache, checkEmailExistsInCache } from "./lib/redis-cache.js"; // Redis caching with Lua scripts
import { randomUUID } from "node:crypto";
import * as fs from "fs";
import { resolveProtoPath } from "@common/utils/proto";
import { verifyMFA } from "./lib/mfa.js";
import { prisma } from "./lib/prisma.js"; // Use shared PrismaClient instance
import { registerHealthService } from "@common/utils"; // Standard gRPC health service

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

// Health check service implementation
const healthService = {
  async Check(call: any, callback: any) {
    try {
      let dbOk = false;
      let redisOk = false;
      let cacheStats = { connected: false, userCacheKeys: 0 };
      let queueStatus: { activeOperations: number; queueLength: number; maxConcurrent: number; rounds: number } = { activeOperations: 0, queueLength: 0, maxConcurrent: 4, rounds: 8 };

      // Check database
      try {
        const dbCheck = prisma.$queryRaw`SELECT 1`;
        const timeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("DB check timeout")), 500)
        );
        await Promise.race([dbCheck, timeout]);
        dbOk = true;
      } catch (e: any) {
        // DB check failed
      }

      // Check Redis
      try {
        const { getRedisClient, getCacheStats } = await import("./lib/redis-cache.js");
        const client = getRedisClient();
        if (client && client.isOpen) {
          await client.ping();
          redisOk = true;
          cacheStats = await getCacheStats();
        }
      } catch (e: any) {
        // Redis check failed
      }

      // Get queue status - TypeScript type inference issue workaround
      const queueStatusData: any = getQueueStatus();
      queueStatus.activeOperations = queueStatusData.activeOperations;
      queueStatus.queueLength = queueStatusData.queueLength;
      queueStatus.maxConcurrent = queueStatusData.maxConcurrent;
      queueStatus.rounds = queueStatusData.rounds;

      // Determine overall status - use registerHealthService's ServingStatus enum
      const ServingStatus = {
        UNKNOWN: 0,
        SERVING: 1,
        NOT_SERVING: 2,
        SERVICE_UNKNOWN: 3,
      };
      const healthStatusValue = dbOk ? ServingStatus.SERVING : ServingStatus.NOT_SERVING;

      callback(null, {
        status: healthStatusValue,
        message: dbOk ? "Service is healthy" : "Database connection failed",
        details: {
          db: dbOk ? "connected" : "disconnected",
          redis: redisOk ? "connected" : "disconnected",
          cache_keys: cacheStats.userCacheKeys.toString(),
          bcrypt_queue: queueStatus.queueLength.toString(),
          bcrypt_active: queueStatus.activeOperations.toString(),
        },
      });
    } catch (error: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "health check failed",
      });
    }
  },

  Watch(call: any) {
    // Simple implementation - send periodic health checks
    const interval = setInterval(async () => {
      try {
        let dbOk = false;
        try {
          const dbCheck = prisma.$queryRaw`SELECT 1`;
          const timeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("DB check timeout")), 500)
          );
          await Promise.race([dbCheck, timeout]);
          dbOk = true;
        } catch (e: any) {
          // DB check failed
        }

        const ServingStatus = {
          UNKNOWN: 0,
          SERVING: 1,
          NOT_SERVING: 2,
          SERVICE_UNKNOWN: 3,
        };
        const healthStatusValue = dbOk ? ServingStatus.SERVING : ServingStatus.NOT_SERVING;
        call.write({
          status: healthStatusValue,
          message: dbOk ? "Service is healthy" : "Database connection failed",
        });
      } catch (error: any) {
        call.end();
      }
    }, 5000); // Send health check every 5 seconds

    call.on("end", () => {
      clearInterval(interval);
      call.end();
    });
  },
};

// Implement AuthService
const authService = {
  async Register(call: any, callback: any) {
    const startTime = Date.now();
    try {
      const { email, password } = call.request;
      if (!email || !password) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "email and password required",
        });
      }

      const checkStart = Date.now();
      
      // Check cache first for email existence (fast path)
      const emailExists = await checkEmailExistsInCache(email);
      if (emailExists) {
        const checkDuration = Date.now() - checkStart;
        console.log(`[gRPC] Register: Email exists (cache hit) took ${checkDuration}ms`);
        return callback({
          code: grpc.status.ALREADY_EXISTS,
          message: "email already exists",
        });
      }
      
      // Cache miss - check database
      const existing = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM auth.users WHERE email = ${email}
      `.then((r: Array<any>) => r[0] || null);
      const checkDuration = Date.now() - checkStart;
      console.log(`[gRPC] Register: SELECT existing user took ${checkDuration}ms (cache miss)`);
      
      if (existing) {
        // Cache the existing user for future lookups
        await cacheUser({
          id: existing.id,
          email: email,
          passwordHash: '', // Don't cache password hash for existing check
          mfaEnabled: false,
          emailVerified: false,
          phoneVerified: false,
          createdAt: new Date(),
        });
        return callback({
          code: grpc.status.ALREADY_EXISTS,
          message: "email already exists",
        });
      }

      const hashStart = Date.now();
      // Use queued bcrypt to prevent CPU contention
      const passwordHash = await hashPassword(password);
      const hashDuration = Date.now() - hashStart;
      console.log(`[gRPC] Register: bcrypt.hash took ${hashDuration}ms (queued)`);
      if (hashDuration > 5000) {
        console.warn(`[gRPC] Register: Slow bcrypt.hash: ${hashDuration}ms (queue may be backed up)`);
      }
      
      const insertStart = Date.now();
      const user = await prisma.$queryRaw<
        Array<{ id: string; email: string; createdAt: Date }>
      >`
        INSERT INTO auth.users (email, password_hash, created_at)
        VALUES (${email}, ${passwordHash}, NOW())
        RETURNING id, email, created_at as "createdAt"
      `.then((r: Array<{ id: string; email: string; createdAt: Date }>) => r[0]);
      const insertDuration = Date.now() - insertStart;
      console.log(`[gRPC] Register: INSERT user took ${insertDuration}ms`);

      // Cache the newly created user
      await cacheUser({
        id: user.id,
        email: user.email,
        passwordHash: passwordHash,
        mfaEnabled: false,
        emailVerified: false,
        phoneVerified: false,
        createdAt: user.createdAt,
      });

      const tokenStart = Date.now();
      const jti = randomUUID();
      const token = signJwt({ sub: user.id, email: user.email, jti } as any);
      const tokenDuration = Date.now() - tokenStart;
      console.log(`[gRPC] Register: signJwt took ${tokenDuration}ms`);

      const totalDuration = Date.now() - startTime;
      console.log(`[gRPC] Register: Total duration ${totalDuration}ms (check: ${checkDuration}ms, hash: ${hashDuration}ms, insert: ${insertDuration}ms, token: ${tokenDuration}ms)`);

      callback(null, {
        token,
        user: {
          id: user.id,
          email: user.email,
          created_at: user.createdAt.toISOString(),
        },
      });
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      console.error(`[gRPC] Register error after ${totalDuration}ms:`, error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async Authenticate(call: any, callback: any) {
    try {
      const { email, password, mfa_code, mfaCode } = call.request; // Support both mfa_code (proto) and mfaCode (legacy)
      const mfaCodeValue = mfa_code || mfaCode; // Use proto field first, fallback to legacy
      if (!email || !password) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "email and password required",
        });
      }

      console.log(`[gRPC] Authenticate attempt for email: ${email}, hasMfaCode: ${!!mfaCodeValue}`);

      // Try cache first (fast path)
      const cacheStart = Date.now();
      let user = await getUserFromCache(email);
      const cacheDuration = Date.now() - cacheStart;
      
      if (user) {
        console.log(`[gRPC] Authenticate: User found in cache (hit) took ${cacheDuration}ms`);
      } else {
        console.log(`[gRPC] Authenticate: Cache miss, fetching from database (took ${cacheDuration}ms)`);
        // Cache miss - fetch from database
        const dbUser = await prisma.$queryRaw<Array<{ 
          id: string; 
          email: string; 
          passwordHash: string; 
          mfaEnabled: boolean;
          emailVerified: boolean;
          phoneVerified: boolean;
          createdAt: Date 
        }>>`
          SELECT id, email, password_hash as "passwordHash", mfa_enabled as "mfaEnabled",
                 email_verified as "emailVerified", phone_verified as "phoneVerified", created_at as "createdAt"
          FROM auth.users
          WHERE email = ${email}
        `.then((r: Array<any>) => r[0] || null);
        
        if (dbUser) {
          // Cache the user for future lookups
          await cacheUser({
            id: dbUser.id,
            email: dbUser.email,
            passwordHash: dbUser.passwordHash,
            mfaEnabled: dbUser.mfaEnabled,
            emailVerified: dbUser.emailVerified,
            phoneVerified: dbUser.phoneVerified,
            createdAt: dbUser.createdAt,
          });
          user = dbUser;
        }
      }

      if (!user || !user.passwordHash) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "invalid credentials",
        });
      }

      console.log(`[gRPC] User ${user.email} (${user.id}) - mfaEnabled: ${user.mfaEnabled} (type: ${typeof user.mfaEnabled})`);

      // Use queued bcrypt compare (faster than hash, but still use the optimized function)
      const ok = await comparePassword(password, user.passwordHash);
      if (!ok) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "invalid credentials",
        });
      }

      // Check if MFA is enabled - use explicit boolean check
      console.log(`[gRPC] Checking MFA - user.mfaEnabled=${user.mfaEnabled}, typeof=${typeof user.mfaEnabled}, truthy=${!!user.mfaEnabled}`);
      if (user.mfaEnabled === true) {
        console.log(`[gRPC] MFA is enabled, checking for mfaCode...`);
        if (!mfaCodeValue) {
          console.log(`[gRPC] MFA required but no code provided - returning requiresMFA response`);
          // Return success response with requiresMFA flag (gateway will convert to HTTP 200)
          // Use a special token field to indicate MFA required
          callback(null, {
            token: "", // Empty token indicates MFA required
            refresh_token: "",
            requires_mfa: true, // Use proto field name (snake_case)
            user_id: user.id, // Use proto field name (snake_case)
            message: "MFA code required",
            user: {
              id: user.id,
              email: user.email,
              created_at: user.createdAt.toISOString(),
            },
          });
          return;
        }

        // Verify MFA code
        console.log(`[gRPC] Verifying MFA code for user ${user.id}, code: ${mfaCodeValue}`);
        const mfaValid = await verifyMFA(prisma, user.id, mfaCodeValue);
        if (!mfaValid) {
          console.log(`[gRPC] MFA code verification failed for user ${user.id}`);
          return callback({
            code: grpc.status.UNAUTHENTICATED,
            message: "invalid MFA code",
          });
        }
        console.log(`[gRPC] ✅ MFA code verified successfully for user ${user.id}, proceeding to generate token`);
      } else {
        console.log(`[gRPC] MFA not enabled, proceeding with login`);
      }

      const jti = randomUUID();
      const token = signJwt({ sub: user.id, email: user.email, jti } as any);
      
      console.log(`[gRPC] Token generated for user ${user.id}, token length: ${token.length}`);

      // Return success response with token - explicitly set requiresMFA to false
      const response = {
        token,
        refresh_token: "",
        requires_mfa: false, // Use proto field name (snake_case)
        user: {
          id: user.id,
          email: user.email,
          created_at: user.createdAt.toISOString(),
        },
      };
      
      console.log(`[gRPC] Returning response with token (length: ${response.token.length}), requires_mfa: ${response.requires_mfa}`);
      callback(null, response);
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
      `.then((r: Array<{ id: string; email: string; createdAt: Date }>) => r[0] || null);
      
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

  // Register standard gRPC Health Service (grpc.health.v1.Health)
  // This enables health checks via: grpc.health.v1.Health/Check
  registerHealthService(server, "auth.AuthService", async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (err) {
      console.error("[gRPC] Health check failed:", err);
      return false;
    }
  });

  // Enable gRPC reflection for tooling (grpcurl, etc.)
  if (process.env.ENABLE_GRPC_REFLECTION !== "false") {
    try {
      const { enableReflection } = require("@common/utils/grpc-reflection");
      enableReflection(server, [PROTO_PATH], ["auth.AuthService"]);
    } catch (err) {
      console.warn("[gRPC] Failed to enable reflection:", err);
    }
  }

  // Try to load TLS certs (for production with ALPN = h2)
  let credentials: grpc.ServerCredentials;
  const keyPath = process.env.TLS_KEY_PATH || "/etc/certs/tls.key";
  const certPath = process.env.TLS_CERT_PATH || "/etc/certs/tls.crt";
  const caPath = process.env.TLS_CA_PATH || process.env.GRPC_CA_CERT || "/etc/certs/ca.crt";
  
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    
    // For strict TLS: verify client certificates if CA cert exists
    let rootCerts: Buffer | null = null;
    let checkClientCert = false;
    if (fs.existsSync(caPath)) {
      rootCerts = fs.readFileSync(caPath);
      checkClientCert = true;
      console.log("[gRPC] Starting secure HTTP/2-only server with strict TLS (client cert verification)");
    } else {
      console.log("[gRPC] Starting secure HTTP/2-only server with ALPN = h2 (no client cert verification)");
    }
    
    credentials = grpc.ServerCredentials.createSsl(
      rootCerts,
      [{ private_key: key, cert_chain: cert }],
      checkClientCert as any
    );
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
