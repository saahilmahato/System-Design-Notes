# Latency

**Definition:** Latency is the total time elapsed from when a request is initiated to when the response is fully received. It measures the **delay** experienced by a single unit of work moving through a system.

---

## Why Latency Matters

- Users abandon pages that take > 3 seconds to load.
- In high-frequency trading, **1 millisecond** of latency can mean millions in lost revenue.
- In real-time systems (games, video calls, robotics), high latency breaks the user experience entirely.
- Latency compounds — if 5 services each add 20ms, the end user sees 100ms minimum.

---

## Units of Measurement

| Unit | Value | Where Used |
|---|---|---|
| Second (s) | 1s | Human-scale operations |
| Millisecond (ms) | 10⁻³ s | Network round trips, API calls |
| Microsecond (µs) | 10⁻⁶ s | In-memory DB lookups, kernel operations |
| Nanosecond (ns) | 10⁻⁹ s | CPU cache access, hardware operations |
| Clock period | 1 / freq | Hardware / FPGA / HLS design |

---

## The Latency Numbers Every Engineer Must Know

Memorize these. They provide the mental model for every performance decision you'll ever make.

| Operation | Latency | Relative to L1 Cache |
|---|---|---|
| L1 cache reference | ~0.5 ns | 1x |
| Branch misprediction | ~5 ns | 10x |
| L2 cache reference | ~7 ns | 14x |
| L3 cache reference | ~20 ns | 40x |
| Mutex lock/unlock | ~25 ns | 50x |
| Main memory (RAM) access | ~100 ns | 200x |
| Compress 1KB (Snappy) | ~3 µs | 6,000x |
| Read 4KB from SSD | ~150 µs | 300,000x |
| Read 1MB sequentially from RAM | ~250 µs | 500,000x |
| Read 1MB sequentially from SSD | ~1 ms | 2,000,000x |
| Disk seek (HDD) | ~10 ms | 20,000,000x |
| Same datacenter round-trip | ~0.5 ms | 1,000,000x |
| TCP packet CA → Netherlands | ~150 ms | 300,000,000x |
| TCP packet CA → Australia | ~300 ms | 600,000,000x |

### Key Takeaways from These Numbers
- RAM is **100x faster** than SSD, which is **100x faster** than HDD.
- A network call to another datacenter costs more than **1,000,000 memory accesses**.
- Every time you go "further" from the CPU, latency increases by orders of magnitude.
- Minimizing I/O hops (network, disk) is almost always the highest-leverage optimization.

---

## Anatomy of a Request's Latency

A single request to a web service has latency built up from multiple phases:

```
Total Latency =
  DNS Resolution
  + TCP Handshake (or TLS Handshake)
  + Time in Load Balancer Queue
  + Network Transit (client → server)
  + Server Queuing Time
  + Application Processing Time
  + Database / Cache Query Time
  + Response Serialization
  + Network Transit (server → client)
```

Each layer adds latency. Optimizing total latency means identifying the **dominant term** in this sum and attacking it first.

---

## Types of Latency

### 1. Network Latency
- Time for data to physically travel between two points.
- Determined by: distance, speed of light, number of hops, routing efficiency.
- **Speed of light in fiber:** ~200,000 km/s (vs 300,000 km/s in vacuum).
- NY → London = ~5,500 km → minimum ~27ms one-way. Real RTT: ~70-80ms due to routing.
- More hops = more latency. Each router adds ~1-5ms of processing.

### 2. Processing / Compute Latency
- Time the CPU spends executing your code.
- Dominated by algorithm complexity, branch prediction, memory access patterns.
- Cache misses are catastrophically expensive — keep hot data in L1/L2 cache.
- Avoid unnecessary serialization/deserialization (JSON parsing is slow at scale).

### 3. Disk I/O Latency
- **HDD:** Mechanical seek (~10ms). Never use for latency-sensitive paths.
- **SSD (SATA):** ~100-200µs random read.
- **NVMe SSD:** ~20-100µs random read. Significant improvement.
- Sequential reads are always faster than random reads — batch your reads where possible.

