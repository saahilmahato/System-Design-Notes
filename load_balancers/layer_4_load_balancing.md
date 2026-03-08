# Layer 4 Load Balancing

## What Is It?

Layer 4 Load Balancing operates at the **Transport Layer** of the OSI model. It distributes incoming network traffic across backend servers based on **TCP/UDP connection-level information** — primarily IP addresses and port numbers — without inspecting the actual content of the packets.

The load balancer acts as a **reverse proxy** at the network/transport level: it sees a connection request, picks a backend server, and forwards the raw TCP/UDP stream to it.

---

## How It Works

1. Client initiates a TCP connection to the load balancer's Virtual IP (VIP).
2. The load balancer inspects the **source IP, destination IP, source port, and destination port** (the 4-tuple).
3. It selects a backend server using a routing algorithm.
4. It **forwards the connection** (via NAT or TCP proxy) to the chosen backend.
5. All subsequent packets in that connection go to the **same backend** (connection persistence).

> The load balancer does **not** read HTTP headers, cookies, or message bodies. It only sees transport-layer metadata.

---

## Key Concepts

### Connection Table (State Table)
- L4 LBs maintain a mapping of `{client IP:port} → {backend IP:port}`.
- Every packet in a flow is routed to the same backend using this table.
- State must be synchronized in HA (high-availability) setups.

### NAT vs. TCP Proxy Mode
| Mode | Description |
|---|---|
| **NAT (DNAT)** | Rewrites the destination IP/port on packets. Fast, low overhead. |
| **Full TCP Proxy** | Terminates the TCP connection and opens a new one to the backend. Allows connection pooling. |

### Health Checking
- Performed at TCP level: can the LB **open a connection** to the backend?
- Does **not** validate application-level health (HTTP 200, DB query success, etc.).

---

## Load Balancing Algorithms

| Algorithm | Description | Best For |
|---|---|---|
| **Round Robin** | Distribute connections in sequence | Homogeneous servers, uniform requests |
| **Least Connections** | Route to server with fewest active connections | Variable-length connections |
| **IP Hash** | Hash source IP to pick backend | Session stickiness without cookies |
| **Weighted Round Robin** | Assign more traffic to higher-capacity servers | Heterogeneous server pools |
| **Random** | Pick a random backend | Simple, stateless scenarios |

---

## Trade-offs

### Advantages

- **High Performance & Low Latency** — No packet inspection beyond the 4-tuple. Extremely fast forwarding, capable of millions of connections per second.
- **Protocol Agnostic** — Works with any TCP/UDP-based protocol: HTTP, HTTPS, SMTP, DNS, custom protocols.
- **Low Resource Usage** — Minimal CPU and memory overhead compared to L7 load balancing.
- **Simple to Configure** — No SSL termination, no content parsing.
- **Transparent to Application** — The backend sees the connection just as any other TCP stream.

### Disadvantages

- **No Content-Aware Routing** — Cannot route based on URL path, HTTP headers, cookies, or request body.
- **No SSL Termination** — TLS must be terminated at the backend or at a separate layer (unless using L7 on top).
- **Coarse Health Checks** — Only verifies TCP connectivity, not application health. A backend could be up at TCP level but returning errors.
- **Sticky Sessions are Limited** — IP-based stickiness breaks behind NAT (many users share one IP). Cookie-based stickiness requires L7.
- **No Observability into Traffic** — Cannot log HTTP status codes, request paths, or latency at the request level.
- **DDoS Amplification Risk** — Without content inspection, malformed or abusive application-layer traffic passes through.

---

## L4 vs. L7 Load Balancing

| Dimension | L4 Load Balancer | L7 Load Balancer |
|---|---|---|
| OSI Layer | Transport (4) | Application (7) |
| Routing Basis | IP + Port | URL, headers, cookies, body |
| SSL Termination | No (typically) | Yes |
| Performance | Higher | Lower (more processing) |
| Complexity | Low | High |
| Health Checks | TCP-level | HTTP/gRPC/custom |
| Protocol Awareness | None | HTTP, gRPC, WebSocket, etc. |
| Use Case | Raw throughput, non-HTTP | Smart routing, microservices |

> Many modern systems **stack both**: L4 for ingress traffic distribution, L7 for application-level routing.

