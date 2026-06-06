# Record Platform Caddy runtime + debug edge image (HTTP/3 + operator tooling).
# Build: ./scripts/build-rp-caddy.sh
# See docker/caddy/README.md for debug pod caps (NET_ADMIN / NET_RAW).

ARG GOLANG_IMAGE=mirror.gcr.io/library/golang:1.22-alpine
ARG ALPINE_IMAGE=mirror.gcr.io/library/alpine:3.19

FROM ${GOLANG_IMAGE} AS builder
RUN apk add --no-cache git ca-certificates
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
WORKDIR /build
ENV CADDY_VERSION=v2.8.4
RUN xcaddy build "${CADDY_VERSION}" --output /usr/bin/caddy

FROM ${ALPINE_IMAGE}
RUN apk add --no-cache \
    ca-certificates \
    curl \
    jq \
    bind-tools \
    openssl \
    strace \
    htop \
    tcpdump \
    tshark \
    libcap

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY --from=builder /go/bin/xcaddy /usr/local/bin/xcaddy

RUN setcap cap_net_bind_service=+ep /usr/bin/caddy 2>/dev/null || true

EXPOSE 80 443 443/udp 2019
VOLUME ["/etc/caddy", "/data/caddy", "/config/caddy"]
ENTRYPOINT ["/usr/bin/caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
