# Caddy (xcaddy / HTTP/3) + edge diagnostic tools for transport capture gates.
# Build tag: caddy-with-tcpdump:dev
#   docker build -t caddy-with-tcpdump:dev -f docker/caddy-with-debug-tools.Dockerfile .
#
# Tools: caddy (xcaddy), tcpdump, tshark, strace, htop, curl, ca-certificates.

ARG GOLANG_IMAGE=mirror.gcr.io/library/golang:1.22-alpine
ARG ALPINE_IMAGE=mirror.gcr.io/library/alpine:3.19
FROM ${GOLANG_IMAGE} AS builder
RUN apk add --no-cache git ca-certificates
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
WORKDIR /build
ENV CADDY_VERSION=v2.8.4
RUN xcaddy build "${CADDY_VERSION}" --output /usr/bin/caddy

FROM ${ALPINE_IMAGE}
RUN apk add --no-cache ca-certificates curl tcpdump tshark strace htop libcap
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
RUN setcap cap_net_bind_service=+ep /usr/bin/caddy 2>/dev/null || true \
  && command -v /usr/bin/caddy \
  && command -v tcpdump \
  && command -v tshark \
  && command -v strace \
  && command -v htop \
  && command -v curl

EXPOSE 443 443/udp 2019 5000
VOLUME ["/config/caddy", "/data/caddy"]
ENTRYPOINT ["/usr/bin/caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
