# Multi-stage build for kafka-readiness-agent.
FROM golang:1.25-alpine AS build
WORKDIR /src
RUN apk add --no-cache ca-certificates git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/kafka-readiness-agent ./cmd/kafka-readiness-agent

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/kafka-readiness-agent /kafka-readiness-agent
USER nonroot:nonroot
EXPOSE 8099
ENTRYPOINT ["/kafka-readiness-agent"]
