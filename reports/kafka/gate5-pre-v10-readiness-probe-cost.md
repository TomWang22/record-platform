# Gate 5 pre-v10 readiness probe cost

- expected/tested: **90/90**
- overall timeouts: **0**
- duration ms min/median/p95/max: **2568/12302/21970/33004**

## Static audit

- No per-probe keytool/openssl/PKCS12/JKS generation — uses mounted `/etc/kafka/secrets/*.jks`.
- Each invoke: rewrite `/tmp/rp-ready.props` + cold-start `kafka-broker-api-versions` (JVM).
- Direct single broker DNS; HTTPS hostname verification; no multi-broker bootstrap.
- **timeoutSeconds == periodSeconds (45)** — no scheduling margin.

- kafka-0: n=30 ok=30 timeouts=0 min/med/p95/max=6765/13415/32058/33004
- kafka-1: n=30 ok=30 timeouts=0 min/med/p95/max=2568/9092/19963/20771
- kafka-2: n=30 ok=30 timeouts=0 min/med/p95/max=7456/14287/17071/17349
