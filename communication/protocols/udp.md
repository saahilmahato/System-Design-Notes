# UDP Protocol — System Design Notes

---

## 1. What is UDP?

**User Datagram Protocol (UDP)** is a connectionless, unreliable transport-layer protocol (Layer 4 of the OSI model). It sends discrete packets called **datagrams** to a destination without establishing a prior connection, without guaranteeing delivery, ordering, or duplicate protection.

UDP is defined in **RFC 768** and sits alongside TCP as one of the two dominant transport protocols in the Internet protocol suite.

---

## 2. Core Characteristics

| Property | UDP Behavior |
|---|---|
| Connection | Connectionless — no handshake |
| Reliability | Unreliable — no delivery guarantee |
| Ordering | No ordering — packets may arrive out of sequence |
| Error Checking | Minimal — checksum only (optional in IPv4, mandatory in IPv6) |
| Flow Control | None |
| Congestion Control | None |
| Overhead | Very low — 8-byte fixed header |
| Latency | Low — no setup/teardown |
| Broadcast/Multicast | Supported natively |

---

## 3. UDP Packet Structure

```
 0      7 8     15 16    23 24    31
+--------+--------+--------+--------+
| Source |Destinat| Length |Checksum|
|  Port  |  Port  |        |        |
+--------+--------+--------+--------+
|          Data (payload)           |
+-----------------------------------+
```

**Header fields (8 bytes total):**
- **Source Port** (16 bits) — optional; identifies sender port
- **Destination Port** (16 bits) — identifies target service
- **Length** (16 bits) — length of header + data in bytes (min 8)
- **Checksum** (16 bits) — error detection over header + data

Maximum UDP datagram size: **65,507 bytes** (65,535 − 8-byte UDP header − 20-byte IP header). In practice, datagrams exceeding the MTU (~1,472 bytes for Ethernet) cause IP fragmentation.

---

## 4. How UDP Works

```
Sender                          Receiver
  |                                 |
  |   --- Datagram 1 ----------->   |
  |   --- Datagram 2 ----------->   |  (may arrive as Datagram 3 first)
  |   --- Datagram 3 ----------->   |
  |                                 |
  |  No ACK, no retransmit, no      |
  |  connection management          |
```

**Key behaviors:**
- **Fire and forget** — sender does not know if the packet was received
- **No congestion window** — sender can transmit at full rate continuously
- **No head-of-line blocking** — lost packets don't stall subsequent ones
- **Application-controlled reliability** — if needed, must be implemented in the application layer

---

## 5. UDP vs. TCP — Detailed Comparison

| Dimension | UDP | TCP |
|---|---|---|
| **Connection** | Connectionless | Connection-oriented (3-way handshake) |
| **Reliability** | None | Guaranteed delivery via ACK + retransmit |
| **Ordering** | Not guaranteed | Guaranteed in-order delivery |
| **Flow Control** | None | Sliding window |
| **Congestion Control** | None | AIMD, BBR, CUBIC |
| **Header Size** | 8 bytes | 20–60 bytes |
| **Latency** | Lower | Higher (RTT for handshake + ACK) |
| **Throughput** | Potentially higher (no backoff) | Rate-limited by congestion control |
| **State** | Stateless | Stateful (connection tracking) |
| **Broadcast/Multicast** | Yes | No |
| **Use Case** | Real-time, latency-sensitive | Reliable data transfer |

---

## 6. Trade-offs

### ✅ Advantages

- **Low latency** — no handshake, no ACK wait. Critical for real-time applications where a stale packet is worse than a missing one.
- **Low overhead** — 8-byte header vs. 20–60 bytes for TCP. Reduces bandwidth consumption per packet significantly at scale.
- **High throughput** — no congestion window or flow control throttling sender rate.
- **Stateless on the server** — no per-connection state maintained; scales horizontally with minimal coordination.
- **Supports multicast and broadcast** — one packet can reach multiple receivers, ideal for service discovery, live streaming, and real-time pub/sub.
- **No head-of-line blocking** — independent datagrams; one lost packet doesn't block others.
- **Application-level control** — developers can implement exactly the reliability they need — selective retransmit, FEC (Forward Error Correction), or accept loss entirely.