### 4. Memory Latency
- RAM: ~100ns. Use it for hot data.
- Cache hierarchy (L1→L2→L3→RAM) represents a latency ladder.
- Cache-oblivious algorithms and data locality (e.g., structs-of-arrays vs arrays-of-structs) can make or break performance.

### 5. Queuing Latency
- The time a request spends waiting in a queue before being processed.
- Governed by **Little's Law:** `L = λW` (avg items in system = arrival rate × avg wait time).
- Queuing latency explodes as system approaches 100% utilization — keep utilization < 70-80%.

### 6. Coordination / Lock Latency
- Time threads spend waiting for locks, semaphores, or distributed locks.
- Highly concurrent systems with coarse-grained locking can serialize under load.
- Use lock-free data structures, optimistic locking, or MVCC (Multi-Version Concurrency Control) in databases.

### 7. Replication Latency (Distributed Systems)
- Time between a write being committed on the primary and becoming visible on replicas.
- Synchronous replication: adds latency to every write (waits for replica to acknowledge).
- Asynchronous replication: low write latency, but replicas may be stale (eventual consistency).

---

## Latency Percentiles — The Right Way to Measure

**Never use averages alone.** Averages hide the tail — and the tail is where real user pain lives.

| Percentile | Meaning |
|---|---|
| p50 (median) | Half of requests are faster than this |
| p95 | 95% of requests are faster than this |
| p99 | 99% of requests are faster than this |
| p99.9 | 99.9% of requests are faster (1 in 1000) |
| p99.99 | 1 in 10,000 requests exceeds this |

### Why Tail Latency (p99, p99.9) Is Critical

- At large scale, rare events become common. At 1M requests/day, p99.9 latency affects **1,000 users daily**.
- The **"fan-out" problem**: a single page load may trigger 100 parallel backend calls. The total latency = latency of the **slowest** call. Even p99 latency on each service becomes near-certain at the page level.
- SLOs (Service Level Objectives) should always be defined in terms of **percentile targets**, e.g.:
  - `p99 latency < 200ms`
  - `p99.9 latency < 1s`

### Latency Distribution Shape
- **Normal distributions** are rare in latency data.
- Latency is typically **right-skewed** (long tail to the right).
- Causes of tail latency: GC pauses, lock contention, noisy neighbors, cold caches, OS scheduling jitter.

---

## Causes of High Latency

### Network-Level
- **Long geographic distance** — fundamental speed-of-light constraint.
- **Too many hops** — each router/proxy/load balancer adds delay.
- **Network congestion** — TCP back-off, retransmits, buffer bloat.
- **Head-of-line blocking** — in HTTP/1.1, one slow request blocks the entire connection.
- **TLS overhead** — full handshake is 1-2 RTTs; session resumption mitigates this.

### Application-Level
- **N+1 query problem** — fetching a list of N items, then making 1 DB call per item. Should be 1 JOIN.
- **Synchronous blocking I/O** — thread blocked waiting for network/disk while it could serve other requests.
- **Chatty APIs** — making many small API calls instead of one batched call.
- **Cold starts** — serverless functions, JVM warmup, empty caches after deployment.
- **Inefficient serialization** — JSON is verbose and slow. Protobuf/MessagePack are 5-10x faster.

### Infrastructure-Level
- **Overloaded servers** — CPU at 100%, requests queue up.
- **GC pauses (JVM/Go)** — stop-the-world GC can freeze a service for 10s-100s of milliseconds.
- **Noisy neighbors** — sharing physical hardware with other tenants in cloud environments.
- **Slow DNS** — DNS lookup can add 10-100ms if not cached. Pre-resolve and cache DNS.

---

## Strategies to Reduce Latency

### 1. Caching
- Serve data from memory instead of recomputing or fetching from disk/network.
- **Levels of caching:**
  - CPU cache (L1/L2/L3) — managed by hardware
  - In-process cache (local HashMap, LRU cache in app)
  - Distributed cache (Redis, Memcached)
  - CDN cache (edge nodes for static/semi-static content)
  - Database query cache
- **Cache invalidation** is one of the two hard problems in CS — design your cache strategy carefully (TTL, write-through, write-behind, cache-aside).

