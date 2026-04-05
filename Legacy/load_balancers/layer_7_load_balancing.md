# Layer 7 Load Balancing

> **OSI Layer:** Application Layer | **Protocol Awareness:** HTTP, HTTPS, WebSocket, gRPC, etc.

---

## What Is It?

Layer 7 (L7) load balancing operates at the **application layer** of the OSI model. Unlike Layer 4 load balancers that route based on IP/TCP/UDP headers alone, L7 load balancers can **inspect the full content of requests** — including HTTP headers, URLs, cookies, query parameters, and request bodies — to make intelligent routing decisions.

---

## How It Works

```
Client
  │
  ▼
[L7 Load Balancer]  ← terminates TLS, reads HTTP headers/body
  │         │         │
  ▼         ▼         ▼
Service A  Service B  Service C
(images)   (auth)     (api)
```

1. Client sends a request (e.g., `GET /api/users`)
2. L7 LB **terminates** the TLS/TCP connection
3. LB **inspects** the request (URL path, headers, cookies, etc.)
4. LB **routes** to the appropriate upstream based on rules
5. LB **opens a new connection** to the upstream server
6. Response flows back through the LB to the client

---

## Core Capabilities

### Routing Strategies
| Strategy | Description | Use Case |
|---|---|---|
| **Path-based** | Route on URL path (`/api/*` → Service A) | Microservices with different URL namespaces |
| **Host-based** | Route on `Host` header (`api.example.com` vs `app.example.com`) | Multi-tenant or multi-domain setups |
| **Header-based** | Route on custom headers (`X-User-Type: premium`) | A/B testing, feature flags |
| **Cookie-based** | Route on cookie values | Sticky sessions, canary releases |
| **Method-based** | Route on HTTP method (GET vs POST) | Read/write splitting |
| **Query-param-based** | Route on query parameters | Version routing (`?version=2`) |
| **Body-based** | Inspect request body content | GraphQL operation routing |

### Load Balancing Algorithms
- **Round Robin** — Requests distributed sequentially across upstreams
- **Least Connections** — Route to upstream with fewest active connections
- **Weighted Round Robin** — Assign more traffic to higher-capacity servers
- **IP Hash** — Same client IP always hits same server (soft sticky)
- **Random with Two Choices (P2C)** — Pick 2 servers randomly, send to the less loaded one
- **Resource-Based** — Route based on upstream CPU/memory metrics

### Additional Features
- **SSL/TLS Termination** — Decrypt at the LB; upstreams communicate over plain HTTP
- **Health Checks** — Active HTTP probes (`GET /health`) to upstream servers
- **Request/Response Rewriting** — Modify headers, paths, or bodies in-flight
- **Rate Limiting** — Throttle requests per client IP, token, or API key
- **Authentication Offloading** — JWT/OAuth validation before forwarding
- **Compression & Caching** — Gzip responses, cache static content at the LB
- **Circuit Breaking** — Stop sending traffic to a failing upstream
- **Retries** — Automatically retry idempotent requests on failure
- **Observability** — Rich access logs, per-route metrics, distributed tracing injection

---

## Trade-offs

### ✅ Advantages

| Advantage | Detail |
|---|---|
| **Content-aware routing** | Can direct traffic based on any part of the HTTP request |
| **Microservice-friendly** | One entry point routes to dozens of services by path/host |
| **Improved observability** | Full request context means detailed logs and metrics |
| **Security offloading** | WAF, auth, and TLS handled centrally, not per-service |
| **Blue/Green & Canary deploys** | Weight-based traffic splitting at the LB level |
| **Sticky sessions** | Cookie-based affinity without needing client-side changes |

### ❌ Disadvantages

| Disadvantage | Detail |
|---|---|
| **Higher latency** | TLS termination + packet inspection adds ~1–5ms per request |
| **Higher CPU cost** | Parsing HTTP/2 frames and headers is more expensive than TCP passthrough |
| **Complexity** | More configuration surface area; misconfiguration risk is higher |
| **Single point of failure** | Must be run in HA (active-active or active-passive) clusters |
| **Not protocol-agnostic** | Less effective for raw TCP/UDP, IoT, or binary protocols without explicit support |
| **Horizontal scaling harder** | Stateful features (sticky sessions, circuit breakers) complicate scale-out |

### L7 vs L4 Load Balancing

| Dimension | L4 (Transport Layer) | L7 (Application Layer) |
|---|---|---|
| Routing basis | IP, Port, TCP flags | URL, headers, cookies, body |
| TLS handling | Passthrough (no termination) | Terminates TLS |
| Protocol awareness | TCP/UDP only | HTTP, HTTP/2, gRPC, WebSocket |
| Throughput | Very high (line-rate possible) | Lower (inspection overhead) |
| Latency | Minimal | Low-moderate |
| Use case | Raw performance, non-HTTP | Web apps, APIs, microservices |
| Example tools | HAProxy (TCP mode), AWS NLB | NGINX, Envoy, AWS ALB |

> **Rule of thumb:** Use L4 for maximum throughput on non-HTTP or latency-critical systems. Use L7 whenever you need content-based routing, SSL termination, or rich observability.

---

## Key Design Considerations