### ❌ Disadvantages

- **No delivery guarantee** — packets can be silently dropped by routers, switches, or OS buffers.
- **No ordering guarantee** — application must handle out-of-order packets if sequence matters.
- **No built-in congestion control** — can overwhelm the network; poorly behaved UDP senders contribute to congestion collapse.
- **No flow control** — a fast sender can overwhelm a slow receiver's buffers.
- **Firewall/NAT unfriendly** — stateless nature makes NAT traversal harder (requires STUN/TURN/ICE for P2P connections).
- **Application complexity** — reliability features must be implemented manually if needed.
- **Amplification attacks** — UDP's stateless, connectionless nature makes it easy to spoof source IPs, enabling DDoS reflection/amplification attacks (e.g., DNS amplification, NTP amplification).

---

## 7. When to Choose UDP Over TCP

**Choose UDP when:**

1. **Timeliness > Completeness** — a late packet is useless (live audio, video, gaming)
2. **Loss tolerance exists** — the application can operate with occasional packet loss
3. **Low overhead is critical** — IoT sensors, telemetry pipelines, high-frequency trading
4. **Broadcast/multicast is required** — service discovery (mDNS), IPTV, multiplayer game state sync
5. **You need custom reliability** — QUIC, DCCP, and application-level ARQ give you fine-grained control
6. **Simple request/response with small payloads** — DNS queries, DHCP, SNMP
7. **Server-side scalability is critical** — stateless servers can handle millions of UDP "connections" without per-connection state

**Stick with TCP when:**

- Data integrity is non-negotiable (financial transactions, file transfer, email)
- Order of operations matters (database commands, HTTP, SSH)
- You need flow/congestion control without rolling your own

---

## 8. Reliability Patterns Built on UDP

When partial reliability is needed, these patterns are implemented at the application layer:

### 8.1 Selective Acknowledgment + Retransmission
Application assigns sequence numbers, receiver sends SACKs, sender retransmits only lost segments. Used in QUIC and many game engines.

### 8.2 Forward Error Correction (FEC)
Sender transmits redundant data (e.g., XOR of N packets). Receiver can reconstruct lost packets without a retransmit round trip. Used in WebRTC for audio/video.

### 8.3 Negative Acknowledgment (NACK)
Receiver only sends feedback when a packet is *missing* — reduces ACK overhead. Used in video conferencing and SRT (Secure Reliable Transport).

### 8.4 Jitter Buffers
Receiver buffers a small window of packets to reorder them before playback. Absorbs reordering jitter without retransmission. Used in VoIP and live streaming.

### 8.5 Redundant Transmission
Send the same packet 2–3 times across different paths. Accepts bandwidth overhead in exchange for near-zero retransmit latency. Used in some real-time audio systems.

---

## 9. Key Protocols Built on UDP

| Protocol | Layer | Purpose | Why UDP? |
|---|---|---|---|
| **DNS** | Application | Domain resolution | Simple req/resp, low latency, retry at app layer |
| **DHCP** | Application | IP address allocation | Broadcast-based, no prior IP to connect from |
| **QUIC** | Transport (over UDP) | HTTP/3 transport | Custom reliability + TLS, avoids TCP HOL blocking |
| **WebRTC** | Application | Browser P2P media | Low-latency audio/video, loss-tolerant |
| **RTP/RTCP** | Application | Real-time media transport | Timestamped media delivery, loss acceptable |
| **SNMP** | Application | Network monitoring | Polling/trap model, loss acceptable |
| **TFTP** | Application | Trivial file transfer | Simple environments, adds app-level ACK |
| **NTP** | Application | Time synchronization | Lightweight, single datagram per query |
| **SRT** | Application | Secure reliable transport | Video streaming with selective retransmit |
| **DTLS** | Transport | Encrypted UDP | Security layer for UDP-based protocols |

