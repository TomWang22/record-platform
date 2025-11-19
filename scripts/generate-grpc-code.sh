#!/usr/bin/env bash
set -euo pipefail

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }

say "=== Generating gRPC Code ==="

# Check if protoc is installed
if ! command -v protoc &> /dev/null; then
  echo "⚠️  protoc not found. Install with:"
  echo "   brew install protobuf"
  echo "   npm install -g grpc-tools"
  exit 1
fi

# Create output directories
mkdir -p services/records-service/src/grpc/generated
mkdir -p services/auth-service/src/grpc/generated

# Generate TypeScript/Node.js code for records-service
say "Generating TypeScript code for records-service..."
if command -v grpc_tools_node_protoc &> /dev/null; then
  grpc_tools_node_protoc \
    --plugin=protoc-gen-ts=./node_modules/.bin/protoc-gen-ts \
    --ts_out=./services/records-service/src/grpc/generated \
    --js_out=import_style=commonjs,binary:./services/records-service/src/grpc/generated \
    --grpc_out=./services/records-service/src/grpc/generated \
    --proto_path=./proto \
    ./proto/records.proto
  ok "TypeScript code generated"
else
  warn "grpc_tools_node_protoc not found. Install with: npm install -g grpc-tools"
fi

# Generate TypeScript/Node.js code for auth-service
say "Generating TypeScript code for auth-service..."
if command -v grpc_tools_node_protoc &> /dev/null; then
  grpc_tools_node_protoc \
    --plugin=protoc-gen-ts=./node_modules/.bin/protoc-gen-ts \
    --ts_out=./services/auth-service/src/grpc/generated \
    --js_out=import_style=commonjs,binary:./services/auth-service/src/grpc/generated \
    --grpc_out=./services/auth-service/src/grpc/generated \
    --proto_path=./proto \
    ./proto/auth.proto
  ok "TypeScript code generated"
else
  warn "grpc_tools_node_protoc not found"
fi

say "=== Code Generation Complete ==="
echo ""
echo "Generated files in:"
echo "  - services/records-service/src/grpc/generated/"
echo "  - services/auth-service/src/grpc/generated/"