### 1. TLS Termination vs. TLS Passthrough vs. Re-encryption
- **Terminate at LB:** Simple, fast, but traffic inside the cluster is unencrypted
- **Re-encrypt (TLS bridging):** LB decrypts and re-encrypts; secures internal traffic at CPU cost
- **Passthrough (L4):** LB never sees plaintext; lose L7 capabilities entirely

### 2. Session Persistence (Sticky Sessions)
- Use **cookie-based stickiness** (LB injects a cookie) — more reliable than IP hash
- Sticky sessions hurt fault tolerance: if an upstream dies, that session is lost
- Prefer **stateless services** and **external session stores** (Redis) over stickiness

### 3. Health Checks
- **Passive:** Observe failures in live traffic (circuit breaker style)
- **Active:** Periodic HTTP probe to a dedicated `/health` or `/ready` endpoint
- Design `/health` to check **dependencies** (DB connectivity, cache), not just "is the process up"
- Separate **liveness** (restart if failing) from **readiness** (remove from LB if failing)

### 4. High Availability
- Run LB in **active-active** clusters with shared state (sessions, rate limit counters)
- Use **Anycast IP + BGP** for global LBs to route clients to nearest cluster
- Avoid storing request state in the LB process itself

### 5. Observability
- Emit per-request logs: method, path, status, upstream, latency, bytes
- Expose per-route metrics: request rate, error rate, p50/p95/p99 latency
- Inject trace context (`traceparent` header) for distributed tracing

### 6. Capacity Planning
- L7 LBs are CPU-bound on TLS and HTTP parsing, not network-bound
- Benchmark with realistic traffic mix (HTTP/1.1 vs HTTP/2, payload sizes)
- Consider **connection pooling** to upstreams to reduce TCP handshake overhead

---

## Common Patterns

### Path-Based Routing (API Gateway Pattern)
```
/api/users/*   →  user-service
/api/orders/*  →  order-service
/api/products/*→  product-service
/static/*      →  CDN / object store
```

### Canary Deployment
```
90% of traffic  →  v1 (stable)
10% of traffic  →  v2 (canary)
```
Gradually increase v2 weight while monitoring error rates.

### Blue/Green Deployment
```
Phase 1:  100% → Blue (v1)
Phase 2:  100% → Green (v2)   [instant cutover]
Rollback: 100% → Blue (v1)    [instant rollback]
```

### A/B Testing
```
Header: X-Experiment: true  →  variant-service
(all other traffic)          →  control-service
```

### Authentication Offloading
```
Client → LB (validates JWT) → Upstream (trusted, no auth logic)
                ↓
         401 if invalid
```

---

## Real-World Systems & Applications

### 1. **AWS Application Load Balancer (ALB)**
- AWS's managed L7 LB for HTTP/HTTPS/gRPC/WebSocket traffic
- Supports path-based and host-based routing rules
- Native integration with AWS WAF, ACM (TLS), Cognito (auth)
- Used by virtually every large-scale AWS-hosted web application

### 2. **NGINX**
- Widely used as both a reverse proxy and L7 LB
- Powers a large fraction of the internet's web traffic
- Used by Dropbox, Netflix (for some edge routing), and GitHub
- Supports Lua scripting (`ngx_lua`) for custom routing logic

### 3. **Envoy Proxy**
- Cloud-native L7 proxy written in C++; the data plane of Istio service mesh
- Used by Lyft (created it), Google, Apple, Airbnb
- Supports HTTP/1.1, HTTP/2, gRPC, thrift; xDS API for dynamic config
- Built-in circuit breaking, retries, rate limiting, distributed tracing

### 4. **HAProxy**
- High-performance open-source L4/L7 LB
- Used by GitHub, Reddit, Stack Overflow, Tumblr
- Famous for its ACL-based routing and very low memory footprint
- GitHub uses HAProxy as their front-end load balancer at massive scale

### 5. **Cloudflare Load Balancing**
- Global Anycast network; routes based on health, latency, geography
- Integrates with Cloudflare Workers for custom routing logic at the edge
- Used to load balance across multi-cloud and hybrid environments

### 6. **Google Cloud Load Balancing (GCLB)**
- Google's global L7 LB using Google's own network (not traditional DNS round-robin)
- Single global Anycast IP; traffic steered to nearest healthy backend
- Underpins Google Search, YouTube, and Gmail at planet scale
- Used externally by Spotify, PayPal, and thousands of GCP customers

### 7. **Netflix Zuul**
- Netflix's edge gateway (L7) built on JVM
- Handles auth, routing, rate limiting, A/B testing for Netflix's API traffic
- Routes to hundreds of backend microservices
- Open-sourced; basis for many API gateway implementations

### 8. **Kubernetes Ingress / Gateway API**
- Kubernetes Ingress controllers (NGINX, Traefik, Contour) are L7 LBs
- Route external HTTP traffic to in-cluster services by host/path rules
- Gateway API (successor to Ingress) provides richer L7 routing primitives
- Used in virtually every production Kubernetes deployment

---

## Summary

| When to use L7 LB | When to avoid L7 LB |
|---|---|
| Routing to microservices by URL | Raw TCP/binary protocol traffic |
| TLS termination needed | Ultra-low-latency requirements (HFT, gaming) |
| A/B testing or canary deploys | When L4 throughput is sufficient |
| Auth/WAF offloading | Very simple single-service deployments |
| Rich observability needed | Encrypted end-to-end required (passthrough only) |

---