### 2. Geographic Distribution (CDN / Edge)
- Place data and compute physically closer to users.
- CDNs (Cloudflare, Akamai, AWS CloudFront) cache content at **edge nodes** worldwide.
- Reduces latency for static assets from 150ms+ (cross-continent) to ~5-20ms (local PoP).
- For dynamic content, use **edge computing** (Cloudflare Workers, Lambda@Edge).

### 3. Connection Pooling
- Establishing a new TCP + TLS connection is expensive (~1-3 RTTs = 100-600ms intercontinentally).
- **Connection pools** reuse existing connections, eliminating handshake latency on every request.
- Critical for database connections (PgBouncer for PostgreSQL, HikariCP for Java).

### 4. Asynchronous I/O & Non-Blocking Architecture
- Instead of blocking a thread waiting for I/O, register a callback and free the thread.
- **Event-loop models** (Node.js, Nginx, Netty) handle thousands of connections on a single thread.
- Reduces queuing latency dramatically under high concurrency.

### 5. Protocol Optimization
- **HTTP/2:** Multiplexing (many requests on one connection), header compression, server push.
- **HTTP/3 / QUIC:** Built on UDP, eliminates TCP head-of-line blocking, faster handshake.
- **gRPC (Protobuf over HTTP/2):** Much lower serialization latency vs. JSON/REST.
- **WebSockets:** Persistent bidirectional connection for real-time systems (no request overhead per message).

### 6. Pre-computation & Pre-fetching
- Compute expensive results in advance and store them (e.g., ML model inference, report generation).
- Pre-fetch data you predict the user will need next (browser pre-fetch, read-ahead buffers).

### 7. Load Balancing
- Route requests to the **least loaded** server to avoid hot spots.
- Strategies: Round-robin, Least Connections, IP Hash, Weighted, Latency-based (Route 53, GSLB).
- Avoids one overloaded server causing high tail latency.

### 8. Avoiding the N+1 Problem
- Use JOINs or batch queries to fetch related data in one trip instead of N trips.
- Use DataLoader (GraphQL) or batch API patterns.

### 9. Data Locality & Index Optimization
- Database indexes reduce query latency from O(n) table scan to O(log n) B-tree lookup.
- Partition data so queries hit only the relevant shard/partition.
- Keep frequently accessed data together on disk (clustering).

---

## Latency in Distributed Systems

### The "Two Generals Problem" & Network Unreliability
- Networks are unreliable. Packets are delayed, lost, reordered.
- Retransmission adds latency non-deterministically — contributes to tail latency.
- **Timeouts** are essential but tricky: too short = false failures; too long = slow degradation.

### Service Mesh Latency
- In microservices, every service-to-service call adds latency.
- A single user request may traverse 5-10 services.
- Service meshes (Istio, Linkerd) add observability but also add ~1-5ms per hop.
- **Rule:** Minimize synchronous service-to-service calls on the critical path.

### Read-Your-Writes Consistency vs. Latency
- Strongly consistent reads require hitting the primary replica — higher latency.
- Eventually consistent reads from nearest replica — lower latency, possibly stale data.
- Design choice: what's your tolerance for stale reads?

---

## Latency SLOs — How to Set Them

| System Type | Typical Latency Target |
|---|---|
| Real-time games / voice | < 20ms |
| High-frequency trading | < 1ms (often microseconds) |
| Interactive web UI | p99 < 200ms |
| API (internal microservices) | p99 < 100ms |
| Batch processing | Minutes to hours (latency not primary concern) |
| Background jobs | No strict latency SLO |

---

## Quick Reference: Latency Reduction Checklist

- [ ] Are you caching hot data at the right layer?
- [ ] Are you using connection pooling for DB/HTTP connections?
- [ ] Are you measuring and alerting on **p99** latency, not just average?
- [ ] Are you making synchronous calls where async would suffice?
- [ ] Is there an N+1 query problem in your data fetching?
- [ ] Are you serving static assets from a CDN?
- [ ] Do you have timeouts and circuit breakers on all downstream calls?
- [ ] Are your database queries using indexes?
- [ ] Are GC pauses a significant contributor to tail latency?
- [ ] Is your serialization format efficient enough for your scale?