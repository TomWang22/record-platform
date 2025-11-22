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

// Helper to promisify gRPC calls
export function promisifyGrpcCall<T>(
  client: any,
  method: string,
  request: any
): Promise<T> {
  return new Promise((resolve, reject) => {
    client[method](request, (error: any, response: T) => {
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    });
  });
}