---

## 10. QUIC — The Modern Evolution of UDP

**QUIC** (now standardized as RFC 9000 and underlying HTTP/3) is the most significant modern protocol built on UDP. It demonstrates how to build robust, reliable, encrypted transport on top of UDP.

**Key QUIC features:**
- **0-RTT / 1-RTT connection establishment** — vs. TCP's 1-RTT + TLS 1.3's additional round trip
- **Stream multiplexing** — multiple independent streams; one lost packet doesn't block others (eliminates TCP's head-of-line blocking)
- **Connection migration** — connections survive IP address changes (mobile switching between Wi-Fi and LTE)
- **Integrated TLS 1.3** — encryption is mandatory, not optional
- **Application-controlled congestion** — CUBIC, BBR or custom controllers

QUIC proves that unreliable UDP + application-layer logic can outperform TCP for modern workloads.

---

## 11. UDP in System Design Contexts

### 11.1 Real-Time Communication Systems (VoIP, Video Conferencing)
- **Why UDP:** Audio/video frames are time-sensitive. A retransmitted 200ms-old audio packet is worse than silence.
- **Pattern:** RTP over UDP with jitter buffer + FEC. RTCP carries statistics (packet loss %, jitter, RTT) for adaptive bitrate.
- **Trade-off:** Accept ~1–5% packet loss in exchange for sub-100ms glass-to-glass latency.

### 11.2 Online Multiplayer Games
- **Why UDP:** Game state (player position, health) is superseded by the next tick. Retransmitting old state wastes RTT.
- **Pattern:** Fixed-rate tick-based updates (20–64 Hz), sequence numbers, client-side prediction, server reconciliation.
- **Trade-off:** Clients tolerate brief misprediction artifacts in exchange for responsive controls.

### 11.3 Live Video Streaming
- **Why UDP:** CDN to viewer path benefits from multicast; ABR chunks can tolerate minor loss.
- **Pattern:** SRT or RIST for contribution links (adds selective retransmit); HLS/DASH over HTTP/3 (QUIC) for last-mile.

### 11.4 DNS Infrastructure
- **Why UDP:** A DNS query + response fits in a single 512-byte datagram. UDP cuts RTT by eliminating TCP handshake. Falls back to TCP for responses > 512 bytes.
- **Scale:** Root DNS servers handle millions of UDP queries/second per anycast instance.

### 11.5 IoT and Telemetry Pipelines
- **Why UDP:** Sensors emit small, frequent readings. Missing one reading is acceptable. UDP's low overhead is critical on constrained networks (LoRaWAN, LTE-M).
- **Pattern:** Syslog over UDP, CoAP (Constrained Application Protocol) over UDP, custom binary protocols.

### 11.6 Financial Market Data Feeds
- **Why UDP:** Exchanges use UDP multicast to broadcast price ticks to thousands of subscribers simultaneously. One packet reaches all subscribers; TCP would require N separate connections.
- **Pattern:** Multicast UDP with sequence numbers; subscribers detect gaps and request retransmit via a separate TCP channel.

---

## 12. Security Considerations

### 12.1 UDP Amplification / DDoS
Since UDP has no handshake, attackers spoof victim's source IP → server sends large response to victim.

**Examples:**
- DNS amplification: 40-byte query → 4,000-byte response (100x amplification)
- NTP monlist: 8-byte query → 48,000-byte response (600x amplification)
- Memcached UDP: ~15-byte query → 500KB+ response (50,000x amplification)

**Mitigations:** BCP38 (ingress filtering), rate limiting UDP response size, disabling unused UDP services, response rate limiting (DNS RRL).

### 12.2 IP Spoofing
Without a handshake, source IP can be trivially spoofed. Mitigated at network level via BCP38.

