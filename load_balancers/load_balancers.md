# Load Balancers

> A Load Balancer distributes incoming network traffic across multiple backend servers to ensure no single server bears too much load — improving availability, reliability, and scalability.

---

## Core Concepts

- **Client** sends a request to the Load Balancer (LB), not directly to a server.
- The LB selects a backend server based on a **routing algorithm**.
- The backend server processes the request and returns the response (sometimes via the LB, sometimes directly).
- LBs can operate at different **OSI layers**: Layer 4 (Transport) or Layer 7 (Application).

---

## Types of Load Balancers

### Layer 4 (Transport Layer)
- Routes based on **IP address and TCP/UDP port**.
- Does not inspect packet contents.
- **Fast and low-overhead** — no deep packet inspection.
- Cannot make routing decisions based on content (e.g., URLs, cookies).

### Layer 7 (Application Layer)
- Routes based on **HTTP headers, URLs, cookies, request content**.
- Can do **content-based routing** (e.g., `/api` → API servers, `/static` → CDN).
- More expensive computationally, but far more flexible.
- Supports SSL termination, A/B testing, authentication offloading.

### Hardware vs. Software Load Balancers
| | Hardware | Software |
|---|---|---|
| Examples | F5 BIG-IP, Citrix ADC | NGINX, HAProxy, AWS ALB |
| Cost | Very high | Low / pay-as-you-go |
| Flexibility | Limited | Highly configurable |
| Scalability | Fixed capacity | Horizontally scalable |
| Use case | Legacy enterprise | Modern cloud-native |

---

## Load Balancing Algorithms

### Stateless Algorithms
| Algorithm | How it Works | Best For |
|---|---|---|
| **Round Robin** | Requests distributed sequentially to each server | Servers with equal capacity |
| **Weighted Round Robin** | Servers with higher weight get more requests | Heterogeneous server fleets |
| **Random** | Random server selection | Simple, equal-capacity setups |
| **Least Connections** | Routes to server with fewest active connections | Long-lived connections (WebSockets) |
| **Weighted Least Connections** | Combines weight + fewest connections | Mixed capacity + long connections |
| **IP Hash** | Hashes client IP to pick server | Soft session stickiness |

### Stateful Algorithms
| Algorithm | How it Works | Best For |
|---|---|---|
| **Sticky Sessions (Session Affinity)** | Same client always routes to same server | Stateful apps without shared session stores |
| **Resource-based** | Routes based on server CPU/memory metrics | Dynamic, resource-intensive workloads |

---

## High Availability of Load Balancers

A Load Balancer itself is a **single point of failure (SPOF)** if not made redundant.

### Active-Passive
- One LB handles traffic; a standby LB takes over if the primary fails.
- Failover via **floating/virtual IP** (e.g., using VRRP protocol).
- Simple, but the passive node is idle.

### Active-Active
- Multiple LBs handle traffic simultaneously.
- DNS load balancing or Anycast routing distributes traffic between them.
- Better resource utilization, more complex to manage.

---

## Health Checks

Load Balancers continuously probe backend servers to detect failures.

- **Passive health checks** — LB detects errors from live traffic (e.g., connection refused, HTTP 5xx).
- **Active health checks** — LB sends periodic probe requests (e.g., `GET /health`) and removes unhealthy servers from the pool.

**Key parameters:**
- `interval` — How often to probe (e.g., every 10s)
- `timeout` — How long to wait for a response
- `healthy_threshold` — Consecutive successes before marking healthy
- `unhealthy_threshold` — Consecutive failures before marking unhealthy

---

## SSL/TLS Termination

The LB can decrypt HTTPS traffic and forward plain HTTP to backend servers.

**Benefits:**
- Offloads CPU-intensive crypto from app servers.
- Simplifies certificate management (one place).
- LB can inspect and route based on HTTP content.

**Consideration:**
- Traffic between LB and backends is unencrypted — mitigate with a private network / VPC or re-encrypt (SSL passthrough or re-termination).

---

## Session Persistence (Sticky Sessions)

Ensures requests from the same client always reach the same server.

**Methods:**
- **Cookie-based** — LB injects a cookie identifying the target server.
- **IP Hash** — Consistent hashing on client IP.

**Problem:** Can cause **uneven load distribution** if some users have long sessions.

**Better alternative:** Use a **shared session store** (e.g., Redis, Memcached) so any server can handle any request — making the app truly stateless.

---

## Trade-offs

| Consideration | Trade-off |
|---|---|
| **Layer 4 vs Layer 7** | L4 is faster/simpler but can't do content routing; L7 is flexible but adds latency and cost |
| **Sticky Sessions** | Improves stateful app compatibility but causes uneven load and complicates failover |
| **Horizontal Scaling** | More servers reduce load per node but add LB complexity and network hops |
| **SSL Termination at LB** | Simplifies cert management but exposes unencrypted traffic on internal network |
| **Active-Active HA** | Higher throughput and resilience, but harder to configure and synchronize |
| **Centralized LB** | Single entry point is easy to manage but can become a bottleneck |
| **Global LB (GeoDNS/Anycast)** | Improves latency globally but adds DNS propagation delay and complexity |
| **Health Check Sensitivity** | Aggressive checks catch failures fast but can cause flapping; lenient checks are stable but slow to react |

