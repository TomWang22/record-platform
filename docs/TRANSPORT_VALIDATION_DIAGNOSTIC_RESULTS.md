# Transport Validation Diagnostic Results

Run date: 2025-03-09 (from script execution).

---

## 1. Existing vm.pcap (from ramp capture)

- **File:** `vm.pcap` (~4.5 GB)
- **tshark:** `/opt/homebrew/bin/tshark` (Wireshark 4.6.4)

### QUIC frame types (sample: first 2000 QUIC packets)

| Count | Frame type | Meaning   |
|------:|------------|-----------|
|    20 | 0x00       | Padding   |
|    30 | 0x02       | ACK       |
|    30 | 0x06       | CRYPTO    |

- **STREAM (0x08):** **0** packets with `quic.frame_type == 8`
- **quic.stream filter:** **0** packets

So the ramp capture contains QUIC Initial/Handshake (CRYPTO, ACK, padding) but **no QUIC STREAM frames** in the decoded output.

---

## 2. Curl test capture (test_curl.pcap)

- **Setup:** 10 s tcpdump in Caddy pod while sending HTTP/3 from host.
- **Requests:**  
  - `GET https://192.168.64.240/_caddy/healthz` → **200**  
  - `GET https://192.168.64.240/` → **401**
- **Curl:** `/opt/homebrew/opt/curl/bin/curl` (HTTP/3 support).
- **Capture:** 36 packets, 22 KB (`test_curl.pcap`).

### QUIC frame types in test_curl.pcap

| Count | Frame type | Meaning   |
|------:|------------|-----------|
|    14 | 0x00       | Padding   |
|     1 | 0x01       | PING      |
|     6 | 0x02       | ACK       |
|    46 | 0x06       | CRYPTO    |

- **STREAM (0x08):** **0** packets with `quic.frame_type == 8`
- **quic.stream filter:** **0** packets

So even with real HTTP/3 curl traffic (200 + 401), **no STREAM frames** appear in tshark’s decoded view.

---

## 3. QUIC header form (test_curl.pcap)

- **Long header (1):** Initial (0), Handshake (2) — present.
- **Short header (0):** 1-RTT — present in some packets.

1-RTT (short header) packets carry **encrypted** application data. Without decryption keys, tshark does not decode them as STREAM; it only decodes Initial/Handshake (CRYPTO, ACK, etc.). So “no STREAM” here can mean “STREAM is in encrypted 1-RTT and not visible,” not necessarily “no HTTP/3 application data.”

---

## 4. Conclusion for copilot

- **vm.pcap (ramp):** Only CRYPTO, ACK, padding in decoded QUIC. No `quic.frame_type == 8` and no `quic.stream`. Validator is correct to report “no QUIC stream frames” for the **decoded** pcap.
- **test_curl.pcap:** Same: no decoded STREAM; we do see short-header (1-RTT) packets, so application data may be present but encrypted.
- **Possible causes:**
  1. **Tiny responses** (e.g. healthz) might not require STREAM in cleartext (or fit in other frames in some stacks).
  2. **Encryption:** STREAM frames in 1-RTT are encrypted; tshark without QLOG/keys won’t show them.
- **Next steps to try:**
  - Hit a **larger endpoint** (e.g. JSON or 1KB+ body) and re-check for STREAM.
  - Or **relax validator** when QUIC + short-header (1-RTT) packet count is non-zero (treat as “likely HTTP/3” when STREAM isn’t decodable).

---

## 5. Commands used (for reproducibility)

```bash
# Frame types in vm.pcap (sample)
tshark -r vm.pcap -Y "quic" -c 2000 -T fields -e quic.frame_type | tr ',' '\n' | sed 's/^[[:space:]]*//' | grep -E '0x' | sort | uniq -c

# STREAM (0x08) count
tshark -r vm.pcap -Y "quic.frame_type == 8" -q | wc -l

# Curl + pod capture
POD=$(kubectl get pod -n ingress-nginx -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n ingress-nginx $POD -- sh -c 'tcpdump -i any -w /tmp/test.pcap udp port 443 & PID=$!; sleep 10; kill $PID'
# (from host during capture:)
/opt/homebrew/opt/curl/bin/curl -sk --http3 "https://192.168.64.240/_caddy/healthz" --resolve "record.local:443:192.168.64.240"
/opt/homebrew/opt/curl/bin/curl -sk --http3 "https://192.168.64.240/" --resolve "record.local:443:192.168.64.240"
kubectl cp ingress-nginx/$POD:/tmp/test.pcap ./test_curl.pcap

# STREAM count in curl capture
tshark -r test_curl.pcap -Y "quic.frame_type == 8" -q | wc -l
tshark -r test_curl.pcap -Y "quic" -T fields -e quic.frame_type | tr ',' '\n' | sed 's/^[[:space:]]*//' | grep -E '0x' | sort | uniq -c
```

---

**Summary for copilot:** Ramp and curl captures show QUIC (Initial/Handshake, CRYPTO, ACK). No **decoded** STREAM (0x08) or `quic.stream` in tshark. Curl capture has 1-RTT (short header) packets, so HTTP/3 data may be in encrypted STREAM. Validator is correct on “no visible STREAM”; consider relaxing it when 1-RTT packet count is non-zero or when using a larger response body to force visible STREAM.
