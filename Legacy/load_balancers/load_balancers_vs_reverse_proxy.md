# Load Balancer vs Reverse Proxy

---

## Definitions

### Load Balancer (LB)
A Load Balancer sits between clients and a **pool of servers**, distributing incoming traffic across multiple backend instances. Its primary purpose is **horizontal scalability and high availability**.

### Reverse Proxy
A Reverse Proxy sits in front of **one or more servers**, intercepting client requests on their behalf. Its primary purpose is **abstraction, security, and request processing** — not necessarily traffic distribution.

> **Key insight:** Every Load Balancer is a Reverse Proxy, but not every Reverse Proxy is a Load Balancer.

---

## Core Responsibilities

| Concern                     | Load Balancer       | Reverse Proxy       |
|-----------------------------|---------------------|---------------------|
| Primary Goal                | Traffic distribution | Request mediation   |
| Requires multiple backends? | Yes (by design)     | No (can be 1)       |
| Health checking             | ✅ Core feature     | ✅ Optional          |
| SSL Termination             | ✅ Yes              | ✅ Yes               |
| Caching                     | ❌ Rarely           | ✅ Yes               |
| Compression (gzip)          | ❌ Rarely           | ✅ Yes               |
| Auth / Rate Limiting        | ❌ Rarely           | ✅ Yes               |
| Anonymizes backend          | ✅ Yes              | ✅ Yes               |

---

## Load Balancing Algorithms

### Static Algorithms
- **Round Robin** — Requests are distributed sequentially. Simple; ignores server load.
- **Weighted Round Robin** — Servers with higher capacity get proportionally more traffic.
- **IP Hash** — Client IP is hashed to always route to the same server (sticky sessions).

### Dynamic Algorithms
- **Least Connections** — Routes to the server with the fewest active connections. Good for long-lived connections (WebSockets, DB).
- **Least Response Time** — Routes to the server with the lowest latency + fewest connections.
- **Resource-Based** — Agent on each server reports CPU/memory; LB routes accordingly.

---

## Reverse Proxy Capabilities (Beyond LB)

1. **SSL/TLS Termination** — Decrypt HTTPS at the proxy; communicate with backends over plain HTTP. Offloads crypto work from app servers.
2. **Caching** — Serve static or cacheable responses directly (e.g., Varnish, Nginx `proxy_cache`).
3. **Request/Response Transformation** — Modify headers, rewrite URLs, inject auth tokens.
4. **Rate Limiting & Throttling** — Protect backends from abuse (e.g., 100 req/s per IP).
5. **Authentication Gateway** — Centralize auth (OAuth, JWT validation) before traffic hits app servers.
6. **Compression** — Gzip/Brotli responses before sending to client.
7. **Web Application Firewall (WAF)** — Inspect and block malicious payloads (SQLi, XSS).
8. **A/B Testing / Canary Routing** — Route % of traffic to a new version.

---

## Layer of Operation

| Type                    | OSI Layer | Sees                            |
|-------------------------|-----------|---------------------------------|
| L4 Load Balancer        | Layer 4   | IP + TCP/UDP only               |
| L7 Load Balancer        | Layer 7   | HTTP headers, URL, cookies, body|
| Reverse Proxy           | Layer 7   | Full HTTP context               |

- **L4 LB** is faster (no HTTP parsing), but can't do content-based routing.
- **L7 LB / Reverse Proxy** enables path-based routing, host-based routing, and header inspection.

---

## Trade-offs

### Load Balancer

| ✅ Pros | ❌ Cons |
|--------|--------|
| Enables horizontal scaling | Single point of failure if not HA |
| Improves fault tolerance (health checks) | Adds network hop (latency) |
| Distributes load evenly | State management is hard (sessions) |
| Can handle millions of connections (L4) | Session stickiness can cause imbalance |
| Transparent to clients | Cost of running LB infrastructure |

### Reverse Proxy

