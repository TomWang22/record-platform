# Multi-stage build for kafka-readiness-agent.
ARG RP_SOURCE_SHA=unknown
ARG RP_BUILD_ID=unknown
FROM golang:1.25-alpine AS build
ARG RP_SOURCE_SHA
WORKDIR /src
RUN apk add --no-cache ca-certificates git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w -X main.version=${RP_SOURCE_SHA}" -o /out/kafka-readiness-agent ./cmd/kafka-readiness-agent

FROM gcr.io/distroless/static-debian12:nonroot
ARG RP_SOURCE_SHA
ARG RP_BUILD_ID
LABEL org.opencontainers.image.title="kafka-readiness-agent" \
      org.opencontainers.image.source="https://github.com/TomWang22/record-platform" \
      org.opencontainers.image.revision="${RP_SOURCE_SHA}" \
      rp.source_sha="${RP_SOURCE_SHA}" \
      rp.build_id="${RP_BUILD_ID}"
COPY --from=build /out/kafka-readiness-agent /kafka-readiness-agent
USER nonroot:nonroot
# Loopback-only by default in process config; EXPOSE documents the agent port.
EXPOSE 8099
ENTRYPOINT ["/kafka-readiness-agent"]
