# Load Balancing Algorithms

> **System Design Topic** | Distributing incoming network traffic across multiple servers to ensure high availability, reliability, and performance.

---

## What is Load Balancing?

A load balancer sits between clients and a pool of backend servers. It intercepts incoming requests and routes each one to a specific server based on a chosen algorithm. The goal is to prevent any single server from becoming a bottleneck while maximizing throughput and minimizing response latency.

---

## Core Algorithms

### 1. Round Robin

**How it works:**
Requests are distributed sequentially across all available servers, cycling back to the first after reaching the last.

```
Request 1 → Server A
Request 2 → Server B
Request 3 → Server C
Request 4 → Server A  ← cycle repeats
```

**When to use:**
- All servers have identical hardware/capacity
- Requests are stateless and roughly equal in processing cost

**Trade-offs:**

| Pros | Cons |
|------|------|
| Simple to implement | Ignores server load/capacity |
| Even distribution by count | Expensive requests can overload one server |
| Low overhead | Not suitable for heterogeneous server pools |
| Predictable behavior | No session affinity |

**Variant — Weighted Round Robin:** Servers are assigned weights proportional to their capacity. A server with weight 3 receives 3x more requests than one with weight 1.

---

### 2. Least Connections

**How it works:**
Each new request is routed to the server with the fewest active connections at that moment.

```
Server A: 10 active connections
Server B:  3 active connections  ← next request goes here
Server C:  7 active connections
```

**When to use:**
- Long-lived connections (WebSockets, database connections)
- Requests vary significantly in processing time

**Trade-offs:**

| Pros | Cons |
|------|------|
| Adapts to real server load | Higher bookkeeping overhead |
| Better for long-lived connections | Doesn't account for server processing power |
| Handles uneven workloads well | Requires connection state tracking |
| Prevents hot spots | Can lag during sudden traffic spikes |

**Variant — Weighted Least Connections:** Divides active connections by server weight, routing to the server with the lowest ratio.

---

### 3. IP Hash (Sticky Sessions)

**How it works:**
A hash of the client's IP address determines which server handles the request. The same client always maps to the same server.

```
hash(client_ip) % num_servers = server_index
```

**When to use:**
- Stateful applications where session data is stored locally on servers
- Caching-heavy workloads (maximize cache hits per server)

**Trade-offs:**

| Pros | Cons |
|------|------|
| Session persistence without shared storage | Uneven distribution with few high-volume clients |
| Good cache locality | Adding/removing servers breaks existing mappings |
| No external session store needed | One heavy client can overload one server |

---

### 4. Random

**How it works:**
Each incoming request is sent to a randomly selected server.

**Trade-offs:**

| Pros | Cons |
|------|------|
| Trivial to implement | No awareness of server load |
| Near-even distribution at scale | Small samples can be highly uneven |
| No state to maintain | Not suitable for production at scale |

**Variant — Power of Two Random Choices (P2C):** Pick 2 servers at random, then route to the one with fewer connections. Gives near-optimal balance with very low overhead. Used in Envoy and modern service meshes.

---

### 5. Least Response Time

**How it works:**
Routes requests to the server with the lowest combination of active connections and response latency.

```
score = active_connections × avg_response_time
→ route to server with lowest score
```

**When to use:**
- Heterogeneous server pools
- Latency-sensitive applications (APIs, real-time services)

**Trade-offs:**

| Pros | Cons |
|------|------|
| Optimizes for user-perceived performance | Requires continuous latency monitoring |
| Self-adapts to slow nodes | Response time can fluctuate, causing instability |
| Best real-world latency outcomes | More complex to implement correctly |

---

### 6. Resource-Based (Adaptive)

**How it works:**
Servers periodically report their current resource utilization (CPU, memory, I/O). The load balancer routes to the server with the most available capacity.

**When to use:**
- CPU/memory-intensive workloads
- Heterogeneous or auto-scaling server pools

**Trade-offs:**

| Pros | Cons |
|------|------|
| Truly reflects server health | Requires agents/sidecars on each server |
| Works well with autoscaling | Reporting lag can lead to stale decisions |
| Prevents OOM and CPU saturation | High implementation complexity |

---

### 7. Consistent Hashing

**How it works:**
Servers and request keys (user ID, URL, etc.) are mapped onto a virtual ring. Each request is routed to the nearest server clockwise on the ring.

```
         [Server A]
        /            \
[Server C]        [Server B]
        \            /
         -----------
```

**When to use:**
- Distributed caches (minimize cache misses on server changes)
- Sharded databases
- Systems where servers are frequently added/removed

**Trade-offs:**

| Pros | Cons |
|------|------|
| Adding/removing servers only remaps ~1/N keys | More complex than simple hashing |
| Excellent cache locality | Requires virtual nodes to avoid hotspots |
| Scales horizontally with minimal disruption | Doesn't inherently balance by load |

---

## Comparison Matrix

