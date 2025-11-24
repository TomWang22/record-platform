/* cspell:ignore grpc */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as fs from "fs";
import { resolveProtoPath } from "./proto";

function buildCredentials() {
  const caPath =
    process.env.GRPC_CA_CERT ||
    process.env.INTERNAL_CA_CERT ||
    process.env.SHARED_CA_CERT ||
    "";
  if (caPath && fs.existsSync(caPath)) {
    const rootCert = fs.readFileSync(caPath);
    return grpc.credentials.createSsl(rootCert);
  }

  if (process.env.NODE_ENV === "production") {
    return grpc.credentials.createSsl();
  }

  return grpc.credentials.createInsecure();
}

// Load auth proto
const AUTH_PROTO_PATH = resolveProtoPath("auth.proto");
const authPackageDefinition = protoLoader.loadSync(AUTH_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const authProto = grpc.loadPackageDefinition(authPackageDefinition) as any;

// Load records proto
const RECORDS_PROTO_PATH = resolveProtoPath("records.proto");
const recordsPackageDefinition = protoLoader.loadSync(RECORDS_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const recordsProto = grpc.loadPackageDefinition(recordsPackageDefinition) as any;

// Load social proto
const SOCIAL_PROTO_PATH = resolveProtoPath("social.proto");
const socialPackageDefinition = protoLoader.loadSync(SOCIAL_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const socialProto = grpc.loadPackageDefinition(socialPackageDefinition) as any;

// Load listings proto
const LISTINGS_PROTO_PATH = resolveProtoPath("listings.proto");
const listingsPackageDefinition = protoLoader.loadSync(LISTINGS_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const listingsProto = grpc.loadPackageDefinition(listingsPackageDefinition) as any;

// Load shopping proto
const SHOPPING_PROTO_PATH = resolveProtoPath("shopping.proto");
const shoppingPackageDefinition = protoLoader.loadSync(SHOPPING_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const shoppingProto = grpc.loadPackageDefinition(shoppingPackageDefinition) as any;

// Create gRPC clients
export function createAuthClient(address: string = "auth-service:50051") {
  const AuthService = authProto.auth.AuthService;
  return new AuthService(
    address,
    buildCredentials()
  );
}

export function createRecordsClient(address: string = "records-service:50051") {
  const RecordsService = recordsProto.records.RecordsService;
  return new RecordsService(
    address,
    buildCredentials()
  );
}

export function createSocialClient(address: string = "social-service:50056") {
  const SocialService = socialProto.social.SocialService;
  return new SocialService(
    address,
    buildCredentials()
  );
}

export function createListingsClient(address: string = "listings-service:50057") {
  const ListingsService = listingsProto.listings.ListingsService;
  return new ListingsService(
    address,
    buildCredentials()
  );
}

export function createShoppingClient(address: string = "shopping-service:50058") {
  const ShoppingService = shoppingProto.shopping.ShoppingService;
  return new ShoppingService(
    address,
    buildCredentials()
  );
}

// Helper to promisify gRPC calls with timeout
export function promisifyGrpcCall<T>(
  client: any,
  method: string,
  request: any,
  timeoutMs: number = 10000 // Default 10 second timeout
): Promise<T> {
  return new Promise((resolve, reject) => {
    let completed = false;
    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true;
        reject(new Error(`gRPC call ${method} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    try {
      client[method](request, (error: any, response: T) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      reject(err);
    }
  });
}
