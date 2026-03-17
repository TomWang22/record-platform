# Caddy with HTTP/3 (QUIC) and tcpdump for packet capture.
# Build with xcaddy. Note: caddy:2.8.4-builder's default xcaddy build can produce a minimal binary
# without the QUIC listener (no UDP 443). If colima ssh -- ss -lunp | grep 443 shows nothing after
# deploy, the binary lacks HTTP/3; build on an amd64 host/CI or use a Caddy binary that includes it.
# Real verification: UDP 443 must appear (VM or in-pod). Build native on ARM (no --platform linux/amd64).
#
# Build: docker build -t caddy-with-tcpdump:dev docker/caddy-with-tcpdump
ARG CADDY_VERSION=2.8.4

FROM caddy:${CADDY_VERSION}-builder AS builder
ARG CADDY_VERSION
RUN xcaddy build "v${CADDY_VERSION}"

FROM caddy:${CADDY_VERSION}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
RUN apk add --no-cache tcpdump iproute2
EXPOSE 443 443/udp 2019
ENTRYPOINT ["caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
