# Caddy with HTTP/3 and tcpdump

Production Caddy deploy uses this image so rotation-suite packet capture works (tcpdump must be inside the pod).

**Build:**
```bash
docker build -t caddy-with-tcpdump:dev docker/caddy-with-tcpdump
```

**Import into cluster:**

- **k3d:** `k3d image import caddy-with-tcpdump:dev -c record-platform`
- **Colima (docker+k3s):** k3s uses the same Docker daemon; the image is already available after `docker build`. Restart Caddy so pods use it: `./scripts/colima-import-caddy-image.sh` or `kubectl -n ingress-nginx rollout restart deployment/caddy-h3`

**Restart Caddy** after importing:
```bash
kubectl -n ingress-nginx rollout restart deployment/caddy-h3
```

Without this image, `kubectl exec ... tcpdump` fails with "tcpdump: command not found" and capture produces empty pcaps.
