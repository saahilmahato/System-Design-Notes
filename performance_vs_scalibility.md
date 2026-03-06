# Performance vs Scalability

> **Core Distinction:**
> - **Performance** — How fast the system serves *a single user or request*.
> - **Scalability** — How well the system maintains performance *as load increases*.

A system can be fast but not scalable, or scalable but not fast. The goal is usually to achieve both — but under constraints, trade-offs must be made.

---

## 1. Definitions

### Performance
The efficiency of a system in processing a given workload at a specific point in time.

**Key Metrics:**
- **Latency** — Time to complete a single request (ms/s)
- **Throughput** — Number of requests processed per unit time (RPS / QPS)
- **Response Time** — Latency + Queue Wait Time
- **Error Rate** — % of requests that fail under load
- **P99 / P95 Latency** — Tail latency; worst-case experience for a percentile of users

### Scalability
The ability of a system to handle growing amounts of work by adding resources.

**Types of Scalability:**
| Type | Description | Example |
|---|---|---|
| **Vertical (Scale Up)** | Add more power to existing machines (CPU, RAM) | Upgrading DB server |
| **Horizontal (Scale Out)** | Add more machines to the pool | Adding more app servers |
| **Diagonal** | Combination of both | Cloud auto-scaling |

---

## 2. How They Relate

```
High Performance ≠ High Scalability

A system optimized for performance on 1 server may:
  - Use in-memory caching tied to a single node
  - Rely on local state
  - Use non-distributable data structures

...all of which break when you try to scale horizontally.
```

**The Scalability Formula (simplified):**
> If performance drops with N users, you have a scalability problem.
> If performance is poor even with 1 user, you have a performance problem.

---

## 3. Key Concepts

### Latency vs Throughput
- Optimizing for **low latency** (fast responses) can reduce **throughput** (total volume handled).
- Example: Synchronous processing is low-latency for a single request but poor for high-throughput batch systems.

### Amdahl's Law
> The speedup of a program from parallelism is limited by the sequential fraction of the task.

- Even with infinite machines, a 20% sequential workload caps max speedup at **5x**.
- Implication: Identify and minimize bottlenecks that can't be parallelized.

### Little's Law
```
L = λ × W

L = number of requests in the system
λ = average arrival rate
W = average time a request spends in the system
```
- To improve throughput (λ), reduce processing time (W) or accept more concurrent requests (L).

### The Scalability Wall
As systems scale, new bottlenecks emerge:
1. Single DB write node → replicas help reads, not writes
2. Network I/O saturation
3. Shared state / distributed locks
4. DNS / load balancer limits

---

## 4. Trade-offs

### Performance vs Scalability
| Concern | Performance-First | Scalability-First |
|---|---|---|
| **State** | Local in-memory state (fast) | Distributed/external state (slower) |
| **Caching** | Local cache (zero network hop) | Distributed cache (network overhead) |
| **Consistency** | Strong consistency | Eventual consistency for availability |
| **Complexity** | Simpler architecture | More moving parts |
| **Cost** | Optimize one big box | Pay for distributed infra |
| **Failure Domain** | Single point of failure risk | Isolated failures |

### Vertical vs Horizontal Scaling
| Factor | Vertical | Horizontal |
|---|---|---|
| **Cost** | Expensive at high end | Commodity hardware |
| **Complexity** | Simple (no distribution) | Requires load balancing, sharding |
| **Limits** | Hard hardware ceiling | Near-infinite (theoretically) |
| **Downtime** | Often requires restart | Rolling deploys possible |
| **Best For** | Databases (short term) | Stateless services |

### Caching Trade-offs
- **Improves performance** dramatically (memory >> disk)
- **Hurts scalability** if cache is node-local (cache misses on other nodes)
- **Solution:** Distributed caches (Redis, Memcached) — but add network latency

### Synchronous vs Asynchronous Processing
- **Sync:** Low latency, tight coupling, doesn't scale under burst load
- **Async (queues):** Higher latency, decoupled, scales well under burst

---

## 5. Common Bottlenecks

