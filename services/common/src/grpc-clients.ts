/* cspell:ignore grpc */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as path from "path";
import * as fs from "fs";

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
const AUTH_PROTO_PATH = path.join(__dirname, "../../../proto/auth.proto");
const authPackageDefinition = protoLoader.loadSync(AUTH_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const authProto = grpc.loadPackageDefinition(authPackageDefinition) as any;

// Load records proto
const RECORDS_PROTO_PATH = path.join(__dirname, "../../../proto/records.proto");
const recordsPackageDefinition = protoLoader.loadSync(RECORDS_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const recordsProto = grpc.loadPackageDefinition(recordsPackageDefinition) as any;

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
