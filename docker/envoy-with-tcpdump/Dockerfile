# Envoy with tcpdump for packet capture. Official image is distroless (no shell/apt);
# copy binary into Debian (bookworm-slim has tcpdump in main; more reliable than Ubuntu in constrained builds).
FROM envoyproxy/envoy:v1.28-latest AS envoy
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tcpdump && rm -rf /var/lib/apt/lists/*
COPY --from=envoy /usr/local/bin/envoy /usr/local/bin/envoy
RUN useradd -r -u 101 -s /bin/false envoy 2>/dev/null || true
USER envoy
ENTRYPOINT ["/usr/local/bin/envoy"]
