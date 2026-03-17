# Transport Metrics Specification

**Version:** 1.0  
**Applies to:** transport_ceiling_report schema ≥ 2.1

---

## 1. QUIC Packet Count

**Definition:** Total packets in capture matching Wireshark filter `quic`.

**Computation:** `tshark -r pcap -Y quic -T fields -e frame.number -c N` (capped).

**Purpose:** Confirms sustained QUIC session.

---

## 2. QUIC 1-RTT Packets

**Definition:** Packets with `quic.header_form == 0` (short header).

**Interpretation:** Indicates encrypted application phase (post-handshake). CI gate may require ≥10 for sustained data phase.

---

## 3. QUIC Loss Rate (Estimated)

**Definition:**

```
loss_rate = missing_packet_numbers / total_packet_numbers
```

**Notes:** Derived from packet number gaps per connection ID.

**Limitations:** May underestimate under NAT rebinding.

---

## 4. Handshake RTT (Estimated)

**Definition:** Time delta between earliest Initial packet and earliest 1-RTT packet (at or after that Initial), in milliseconds.

**Unit:** milliseconds

---

## 5. Transport Confidence Score

**Definition:** Deterministic weighted scoring model.

```
score = Σ(weight_i × condition_i)
```

**Breakdown (example):**

| Component           | Points | Condition                    |
|--------------------|--------|------------------------------|
| quic_detected      | 25     | QUIC packets present         |
| version_detected   | 10     | QUIC version in capture      |
| no_http2_fallback  | 10     | No HTTP/2 frames             |
| 1rtt_data_phase    | 20     | >10 1-RTT packets            |
| low_loss           | 15     | loss_rate < 0.02             |
| no_retry           | 10     | No Retry packets             |
| fast_handshake     | 10     | handshake_rtt_ms < 100       |

**Range:** 0–100  

**Meaning:**

- 0–40: weak proof  
- 40–70: moderate  
- 70–90: strong  
- 90–100: definitive  

---

## 6. Schema Discipline

- All report keys always present.  
- `null` means unavailable.  
- No `"N/A"` strings.  
- No empty structural objects (e.g. `littles_law`, `scheduler` always have full key set).  
- CI may assert absence of `"N/A"` and validate against JSON Schema.

---

## 7. Reproducibility

- **experiment_uuid:** Unique per run (UUID v4).  
- **reproducibility_hash:** SHA-256 of config + ramp options + env (K6_LB_IP, STRICT_H3, H2_RATE).  
- **transport_proof_sha256:** SHA-256 of pcap file (forensic proof).

---

## 8. Regression Policy (optional)

When comparing two reports (e.g. `--compare OLD.json`):

- **Regression:** `h3_max_rps` drops >5% **or** `quic_loss_rate_estimated` increases >0.02.  
- Exit code 1 if regression detected.