| Algorithm | Complexity | State Required | Handles Heterogeneous Servers | Session Affinity | Best For |
|---|---|---|---|---|---|
| Round Robin | Low | No | No | No | Uniform, stateless traffic |
| Weighted Round Robin | Low | No | Yes | No | Mixed capacity, stateless |
| Least Connections | Medium | Yes | Partial | No | Long-lived connections |
| IP Hash | Low | No | No | Yes | Stateful / cached sessions |
| Least Response Time | High | Yes | Yes | No | Latency-sensitive APIs |
| Resource-Based | High | Yes | Yes | No | CPU/memory-heavy workloads |
| Consistent Hashing | Medium | No | No | Yes | Distributed caches, sharding |

---

## Key Design Considerations

### Health Checks
Any load balancing strategy requires active health checks. Two types:
- **Passive:** Monitor live traffic and detect errors/timeouts in flight.
- **Active:** Periodically send synthetic requests (ping, HTTP probe) to verify server health.

### Layer 4 vs Layer 7 Load Balancing
- **L4 (Transport Layer):** Operates on IP/TCP. Faster, cannot inspect content. Algorithms: Round Robin, IP Hash.
- **L7 (Application Layer):** Inspects HTTP headers, cookies, URLs. Enables content-based routing (e.g., `/api` → cluster A, `/static` → CDN). Higher overhead, far more flexible.

### Session Persistence
When session data lives on a server (not in a shared store like Redis), the load balancer must always send that user to the same server. This reduces fault tolerance — if the server dies, the session is lost. **Preferred solution:** Externalize session state to Redis or Memcached.

### Global vs Local Load Balancing
- **Local (within a data center):** Distributes traffic among servers in one region. Tools: HAProxy, Nginx.
- **Global (across data centers):** Uses DNS-based routing or Anycast to direct users to the nearest/healthiest region. Tools: AWS Route 53, Cloudflare.

---

## Real-World Systems & Applications

### Nginx
- Default: **Round Robin**
- Also supports: Weighted Round Robin, IP Hash, `least_conn`, `least_time`
- Used by Netflix, Dropbox, and WordPress.com as a reverse proxy and L7 load balancer

### HAProxy
- Default: **Round Robin**
- Supports all major algorithms including URI hashing
- Used by GitHub, Reddit, Stack Overflow
- The reference implementation for high-performance software load balancers

### AWS Elastic Load Balancing (ELB)
- **ALB (Application):** L7, routes by HTTP path/headers/host. Uses Least Outstanding Requests.
- **NLB (Network):** L4, uses flow hash (5-tuple IP+port). Ultra-low latency for TCP/UDP.
- **GLB (Gateway):** For network appliances such as firewalls and intrusion detection systems.

### Google Maglev
- A consistent hashing-based software load balancer built for Google-scale traffic.
- Assigns packets via a hash table replicated across all load balancer machines.
- Ensures consistent connection tracking even as the load balancer fleet scales.

### Envoy Proxy (Lyft, Airbnb, Google)
- Default: **Power of Two Random Choices (P2C)** with Least Requests
- Also supports: Round Robin, Weighted Round Robin, Ring Hash, Maglev
- Core data plane of Istio and most modern service meshes

### Cassandra / DynamoDB
- Use **Consistent Hashing** to distribute data partitions across nodes.
- Adding a node remaps only ~1/N of data — critical for online scaling without full reshuffling.

### Redis Cluster
- Divides the keyspace into **16,384 hash slots** across nodes.
- Each key maps to a slot via `CRC16(key) % 16384`.
- A variant of consistent hashing purpose-built for Redis's sharding model.

### Cloudflare / Fastly (CDN)
- Use **Anycast routing** at the network layer to send users to the nearest PoP.
- Within each PoP, use Least Connections with health-check-driven failover.

---

## Common Failure Modes & Mitigations

| Failure Mode | Cause | Mitigation |
|---|---|---|
| Thundering herd | All servers restart simultaneously | Jitter + exponential backoff on reconnects |
| Hot spots | One server gets disproportionate traffic | Consistent hashing with virtual nodes |
| Stale health state | Health check lag after server degrades | Passive checks + shorter active check intervals |
| Session loss on failure | Sticky sessions with local state | Externalize session state to Redis/Memcached |
| Overload cascade | Slow server passes health checks | Response-time checks + circuit breakers |

---

## Summary — When to Use What

| Scenario | Recommended Algorithm |
|---|---|
| Stateless, homogeneous services | Round Robin or Weighted Round Robin |
| Long-lived connections (DB, WebSocket) | Least Connections |
| Latency-critical APIs with mixed hardware | Least Response Time or P2C |
| Stateful apps without shared session store | IP Hash (prefer externalizing state) |
| Distributed caches and sharded data stores | Consistent Hashing |
| Dynamic cloud environments with autoscaling | Resource-Based / Adaptive |