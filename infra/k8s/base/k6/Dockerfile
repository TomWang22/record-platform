# Custom k6 image with HTTP/3 support and debugging tools.
# xk6 v1.3+ requires Go 1.25; use official golang image for compatibility.
# Stage 1: Build k6 with xk6-http3 extension
FROM golang:1.25-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Install xk6 (latest; requires Go 1.25)
RUN go install go.k6.io/xk6/cmd/xk6@latest

# Build k6 with HTTP/3 extension
WORKDIR /build
COPY xk6-http3 /build/xk6-http3
RUN xk6 build v0.50.0 \
    --with github.com/record-platform/xk6-http3=/build/xk6-http3 \
    --output /k6

# Stage 2: Runtime image with debugging tools
FROM alpine:3.19

# Copy k6 binary from builder
COPY --from=builder /k6 /usr/local/bin/k6

# Install runtime dependencies and debugging tools
RUN apk add --no-cache \
    ca-certificates \
    net-tools \
    tcpdump \
    tshark \
    htop \
    curl \
    postgresql-client \
    procps \
    iputils \
    bind-tools && \
    which netstat tcpdump tshark htop curl psql k6 && \
    echo "Tools installed: k6 (with HTTP/3), net-tools, tcpdump, tshark, htop, curl, postgresql-client"

# Create k6 user (matches grafana/k6 base image)
RUN adduser -D -u 12345 k6
USER 12345

WORKDIR /scripts

# Verify k6 is working
RUN k6 version
