# TCP Protocol

## Table of Contents
1. [What is TCP?](#what-is-tcp)
2. [How TCP Works](#how-tcp-works)
3. [Key Mechanisms](#key-mechanisms)
4. [TCP vs UDP](#tcp-vs-udp)
5. [Trade-offs](#trade-offs)
6. [Real-World Applications](#real-world-applications)
7. [TCP in System Design](#tcp-in-system-design)
8. [Performance Tuning](#performance-tuning)
9. [Anti-Patterns](#anti-patterns)
10. [Decision Framework](#decision-framework)
11. [Monitoring Metrics](#monitoring-metrics)

---

## What is TCP?

**Transmission Control Protocol (TCP)** is a connection-oriented, reliable, byte-stream transport layer protocol (OSI Layer 4). It provides ordered, error-checked delivery of a stream of bytes between applications running on hosts communicating via an IP network.

### Core Guarantees
| Guarantee | Description |
|---|---|
| **Reliability** | All bytes sent are received; lost segments are retransmitted |
| **Ordering** | Bytes are delivered in the exact order they were sent |
| **Error Detection** | Checksum on every segment; corrupt segments are discarded and retransmitted |
| **Flow Control** | Receiver controls how fast sender transmits (receive window) |
| **Congestion Control** | Sender adapts to network conditions to avoid overloading the network |
| **Full-Duplex** | Data can flow simultaneously in both directions |

---

## How TCP Works

### 1. Three-Way Handshake (Connection Establishment)
```
Client                          Server
  |  ---- SYN (seq=x) -------->  |   Step 1: Client requests connection
  |  <-- SYN-ACK (seq=y,ack=x+1) |   Step 2: Server acknowledges, sends its own SYN
  |  ---- ACK (ack=y+1) ------->  |   Step 3: Client acknowledges server's SYN
  |                               |
  |  ===== DATA TRANSFER =======  |
```

**Cost:** 1.5 RTT (Round-Trip Times) before any data is sent.  
This latency cost is critical in system design — it compounds on every new TCP connection.

### 2. Data Transfer
- Data is broken into **segments** (MTU ≈ 1500 bytes on Ethernet)
- Each segment carries a **sequence number**
- Receiver sends **ACKs** for received segments
- **Sliding window** allows multiple unacknowledged segments in flight simultaneously

### 3. Four-Way Handshake (Connection Termination)
```
Active Closer                  Passive Closer
  |  --- FIN ----------------> |   Step 1: Initiates close
  |  <-- ACK ----------------  |   Step 2: Acknowledges FIN
  |  <-- FIN ----------------  |   Step 3: Passive side closes
  |  --- ACK ----------------> |   Step 4: Final ACK
  |                            |
  [TIME_WAIT state: 2*MSL]         Client waits before fully closing
```

**TIME_WAIT** (typically 60–120 seconds) prevents old duplicate segments from being mistaken as new. This can exhaust port numbers under high connection churn.

---

## Key Mechanisms

### Flow Control — Receive Window (rwnd)
- Receiver advertises a **receive window size** in every ACK
- Sender may not have more than `rwnd` bytes of unacknowledged data in flight
- Prevents a fast sender from overwhelming a slow receiver
- Window scales dynamically; if receiver buffer fills, window shrinks to 0 → **zero-window stall**

### Congestion Control
TCP uses multiple algorithms to detect and respond to network congestion:

#### Slow Start
- Begins with `cwnd = 1 MSS` (Maximum Segment Size)
- Doubles `cwnd` every RTT until `ssthresh` (slow start threshold) is reached
- Ensures sender ramps up gradually

#### Congestion Avoidance
- After `ssthresh`, increases `cwnd` linearly (+1 MSS per RTT)
- Probes for available bandwidth without flooding the network

#### Fast Retransmit & Fast Recovery
- On 3 duplicate ACKs → sender assumes packet loss without waiting for timeout
- Retransmits the missing segment immediately
- Halves `ssthresh` and `cwnd` (less aggressive than full timeout reset)

#### CUBIC / BBR (Modern Algorithms)
| Algorithm | Strategy | Best For |
|---|---|---|
| **Reno** | Classic AIMD (Additive Increase, Multiplicative Decrease) | Legacy networks |
| **CUBIC** | Cubic function for window growth | High-bandwidth, high-latency networks (default in Linux) |
| **BBR (Bottleneck Bandwidth and RTT)** | Model-based; targets bandwidth × RTT | Cloud, data centers, high-throughput systems (Google) |

### Nagle's Algorithm
- Buffers small outgoing segments and coalesces them into larger ones
- Reduces the number of tiny packets (chattiness)
- **Tradeoff:** Increases latency for interactive apps
- **Disable with:** `TCP_NODELAY` socket option — essential for databases, game servers, real-time systems

### Delayed ACKs
- Receiver waits up to 200ms before sending an ACK, hoping to piggyback it on a data segment
- Reduces ACK traffic
- **Tradeoff:** Interacts badly with Nagle's algorithm → up to 200ms unnecessary delays
- **Disable with:** `TCP_QUICKACK` where latency matters

### TCP Keep-Alive
- Probes idle connections periodically to detect broken peers
- Configured via: `tcp_keepalive_time`, `tcp_keepalive_intvl`, `tcp_keepalive_probes`
- Critical for long-lived connections (database pools, WebSocket servers)
- Application-level heartbeats are more reliable and tunable

---

## TCP vs UDP

| Dimension | TCP | UDP |
|---|---|---|
| **Connection** | Connection-oriented (handshake required) | Connectionless |
| **Reliability** | Guaranteed delivery, retransmission | No guarantee; fire and forget |
| **Ordering** | In-order delivery | No ordering |
| **Flow Control** | Yes (receive window) | No |
| **Congestion Control** | Yes (slow start, CUBIC, BBR) | No |
| **Overhead** | 20-byte header + handshake cost | 8-byte header, no setup |
| **Latency** | Higher (handshake + retransmits) | Lower |
| **Throughput** | Lower under loss/congestion | Can be higher (no backoff) |
| **Use Case** | HTTP, databases, file transfer, email | DNS, video streaming, gaming, VoIP |

> **Key Insight:** UDP is not "unreliable TCP" — it's a different primitive. Higher-level protocols (QUIC, WebRTC, custom game protocols) build selective reliability on top of UDP when TCP's guarantees are too coarse or expensive.

---

## Trade-offs

### Advantages
- **Reliability without application logic** — applications don't need to implement retransmission, ordering, or deduplication
- **Universally supported** — every OS, firewall, and middleware understands TCP
- **Mature tooling** — deep observability (tcpdump, Wireshark, netstat, ss)
- **Multiplexing via ports** — thousands of concurrent connections on one host

### Disadvantages

#### 1. Head-of-Line Blocking (HoL Blocking)
- A lost segment stalls all subsequent segments in the stream until retransmission succeeds
- In HTTP/2 multiplexing multiple logical streams over one TCP connection, a single lost packet blocks all streams simultaneously
- **Root cause** of why HTTP/3 moved to QUIC (UDP-based)

#### 2. Connection Overhead
- Every new connection costs 1.5 RTT (handshake) + optional TLS handshake (+1-2 RTT)
- High connection churn is expensive — mitigated by connection pooling and keep-alive

#### 3. Congestion Control Conservatism
- TCP backs off aggressively under packet loss
- In lossy environments (mobile, Wi-Fi), packet loss ≠ congestion — TCP misinterprets loss and throttles unnecessarily
- BBR partially addresses this by estimating bottleneck bandwidth directly

#### 4. TIME_WAIT Port Exhaustion
- Servers handling massive connection churn can run out of ephemeral ports (default range: 32768–60999)
- Each connection occupies a port in TIME_WAIT for 60–120 seconds
- **Mitigations:** `SO_REUSEADDR`, `tcp_tw_reuse`, increasing ephemeral port range, connection pooling

#### 5. Ordered Delivery Can Hurt
- Even when application doesn't need strict ordering, TCP enforces it
- Wastes bandwidth waiting for retransmits when out-of-order data could be used

#### 6. Latency on First Request (Cold Start)
- Slow start limits initial throughput — TCP can't immediately use all available bandwidth
- Critical for short-lived connections (e.g., loading a small API response on a fresh TCP connection)

---

## Real-World Applications

### HTTP/1.1 — Classic TCP Use
- One TCP connection per request (originally) → massive handshake overhead
- **Keep-Alive** introduced persistent connections; pipelining added but rarely used due to HoL blocking
- Modern browsers open 6 TCP connections per origin as a parallelism workaround

### HTTP/2 — TCP Multiplexing
- Multiple streams over a single TCP connection — reduces handshake overhead
- **Problem:** HoL blocking at TCP level still applies — a single packet loss stalls all streams
- Used heavily by gRPC (which rides HTTP/2)

### HTTP/3 / QUIC — Escaping TCP
- Google designed QUIC on UDP to eliminate TCP's HoL blocking
- Each stream is independently reliable — a lost packet only blocks its own stream
- Built-in TLS 1.3, 0-RTT reconnection, connection migration
- **Lesson:** TCP's guarantees were the right level of abstraction until they weren't

### Database Connections
- **PostgreSQL, MySQL, Redis**: All communicate over TCP
- TCP's reliability means query responses are never silently dropped
- **Connection pooling** (PgBouncer, ProxySQL) is essential — amortizes the handshake cost across many queries
- Keep-alive probes detect dead connections before applications hit them

### Kafka
- Producers/consumers communicate with brokers over TCP
- TCP's ordering guarantee aligns with Kafka's partition-level ordering semantics
- Long-lived persistent connections — Nagle's algorithm disabled for low-latency

### WebSocket
- Starts as HTTP (TCP), upgrades to full-duplex TCP stream
- Used by Discord, Slack, trading platforms for real-time bidirectional communication
- TCP keep-alive supplemented with application-level heartbeats (ping/pong frames)

### Load Balancers
| Layer | How TCP Plays a Role |
|---|---|
| **L4 (TCP) LB** | Operates on TCP connections directly; forwards raw byte streams; no content inspection |
| **L7 (HTTP) LB** | Terminates TCP, inspects HTTP, opens new TCP connection to backend; can do SSL offload, routing |

### CDNs (Cloudflare, Akamai, Fastly)
- **TCP connection termination at PoP** — user connects to a nearby edge node, dramatically reducing RTT
- Long-lived, optimized TCP connections from edge to origin (TCP pre-warming)
- BBR adopted at CDN edges to maximize throughput on diverse network conditions

---

## TCP in System Design

### Connection Pooling
Every system interacting with a TCP-based service (databases, caches, internal APIs) should use connection pools.

```
Without pooling: Each request = 1.5 RTT (TCP) + 1-2 RTT (TLS) + query time
With pooling:    Each request = query time only (connection already established)
```

**Pool sizing heuristics:**
- Start with: `pool_size = (core_count * 2) + effective_spindle_count`
- For databases: rarely beneficial beyond 10–20 connections per app instance
- Monitor: connection wait time, idle connections, pool exhaustion events

### Timeouts — The Three Critical Timeouts
| Timeout Type | What It Guards | Typical Value |
|---|---|---|
| **Connect timeout** | Time to complete TCP handshake | 1–5 seconds |
| **Read timeout** | Time waiting for first byte after request sent | 5–30 seconds |
| **Idle/Keep-alive timeout** | Max idle time before closing connection | 60–300 seconds |

Always set all three. Missing a timeout leads to threads/goroutines hanging indefinitely under partial failures.

### TCP Tuning for High-Throughput Servers
```
# Increase socket backlog (accept queue)
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535

# Expand ephemeral port range
net.ipv4.ip_local_port_range = 1024 65535

# Reuse TIME_WAIT sockets for new connections
net.ipv4.tcp_tw_reuse = 1

# Increase receive/send buffer sizes for high-bandwidth links
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728

# Enable BBR congestion control
net.ipv4.tcp_congestion_control = bbr
```

### Half-Open Connections & SYN Floods
- **SYN flood attack:** Attacker sends many SYN packets without completing the handshake → exhausts server's SYN backlog
- **Mitigation:** SYN cookies — server encodes state in the SYN-ACK; no memory allocated until handshake completes
- Enable with: `net.ipv4.tcp_syncookies = 1`

---

## Performance Tuning

### Reducing Latency
| Technique | Effect |
|---|---|
| `TCP_NODELAY` | Disables Nagle's; immediate transmission of small packets |
| `TCP_QUICKACK` | Disables delayed ACKs; immediate acknowledgement |
| Keep-alive / connection reuse | Eliminates repeated handshake overhead |
| HTTP/2 or QUIC | Multiplexing; reduces number of connections needed |
| Co-locate services | Reduce RTT; minimize impact of handshake cost |

### Maximizing Throughput
| Technique | Effect |
|---|---|
| Increase socket buffer sizes | Larger window = more data in flight = better throughput on high-latency links |
| BBR congestion control | Better bandwidth utilization than CUBIC, especially over lossy networks |
| TCP segmentation offload (TSO) | Offloads segmentation to NIC; reduces CPU overhead |
| Jumbo frames (MTU 9000) | Fewer packets for same data; reduces per-packet overhead in data centers |

### Bandwidth-Delay Product (BDP)
```
BDP = Bandwidth × RTT

Example: 1 Gbps link, 100ms RTT
BDP = 1,000,000,000 bps × 0.1s = 100,000,000 bits = 12.5 MB

The socket buffer must be at least 12.5 MB to keep the pipe full.
Default Linux buffer: ~87 KB — massively underutilized on long-fat networks.
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Opening new TCP connection per request** | 1.5 RTT overhead per request; latency compounds | Connection pooling, keep-alive |
| **No timeouts set** | Hung threads on partial failures; resource exhaustion | Always set connect/read/idle timeouts |
| **Ignoring TIME_WAIT accumulation** | Port exhaustion under high connection churn | `tcp_tw_reuse`, connection pooling, review architecture |
| **Using TCP for real-time media** | Retransmits cause playback stalls; UDP/QUIC better | Switch to WebRTC, RTP over UDP |
| **Nagle's algorithm on interactive protocols** | 200ms latency spikes on small writes | Set `TCP_NODELAY` |
| **Relying on OS keep-alive alone** | Default `tcp_keepalive_time` = 2 hours; silent failures undetected | Application-level heartbeats |
| **Ignoring slow start on short connections** | Initial bandwidth severely throttled | Keep connections warm; tune initial congestion window (`initcwnd`) |
| **Blocking accept loop** | New connections queue up; high latency under load | Use non-blocking I/O (epoll/kqueue), async accept loops |

---

## Decision Framework

### When to Use TCP
- You need **guaranteed, ordered delivery** (financial transactions, file transfer, configuration sync)
- You're building on top of a protocol that **requires TCP** (HTTP, gRPC, SQL databases, Redis)
- **Correctness > latency** — you can tolerate retransmit delays
- The network is **reliable and low-loss** (data center, private WAN)
- You need **flow and congestion control** for large data transfers

### When to Consider UDP / QUIC Instead
- **Latency is critical** and occasional loss is acceptable (gaming, VoIP, live video)
- You need **stream independence** — HoL blocking from TCP would harm multiple parallel streams
- You're building a **custom protocol** where TCP's ordering semantics don't match your needs
- **Connection migration** is needed (mobile clients switching networks) — QUIC handles this natively
- You want **0-RTT reconnection** — QUIC with session resumption

### Protocol Selection Guide
```
Need reliable, ordered delivery?
  Yes → TCP (or QUIC for modern apps)
    Need HoL blocking avoidance?
      Yes → QUIC (HTTP/3, custom protocols)
      No → TCP
  No → Need any delivery guarantee?
    Yes → Build on UDP (selective reliability — WebRTC, QUIC, custom)
    No → Raw UDP (DNS, simple query/response, telemetry)
```

---

## Monitoring Metrics

| Metric | Tool | What It Tells You |
|---|---|---|
| **Retransmission rate** | `netstat -s`, `ss`, `tcpdump` | Packet loss / network quality |
| **RTT** | `ping`, `ss --info`, APM tools | Network latency |
| **Connection establishment time** | APM, tracing | Handshake overhead; cold-start cost |
| **TIME_WAIT count** | `ss -s` | Connection churn; potential port exhaustion |
| **SYN backlog drops** | `netstat -s | grep "SYNs to LISTEN"` | Accept queue overflow; server overload |
| **TCP receive/send buffer usage** | `/proc/net/sockstat` | Buffer saturation; throughput bottlenecks |
| **Connections per state** | `ss -tan | awk '{print $1}' | sort | uniq -c` | ESTABLISHED, TIME_WAIT, CLOSE_WAIT counts |
| **Congestion window size** | `ss -ti` | How aggressively TCP is sending |
| **Bandwidth utilization** | `iperf3`, `nethogs` | Link saturation |
| **CLOSE_WAIT accumulation** | `ss -tan` | Application not closing sockets (resource leak) |

### Key Alerts to Set
- Retransmission rate > 1% → investigate network quality
- TIME_WAIT count approaching port range limit → connection churn problem
- SYN backlog drops > 0 → server accept queue saturated; scale or tune
- CLOSE_WAIT count growing → application socket leak; code bug

---

## Summary

TCP is the backbone transport protocol for nearly every critical system — databases, caches, message brokers, HTTP, gRPC. Its reliability, ordering, and flow/congestion control guarantees eliminate entire classes of bugs from application code. The cost is latency (handshake, retransmits, slow start) and head-of-line blocking.

In system design:
- **Always use connection pooling** with TCP-based services
- **Always set timeouts** on every TCP interaction
- **Know when TCP is the wrong tool** — real-time media, highly mobile clients, and latency-critical multiplexed streams are where QUIC/UDP shine
- **Tune the OS TCP stack** for your workload — defaults are conservative and often wrong at scale
- **Monitor retransmission rates and TIME_WAIT accumulation** as leading indicators of network and capacity problems