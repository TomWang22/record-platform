# Envoy + diagnostic tools for transport capture gates.
# Build tag: envoy-with-tcpdump:dev
#   docker build -t envoy-with-tcpdump:dev -f docker/envoy-with-debug-tools.Dockerfile .
#
# Tools: envoy (upstream), tcpdump, tshark, strace, htop, curl, ca-certificates.

ARG ENVOY_IMAGE=mirror.gcr.io/envoyproxy/envoy:v1.28-latest
FROM ${ENVOY_IMAGE}
USER root
COPY scripts/docker/debian-apt-update.sh /tmp/debian-apt-update.sh
RUN chmod +x /tmp/debian-apt-update.sh \
  && /tmp/debian-apt-update.sh \
  && apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Min-ValidTime=0 install -y --no-install-recommends \
    ca-certificates curl tcpdump tshark strace htop \
  && rm -rf /var/lib/apt/lists/* /tmp/debian-apt-update.sh \
  && command -v envoy \
  && command -v tcpdump \
  && command -v tshark \
  && command -v strace \
  && command -v htop \
  && command -v curl