---

## Architecture Patterns

### Single-Tier L4 Only
```
Client → [L4 LB] → Backend Servers
```
Simple, fast. Used for databases, game servers, raw TCP services.

### L4 + L7 Stacked
```
Client → [L4 LB] → [L7 LB Pool] → Backend Services
```
L4 handles scale and HA; L7 handles intelligent routing. Common in large cloud deployments.

### ECMP (Equal-Cost Multi-Path) with L4
```
Client → [Router with ECMP] → [Multiple L4 LBs] → Backends
```
Used at massive scale (hyperscalers) to distribute across LB instances themselves.

### Direct Server Return (DSR)
- Client packets go through the LB, but **responses go directly from backend to client**.
- Eliminates LB as a bottleneck on the return path.
- Requires backends to have the VIP configured on a loopback interface.

---

## Real-World Systems & Applications

### 1. Google Maglev
- Google's in-house L4 load balancer, described in their 2016 paper.
- Uses consistent hashing to distribute flows across a cluster of Maglev nodes.
- Each node maintains a local connection table; consistent hashing ensures that even if a node fails, connections can be quickly re-routed.
- Processes millions of packets per second per machine using kernel bypass (DPDK-style).

### 2. AWS Network Load Balancer (NLB)
- AWS's managed L4 LB offering.
- Handles millions of requests per second with ultra-low latency (~100µs).
- Supports static IPs and Elastic IPs — useful for whitelisting in firewalls.
- Used for TCP/UDP workloads: databases, game servers, IoT, VoIP.

### 3. HAProxy (TCP Mode)
- Open-source, battle-tested load balancer.
- Runs in TCP mode as a pure L4 LB, forwarding connections without HTTP inspection.
- Used by GitHub, Reddit, and Stack Overflow for high-throughput traffic routing.

### 4. Nginx (Stream Module)
- Nginx's `stream` module enables L4 load balancing for TCP/UDP.
- Commonly used to load balance MySQL, PostgreSQL, and Redis clusters.

### 5. Facebook Katran
- Open-source L4 LB developed by Meta, built using **eBPF/XDP**.
- Runs directly in the Linux kernel for near-hardware-speed packet forwarding.
- Uses consistent hashing to maintain flow affinity across a pool of L4 LB nodes.
- Powers Facebook's global infrastructure.

### 6. Cloudflare Unimog
- Cloudflare's L4 LB built on XDP.
- Handles traffic distribution across their global anycast network.
- Responsible for absorbing massive DDoS attacks at the transport layer.

### 7. Online Multiplayer Game Servers
- Games use UDP heavily for low-latency state sync.
- L4 LBs distribute UDP flows to game server instances without the session affinity issues that plague cookie-based L7 solutions.

---

## When to Use L4 Load Balancing

**Use L4 when:**
- You need maximum throughput and minimum latency.
- Your protocol is not HTTP (e.g., raw TCP, UDP, SMTP, DNS).
- You are load balancing databases, caches, or message brokers.
- You want a simple, protocol-agnostic solution.
- You are operating at hyperscale and L7 overhead is a bottleneck.

**Avoid L4 (prefer L7) when:**
- You need to route traffic based on URL path or hostname.
- You need SSL termination at the load balancer.
- You need fine-grained health checks (application-level).
- You need request-level metrics and observability.
- You are building microservices with diverse routing rules.

---

## Key Metrics to Monitor

| Metric | Why It Matters |
|---|---|
| **Active Connections** | Detect connection pool exhaustion |
| **New Connections/sec** | Measure traffic growth and capacity limits |
| **Bytes In/Out** | Bandwidth utilization |
| **Backend Health** | Number of healthy vs. unhealthy backends |
| **Connection Error Rate** | TCP RSTs, timeouts — signal backend failures |
| **Latency (TCP handshake time)** | Detect network or backend slowness |

---

## Summary

| Property | Value |
|---|---|
| OSI Layer | 4 (Transport) |
| Protocols | TCP, UDP |
| Routing Criteria | IP address, port number |
| SSL Termination | No |
| Performance | Very High |
| Complexity | Low |
| Best Use Case | High-throughput, non-HTTP, DB, game servers |