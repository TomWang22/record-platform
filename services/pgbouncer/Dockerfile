# services/pgbouncer/Dockerfile
FROM alpine:3.20

# Create non-root user first (uid/gid 1000 for consistency)
RUN addgroup -S pgbouncer -g 1000 \
 && adduser  -S pgbouncer -G pgbouncer -u 1000 -h /var/lib/pgbouncer -D \
 # Install runtime deps at build time (ok to be root here)
 && apk add --no-cache pgbouncer dumb-init \
 # Lock down writable dirs
 && mkdir -p /var/lib/pgbouncer \
 && chown -R pgbouncer:pgbouncer /var/lib/pgbouncer

USER pgbouncer
WORKDIR /var/lib/pgbouncer

# Use the stock config from your ConfigMap/Secret
ENTRYPOINT ["/usr/bin/dumb-init","--"]
CMD ["pgbouncer","/etc/pgbouncer/pgbouncer.ini"]