### 12.3 DTLS (Datagram TLS)
Provides TLS-equivalent security for UDP traffic. Used in WebRTC (mandatory), VPN protocols (WireGuard uses UDP with its own crypto), and DTLS 1.3 for IoT.

### 12.4 Firewall / NAT Traversal
- UDP has no connection state so many firewalls default-drop inbound UDP.
- NAT mappings for UDP expire faster than TCP (typically 30s vs. 4 minutes).
- **STUN/TURN/ICE** are used for P2P hole punching in WebRTC.

---

## 13. Operational Considerations

### Tuning OS UDP Buffers
```bash
# Increase receive buffer (critical for high-throughput UDP)
sysctl -w net.core.rmem_max=134217728
sysctl -w net.core.rmem_default=134217728

# Increase send buffer
sysctl -w net.core.wmem_max=134217728
```
Buffer overflow → silent packet drops at the OS level. Monitor with `ss -u` or `/proc/net/udp`.

### Metrics to Monitor
| Metric | Tool | Significance |
|---|---|---|
| `udp_rcvbuf_errors` | `/proc/net/snmp` | OS receive buffer overflow (backpressure) |
| Packet loss % | RTCP, application | End-to-end delivery quality |
| Jitter (ms) | RTCP, ping variance | Network path stability |
| Reorder rate | Application sequence gaps | Path asymmetry / multipath issues |
| Amplification traffic | Firewall logs | Abuse/DDoS indicator |

---

## 14. Real-World Systems Using UDP

| Company / System | UDP Usage |
|---|---|
| **Zoom / Google Meet / Discord** | WebRTC (RTP over UDP) for audio/video; falls back to TCP only when UDP is blocked |
| **Cloudflare / Google** | QUIC/HTTP3 — UDP-based transport for all web traffic, reducing latency at scale |
| **Riot Games (Valorant)** | Custom UDP game protocol with sequence numbers and server-authoritative reconciliation |
| **Valve (Steam / Source Engine)** | UDP for game state sync; reliable messages layered on top for critical events |
| **NYSE / NASDAQ** | UDP multicast for market data feeds (ITCH, OPRA protocols) to all co-located subscribers |
| **Netflix** | QUIC for video delivery to reduce rebuffering on mobile and high-latency paths |
| **Facebook / WhatsApp** | WebRTC (UDP) for voice/video calls across 2B+ users |
| **Akamai / Fastly CDNs** | QUIC for object delivery; UDP multicast for live event streaming |
| **AWS Route 53 / Cloudflare DNS** | UDP for all standard DNS resolutions; billions of queries/day |
| **Twitch** | SRT over UDP for broadcaster contribution feeds; QUIC for viewer delivery |

---

## 15. Decision Framework

```
Is data loss completely unacceptable?
  └─ YES → Use TCP (or QUIC with full reliability)
  └─ NO  → Is latency (< 50–100ms) critical?
              └─ YES → Use UDP (raw or QUIC)
              └─ NO  → Does it need broadcast/multicast?
                          └─ YES → Use UDP multicast
                          └─ NO  → Is request/response tiny (< 1 packet)?
                                      └─ YES → UDP (DNS, NTP style)
                                      └─ NO  → Use TCP
```

---

## 16. Anti-Patterns

- **Using UDP for financial transactions or database replication** — silent data loss is catastrophic
- **Ignoring OS buffer tuning** — default buffers are too small for high-throughput UDP; drops are silent and hard to debug
- **Implementing full TCP semantics over UDP manually** — at that point, just use TCP or QUIC
- **Leaving UDP services open to the internet without rate limiting** — amplification attack surface
- **Assuming UDP is always faster** — on reliable LAN paths, the difference is negligible; the real gain is in lossy/high-latency paths
- **No monitoring of UDP packet loss** — without sequence numbers and metrics, you won't know you're dropping packets
- **Binding to UDP port 0.0.0.0 for internal services** — exposes amplification vectors; bind to specific interfaces