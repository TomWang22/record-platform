# In-cluster k6 with HTTP/3 (xk6-http3). Build from repo root: docker build -f docker/k6-http3/Dockerfile .
# Run in cluster to remove host/Colima NAT from path and isolate UDP instability.
ARG GO_VERSION=1.21
FROM golang:${GO_VERSION}-alpine AS builder
RUN apk add --no-cache git
ENV CGO_ENABLED=0
WORKDIR /build

# Copy extension and build k6 with go mod replace (no xk6 CLI to avoid Go 1.25 requirement)
COPY xk6-http3 /build/xk6-http3
RUN cd /build/xk6-http3 && go mod tidy

COPY docker/k6-http3/main.go /build/k6-work/main.go
RUN mkdir -p /build/k6-work && cd /build/k6-work && \
    go mod init k6-custom-http3 && \
    go get go.k6.io/k6@v0.50.0 && \
    go mod edit -replace github.com/record-platform/xk6-http3=/build/xk6-http3 && \
    go get github.com/record-platform/xk6-http3@v0.0.0 && \
    go mod tidy && \
    go build -o /build/k6-http3 .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /build/k6-http3 /usr/local/bin/k6-http3
RUN chmod +x /usr/local/bin/k6-http3
WORKDIR /output
ENTRYPOINT ["/usr/local/bin/k6-http3"]