---

## Global vs. Local Load Balancing

### Local Load Balancing
- Distributes traffic within a **single data center or region**.
- Examples: NGINX, HAProxy, AWS ALB.

### Global Load Balancing (GSLB)
- Distributes traffic **across multiple regions or data centers**.
- Uses **GeoDNS** — resolves domain to nearest/healthiest data center.
- Uses **Anycast** — multiple servers share the same IP; routing sends to nearest.
- Considers: latency, server health, capacity, regulatory requirements.
- Examples: AWS Route 53, Cloudflare, Google Cloud Load Balancing.

---

## Load Balancer vs. Reverse Proxy vs. API Gateway

| Component | Primary Role |
|---|---|
| **Load Balancer** | Distribute traffic across servers for scalability & availability |
| **Reverse Proxy** | Sits in front of servers; handles SSL, caching, compression, security |
| **API Gateway** | Entry point for APIs; handles auth, rate limiting, routing, transformation |

> In practice, modern tools like NGINX and AWS ALB blur these boundaries — a single component often does all three.

---

## Real-World Systems & Applications

### 1. Netflix
- Uses **AWS Elastic Load Balancing (ELB)** for regional traffic distribution.
- Employs **Zuul** (their open-source API gateway/LB) for dynamic routing, canary deployments, and A/B testing.
- Traffic is globally distributed via **AWS Route 53** (GeoDNS) to the nearest region.

### 2. Google
- Uses **Maglev** — a large-scale software load balancer built on commodity hardware.
- Maglev uses **consistent hashing** to assign connections to backend servers.
- Achieves line-rate packet processing without per-flow state on the LB itself.

### 3. GitHub
- Uses **HAProxy** as a Layer 7 load balancer.
- Leverages **Anycast** for global traffic distribution.
- Health checks automatically remove unhealthy app servers from rotation.

### 4. Cloudflare
- Uses **Anycast routing** globally — all data centers share the same IPs.
- Requests are routed to the nearest data center by BGP routing.
- Provides DDoS protection, SSL termination, and load balancing as a combined service.

### 5. Amazon (AWS)
- **Classic Load Balancer (CLB)** — Legacy L4/L7 balancer.
- **Application Load Balancer (ALB)** — L7; supports path-based and host-based routing, WebSockets, HTTP/2.
- **Network Load Balancer (NLB)** — L4; ultra-high performance, handles millions of requests/sec, static IP support.
- **Global Accelerator** — Global L4 LB using AWS's private backbone network.

### 6. Uber
- Uses **NGINX** and **Envoy** as edge and service-mesh proxies.
- **Envoy** handles service-to-service (east-west) load balancing within their microservices architecture.
- Dynamic routing policies allow instant traffic shifts during incidents.

---

## Common Patterns

### Blue-Green Deployment
- Two identical environments (Blue = live, Green = new version).
- LB shifts 100% of traffic from Blue to Green after testing.
- Instant rollback by pointing LB back to Blue.

### Canary Releases
- LB routes a small percentage of traffic (e.g., 5%) to the new version.
- Monitor for errors before gradually increasing the percentage.
- Weighted routing rules in the LB enable this.

### Service Mesh (East-West Load Balancing)
- LB isn't just at the edge — **Envoy / Istio** load-balance traffic *between* microservices.
- Handles retries, circuit breaking, and observability at the service level.

---

## Key Metrics to Monitor

| Metric | Why It Matters |
|---|---|
| **Request Rate (RPS)** | Understand traffic volume and capacity planning |
| **Active Connections** | Detect connection pool exhaustion |
| **Backend Response Time (P50/P95/P99)** | Identify slow servers |
| **Error Rate (4xx / 5xx)** | Detect backend failures |
| **Healthy Backend Count** | Alert if too many servers are removed from the pool |
| **LB CPU / Memory** | Ensure the LB itself is not a bottleneck |
| **SSL Handshake Time** | Monitor TLS termination overhead |

---

## Summary

```
Client
  │
  ▼
┌──────────────────┐
│   Load Balancer  │  ← Health Checks, SSL Termination, Routing Algorithm
└──────────────────┘
  │         │        │
  ▼         ▼        ▼
Server1  Server2  Server3   ← Backend Pool
```

- Load balancers are **foundational** to any scalable, highly available system.
- Choose **L4** for raw throughput; choose **L7** for smart routing and observability.
- Always make the LB itself **highly available** (Active-Active or Active-Passive).
- Prefer **stateless backends + shared session stores** over sticky sessions.
- At scale, combine **local LBs** with **global load balancing** (GeoDNS / Anycast).