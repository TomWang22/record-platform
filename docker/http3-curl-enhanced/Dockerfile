# HTTP/3 testing image: alpine/curl-http3 + tcpdump, tshark, valgrind
# Uses existing alpine/curl-http3 (HTTP/3 curl). Adds packet capture and memory-leak tooling.
# No Homebrew; no grpcurl (use host grpcurl for gRPC). Builds reliably.

FROM alpine/curl-http3:latest

USER root

# Packet capture and analysis
RUN apk add --no-cache \
    tcpdump \
    tshark \
    net-tools \
    iproute2 \
    bind-tools \
    jq \
    && rm -rf /var/cache/apk/*

# Valgrind for memory-leak testing (optional, ~15MB)
RUN apk add --no-cache valgrind 2>/dev/null || true

# Optional: ensure tcpdump can write to /tmp
RUN mkdir -p /tmp/captures && chmod 777 /tmp/captures

# Verify tools
RUN echo "=== Tool check ===" && \
    curl -V | head -1 && \
    tcpdump --version 2>&1 | head -1 && \
    (tshark --version 2>&1 | head -1 || true) && \
    (valgrind --version 2>&1 | head -1 || true) && \
    jq --version && \
    echo "=== Ready ==="

WORKDIR /tmp
CMD ["/bin/sh"]