| ✅ Pros | ❌ Cons |
|--------|--------|
| Hides backend topology (security) | Additional infrastructure complexity |
| SSL termination centralizes cert management | Can become a bottleneck |
| Enables caching, reducing backend load | Cache invalidation is non-trivial |
| Centralizes cross-cutting concerns (auth, logging) | Potential single point of failure |
| Easy canary deploys and traffic splitting | Misconfiguration can break all traffic |

---

## When to Use Which

### Use a Load Balancer when:
- You have **multiple instances** of a service and need to spread traffic.
- You need **high availability** — traffic should survive individual server failure.
- You're horizontally scaling stateless services (APIs, web servers).

### Use a Reverse Proxy when:
- You want to **hide your backend servers** from the public internet.
- You need **SSL termination**, caching, or compression at the edge.
- You need a **unified entry point** that can enforce auth, rate limits, or WAF rules.
- You're running **microservices** and need a gateway to route to different services.

### Use Both (common in production):
```
Client → [CDN] → [Reverse Proxy / API Gateway] → [Load Balancer] → [App Servers]
```

---

## Real-World Systems & Applications

### Nginx
- Acts as both a **reverse proxy** and a **software load balancer**.
- Used by: Dropbox, Netflix, WordPress.com.
- Typical role: SSL termination, static file serving, upstream proxying.

### HAProxy
- High-performance **L4/L7 load balancer**.
- Used by: GitHub, Reddit, Stack Overflow.
- Known for low latency and high connection throughput.

### AWS Application Load Balancer (ALB)
- **L7 load balancer** with host/path-based routing.
- Used for routing to microservices based on URL prefix (e.g., `/api` → service A, `/images` → service B).
- Integrates with AWS WAF for security.

### AWS Network Load Balancer (NLB)
- **L4 load balancer** for extreme throughput and ultra-low latency.
- Used for TCP/UDP workloads (game servers, real-time systems).

### Cloudflare
- Global **reverse proxy** at the edge (CDN + DDoS protection + WAF).
- All traffic passes through Cloudflare before hitting origin servers.
- Provides caching, bot mitigation, and SSL termination globally.

### Netflix (Zuul + Eureka)
- Zuul acts as an **API Gateway / Reverse Proxy** — handles routing, auth, rate limiting.
- Eureka handles **service discovery** for the internal load balancing.
- Client-side load balancing via **Ribbon** inside the JVM.

### Google (Maglev)
- Google's custom **L4 software load balancer**.
- Handles billions of packets per second across Google's frontend infrastructure.
- Designed for consistent hashing across a large, changing pool of backends.

### Kubernetes (Ingress + kube-proxy)
- **Ingress Controller** (e.g., Nginx Ingress) acts as a reverse proxy — L7 routing inside the cluster.
- **kube-proxy** does L4 load balancing across pod replicas using iptables/IPVS.

---

## Session Persistence (Sticky Sessions)

A common challenge when using Load Balancers with stateful applications.

- **Problem:** If a user's cart lives in memory on Server A, routing them to Server B loses the cart.
- **Solutions:**
  1. **Sticky Sessions (Cookie-based)** — LB pins a client to one server via a cookie. Risk: uneven load.
  2. **Externalize State** — Store sessions in Redis/Memcached. Any server can handle any request. ✅ Recommended.
  3. **JWT / Token-based** — State lives in a signed token on the client. No server-side session needed.

---

## Health Checks

Both LBs and reverse proxies need to know when a backend is unhealthy.

| Type             | How it works                                        |
|------------------|-----------------------------------------------------|
| **TCP check**    | Can I open a TCP connection to port 8080?           |
| **HTTP check**   | Does `GET /health` return HTTP 200?                 |
| **Custom check** | Does `/health` return `{"db": "ok", "cache": "ok"}`?|

- **Active checks** — LB probes backends on a schedule.
- **Passive checks** — LB monitors real traffic; marks backend down after N consecutive failures.

---

## Summary

```
Reverse Proxy  =  Security + Abstraction + Request Processing
Load Balancer  =  Distribution + Scalability + High Availability

In production: they are often the same component (Nginx, HAProxy, ALB)
               serving both roles simultaneously.
```