| Layer | Bottleneck | Fix |
|---|---|---|
| **CPU** | Compute-heavy tasks block threads | Async processing, worker pools |
| **Memory** | Insufficient RAM, GC pauses | Optimize data structures, tune GC |
| **Disk I/O** | Slow reads/writes | SSDs, caching, async I/O |
| **Network** | Bandwidth saturation, high RTT | CDN, compression, batching |
| **Database** | Single write node, N+1 queries | Sharding, read replicas, indexing |
| **Application** | Shared locks, thread contention | Lock-free structures, partitioning |

---

## 6. Scaling Strategies

### For Performance
- **Optimize algorithms and data structures** — O(log n) vs O(n)
- **Caching** — In-memory stores (Redis), CDN for static assets
- **Connection Pooling** — Reuse DB/HTTP connections
- **Async I/O & Non-blocking** — Node.js, async/await patterns
- **Profiling & Benchmarking** — Find actual bottlenecks before optimizing

### For Scalability
- **Stateless Services** — Store session in external store (Redis), not in-process
- **Horizontal Pod Autoscaling** — Kubernetes HPA based on CPU/RPS
- **Database Sharding** — Partition data across DB nodes by key range or hash
- **Read Replicas** — Offload read traffic from primary DB
- **Message Queues** — Decouple producers from consumers (Kafka, SQS)
- **Microservices** — Scale individual services independently
- **CDN** — Push static/cacheable content to edge

---

## 7. Real-World Systems & Applications

### Twitter / X — The Fan-Out Problem
- **Challenge:** A celebrity tweets → 100M followers need to see it.
- **Performance approach:** Pre-compute and push tweet to each follower's feed cache (fan-out on write) — fast reads.
- **Scalability problem:** For users with 100M followers, fan-out on write is catastrophically slow.
- **Solution:** Hybrid — fan-out on write for normal users, fan-out on read for celebrities. Balances both.

### Netflix — Streaming at Scale
- **Performance:** Uses adaptive bitrate streaming (ABR) — adjusts quality based on network speed in real-time.
- **Scalability:** Moved from monolith to microservices (700+). Each service scales independently.
- **CDN (Open Connect):** Deploys ISP-embedded appliances to cache popular content close to users — reduces latency AND origin server load.

### Amazon — Shopping Cart
- **Scalability over consistency:** Amazon's Dynamo paper introduced eventual consistency for the cart. Availability and scalability were prioritized — a slightly stale cart is acceptable; downtime is not.
- **Trade-off taken:** Users might briefly see an outdated cart, but the system stays up under any load.

### Google Search — Index Serving
- **Performance:** Index is held entirely in RAM across thousands of machines.
- **Scalability:** Queries are parallelized across shards (index is partitioned). Results are merged. Sub-100ms response at billions of queries/day.
- **Key insight:** Vertical limits of RAM forced horizontal sharding — scalability enabled performance.

### Uber — Geospatial Matching
- **Performance:** Uses in-memory geospatial indexes (H3, S2) for driver-rider matching in milliseconds.
- **Scalability:** City-level sharding — NYC matching is isolated from LA matching. Scales by geography.

### Stack Overflow — Vertical Scaling Done Right
- **Counterexample to "always scale out":** Runs on a surprisingly small number of servers (few dozen).
- **Strategy:** Aggressive caching, query optimization, and vertical scaling.
- **Lesson:** Sometimes performance optimization eliminates the need for premature horizontal scaling.

---

## 8. Design Principles Summary

```
1. Measure before optimizing — profile, then fix actual bottlenecks.
2. Design for statelessness early — it's hard to retrofit.
3. Async by default for non-user-facing work.
4. Cache at every layer — but track invalidation complexity.
5. Accept eventual consistency where strong consistency isn't required.
6. Scale-out favors commodity hardware and fault tolerance.
7. Vertical scaling is fast and simple — use it until it hurts.
8. Tail latency matters — P99 affects real users.
```

---

## 9. Interview Framework

When asked about Performance vs Scalability in a system design interview:

1. **Clarify the bottleneck** — Is the problem today's load or projected future load?
2. **State the trade-off explicitly** — "We can optimize for low latency with local caching, but this won't scale horizontally."
3. **Choose a strategy** — Justify based on read/write ratio, consistency needs, and traffic patterns.
4. **Mention monitoring** — SLOs, SLAs, alerting on P95/P99 latency and error rates.