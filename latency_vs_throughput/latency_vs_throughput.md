# Latency vs Throughput

**Core Principle:** Latency and throughput are related but distinct. Optimizing one often degrades the other. The goal is not to maximize both blindly — it is to **maximize throughput within an acceptable latency budget** defined by your SLOs.

---

## The Fundamental Relationship

| | **Latency** | **Throughput** |
|---|---|---|
| **Asks** | "How fast does one request complete?" | "How many requests can we handle per second?" |
| **Cares about** | A single unit of work | Total volume of work over time |
| **Metric type** | Delay (time) | Rate (volume/time) |
| **Measured at** | Per-request level | System level |
| **Analogy** | Time to manufacture one car | Cars manufactured per day |

---

## Why They Conflict

The root cause of the trade-off is **resource sharing and batching**.

- **Increasing throughput** typically means sharing resources across more requests simultaneously (more concurrency, batching, queueing), which introduces waiting — which increases latency.
- **Decreasing latency** typically means dedicating more resources to individual requests and processing them immediately, which reduces resource efficiency and caps throughput.

### The Conveyor Belt Mental Model

Imagine a conveyor belt at a factory:
- **Fast belt (low latency, low throughput):** Each item moves quickly end-to-end, but only one item fits on the belt at a time.
- **Slow belt with many items (high latency, high throughput):** Items take longer to reach the end, but many are being processed simultaneously.

The **optimal design** puts as many items as physically possible on the belt at a safe speed — maximizing throughput while keeping per-item latency acceptable.

---

## The Throughput-Latency Curve

As load increases on a system, throughput and latency behave differently:

```
Throughput
    ^
    |               __________ (saturation — throughput plateau)
    |          ____/
    |      ___/
    |   __/
    |  /
    | /
    |/
    +-------------------------------> Load (RPS)

Latency (p99)
    ^
    |                             /
    |                            /  (degradation zone)
    |                           /
    |                          /
    |_________________________/ (stable zone)
    |
    +-------------------------------> Load (RPS)
```

### Three Zones to Understand

| Zone | Behavior | What's Happening |
|---|---|---|
| **Stable (Underload)** | Latency flat, throughput grows linearly | Resources underutilized, requests served immediately |
| **Saturation (Knee Point)** | Latency starts rising, throughput flattens | Queues begin forming, contention begins |
| **Degradation (Overload)** | Latency spikes, throughput drops | Queues overflow, retries amplify load, cascading |

### Key Insight: The Knee Point
- The **knee point** is the most efficient operating zone — maximum throughput before latency degrades meaningfully.
- Designing for the knee point is the goal. Operating well past it causes disproportionate latency pain for marginal throughput gain.
- **Rule of thumb:** Keep utilization at ~60-70% of saturation capacity to maintain a safety buffer.

---

## The Fundamental Trade-Off Table

Every architectural decision shifts the balance between latency and throughput. Know these cold.

| Technique | Effect on Latency | Effect on Throughput | Why |
|---|---|---|---|
| **Add more servers** | ↑ Slight increase | ↑ Significant increase | Routing overhead added, but parallel capacity multiplied |
| **Caching hot data (Redis)** | ↓ Large decrease | ↑ Increase (less DB load) | Sub-millisecond reads instead of 10-100ms DB calls |
| **Batching requests** | ↑ Increase (wait for batch) | ↑ Large increase | Amortizes per-request overhead; more work per I/O call |
| **Message queue (Kafka/SQS)** | ↑ Large increase | ↑ Large increase | Async decoupling; producers no longer block on consumers |
| **Read replicas** | ↑ Slight increase (replication lag) | ↑ Large increase | Reads distributed across N nodes |
| **Connection pooling** | ↓ Decrease | ↑ Increase | Eliminates TCP/TLS handshake per request |
| **Compression** | ↑ Slight increase (CPU overhead) | ↑ Increase (for network-bound) | Less data transferred per request |
| **Synchronous replication** | ↑ Increase (wait for replica ACK) | ↓ Decrease (write throughput limited) | Safety vs. performance trade-off |
| **Async replication** | ↓ Decrease | ↑ Increase | Writes return before replica confirmed; risk of data loss |
| **Sharding** | ↓/↑ Depends | ↑ Large increase | Less contention per shard; cross-shard queries expensive |
| **Load balancing** | ↓ Decrease (avoids hot spots) | ↑ Increase | Distributes work evenly across capacity |
| **Thread pool increase** | ↓ Decrease (less queuing) | ↑ Increase (up to CPU limit) | More concurrent workers; context-switch overhead at extreme |
| **Larger batch sizes** | ↑ Higher | ↑ Higher | More items processed per I/O round-trip |
| **Smaller batch sizes** | ↓ Lower | ↓ Lower | Items don't wait as long; fewer items per round-trip |
| **Pre-computation** | ↓ Decrease | ↑ Increase | Shifts computation to off-critical-path time |
| **GC tuning (JVM)** | ↓ Decrease (less stop-the-world) | ↑ Increase | Reduces latency spikes from GC pauses |

---

## Designing for the Right Balance

### Step 1: Classify Your System

| System Type | Priority | Reasoning |
|---|---|---|
| **Real-time / interactive** (gaming, voice, HFT) | **Latency first** | User experience breaks above ~20-50ms |
| **Web APIs / user-facing services** | **Balance** | p99 latency SLO + throughput target |
| **Batch processing / ETL** | **Throughput first** | Processing 1TB of data; per-item latency irrelevant |
| **Event streaming** (IoT, logs, analytics) | **Throughput first** | Millions of events/second; slight lag acceptable |
| **Payment systems** | **Both critical** | High TPS required AND each transaction must be fast |
| **Search engines** | **Latency first** | User expects instant results; throughput scaled via replicas |
| **Recommendation engines** | **Throughput first at inference scale** | Serve millions of users; latency bounded by SLO |

### Step 2: Define SLOs Before Optimizing

Never optimize blindly. First establish:
- **Latency SLO:** e.g., "p99 < 200ms, p99.9 < 1s"
- **Throughput SLO:** e.g., "sustain 10,000 RPS at peak load"
- **Error budget:** How much degradation is acceptable?

The latency SLO defines the **constraint**. Maximize throughput within it.

### Step 3: Find Your Bottleneck

Use **Little's Law** to reason about the system:
```
Throughput = Concurrency / Latency
```
To double throughput, either double concurrency (more servers/threads) or halve latency (faster processing).

---

## Real-World System Deep Dives

### 1. Web Server (Nginx / Apache)

**Challenge:** Serve millions of users (high throughput) with fast page loads (low latency).

| Technique | Latency Impact | Throughput Impact |
|---|---|---|
| CDN for static assets | ↓↓ Large decrease | ↑ Offloads origin server |
| HTTP/2 multiplexing | ↓ Decrease (fewer connections) | ↑ More requests per connection |
| Gzip/Brotli compression | ↑ Tiny increase (CPU) | ↑ Less bandwidth = more requests fit |
| Load balancer (multiple app servers) | ↓ Avoids hot spots | ↑↑ Linear scaling |
| In-memory page cache | ↓↓ Serve from RAM | ↑ Much higher RPS |
| Keep-alive connections | ↓ Eliminates handshake | ↑ Reuse connection for multiple requests |

**Design outcome:** A well-designed web server handles 100K+ RPS with p99 < 100ms by combining all of the above.

---

### 2. Relational Database (PostgreSQL / MySQL)

**Challenge:** Fast individual queries (low latency) and high query volume (high throughput).

| Technique | Latency Impact | Throughput Impact |
|---|---|---|
| Read replicas | ↑ Slight (replication lag) | ↑↑ N× read throughput |
| Connection pooling (PgBouncer) | ↓ Eliminate connection setup | ↑ Handle more concurrent queries |
| Query indexes | ↓↓ O(log n) vs O(n) | ↑ More queries complete quickly |
| Write-ahead log batching | ↑ Slight increase | ↑ Group commits to disk |
| Query result caching (Redis) | ↓↓ Sub-ms response | ↑ Dramatically fewer DB queries |
| Vertical partitioning (hot/cold columns) | ↓ Smaller rows, faster scans | ↑ More rows fit per page |
| Sharding | ↓ Less contention per shard | ↑ Linear write scaling |
| MVCC (Multi-Version Concurrency) | ↓ Readers don't block writers | ↑ Higher concurrency |

**Design outcome:** A production-grade DB cluster uses read replicas + PgBouncer + carefully indexed schemas, serving 50K-100K QPS with p99 < 10ms.

---

### 3. Message Queue System (Apache Kafka)

**Design philosophy:** Deliberately sacrifices per-message latency in exchange for extreme throughput and durability.

| Property | Value |
|---|---|
| **Throughput** | ~1M+ messages/second (partitioned cluster) |
| **End-to-end latency** | 2ms – seconds (depending on config) |
| **Durability** | Messages persisted to disk, replicated |

**Key tuning knobs and their trade-offs:**

| Config | Setting | Latency | Throughput |
|---|---|---|---|
| `linger.ms` (producer) | High (e.g., 50ms) | ↑ Higher | ↑ Higher (larger batches) |
| `linger.ms` (producer) | Low (e.g., 0ms) | ↓ Lower | ↓ Lower (smaller batches) |
| `batch.size` | Large | ↑ Higher | ↑ Higher |
| `acks` | `all` (wait all replicas) | ↑ Higher | ↓ Lower |
| `acks` | `1` (only leader ACK) | ↓ Lower | ↑ Higher |
| `num.partitions` | More | ↓ Lower (parallelism) | ↑ Higher |
| `compression.type` | `lz4`/`snappy` | ↑ Slight (CPU) | ↑ Higher (network bound) |

**Kafka illustrates the core trade-off perfectly:** every config knob is a slider between latency and throughput.

---

### 4. Microservices Architecture

**Challenge:** Many services in a call chain. Latency compounds; throughput must be coordinated.

**Latency compounding problem:**
```
Service A (5ms) → Service B (10ms) → Service C (8ms) → DB (15ms)
Total serial latency = 38ms minimum
```

If any one service has p99 = 50ms, the entire chain's p99 ≥ 50ms.

**Throughput chokepoint problem:**
- The slowest service in a synchronous chain limits total throughput.
- If Service B handles only 500 RPS, the entire chain is capped at 500 RPS.

**Solutions:**

| Problem | Solution | Trade-off |
|---|---|---|
| High serial latency | Parallelize independent calls | More complex code |
| Downstream throughput cap | Async queue between services | Higher end-to-end latency |
| Cascading failures | Circuit breaker (Hystrix, Resilience4j) | May reject valid requests |
| Hot downstream service | Cache responses at the caller | Stale data risk |
| Cross-service fan-out latency | GraphQL with DataLoader (batch) | More complex API layer |

---

### 5. CDN (Content Delivery Network)

**The archetypal throughput + latency solution:**

- **Problem:** One origin server → high latency for global users + throughput limit.
- **Solution:** Replicate content to 100s of **edge nodes** globally.
  - Latency: User connects to nearest edge node (~5-20ms instead of ~150ms).
  - Throughput: Origin server only handles cache misses (1-5% of traffic), not 100%.
- **Trade-off:** Stale content (eventual consistency). TTL must be tuned per content type.

| Content Type | TTL Strategy | Why |
|---|---|---|
| Static assets (JS/CSS) | Long TTL (1 year) + cache-busting filename hash | Never changes for given filename |
| Images | Medium TTL (days-weeks) | Rarely updated |
| HTML pages | Short TTL (minutes) | May update frequently |
| API responses | Very short or no cache | Often user-specific or real-time |
| Video streams | Segment-level caching | Large files, high throughput demand |

---

### 6. High-Frequency Trading (HFT)

**The extreme latency-first case:**

- Throughput is secondary. Every microsecond matters.
- **Techniques used (and why):**

| Technique | Latency Gain | Throughput Impact |
|---|---|---|
| Kernel bypass (DPDK, RDMA) | ↓↓↓ Eliminates OS overhead | ↑ for that path |
| Co-location (server in exchange's datacenter) | ↓↓ Eliminates network distance | Neutral |
| FPGA-based execution | ↓↓↓ Sub-microsecond logic | Limited |
| Lock-free ring buffers | ↓ No mutex overhead | ↑ Higher |
| CPU pinning & NUMA awareness | ↓ Eliminates scheduling jitter | ↑ Slightly |
| Avoid garbage collection | ↓ No GC pauses | ↑ Consistent |
| Custom serialization (no JSON/XML) | ↓ Faster parsing | ↑ Higher |

**Result:** Latency measured in **nanoseconds to microseconds**. Throughput is orders of magnitude lower than a Kafka cluster, but latency is unmatched.

---

## Consistency, Availability, and Their Relationship to Latency/Throughput

The **CAP theorem** and **PACELC** model show that latency/throughput trade-offs extend to consistency:

### PACELC Model (more practical than CAP)

```
If Partition (P): trade off Availability (A) vs Consistency (C)
Else (E):         trade off Latency (L) vs Consistency (C)
```

| System | Partition Trade-off | Else Trade-off | Example |
|---|---|---|---|
| DynamoDB | Availability | Latency | Low latency, eventual consistency |
| Zookeeper | Consistency | Consistency | Strong consistency, higher latency |
| Cassandra | Availability | Latency | Tunable consistency |
| PostgreSQL (sync replication) | Consistency | Consistency | Strong, but higher write latency |

**Implication:** Choosing strong consistency almost always costs you latency and/or throughput. Eventual consistency buys you both.

---

## Anti-Patterns to Avoid

### 1. Optimizing Latency Without Considering Throughput
- Making each request faster without considering how many requests you need to serve.
- Result: Single request is blazing fast, but system falls over under real load.

### 2. Optimizing Throughput Without Latency SLOs
- Batching everything, making processes async, accepting queuing delays.
- Result: System processes millions of requests per second but each takes 10 seconds.
- Users are unhappy even though your metrics look good.

### 3. Using Averages Instead of Percentiles
- Average latency of 50ms sounds great. p99 of 5 seconds is catastrophic.
- Always instrument p95, p99, p99.9 in production.

### 4. Ignoring Queuing Theory
- Adding capacity (servers) without analyzing whether queuing latency is the real bottleneck.
- If your queue depth is growing, adding faster processors doesn't help if the arrival rate exceeds service rate.

### 5. Premature Optimization
- Spending weeks on low-level latency optimization when the real bottleneck is a missing database index.
- Always **profile first**. Identify the dominant latency/throughput bottleneck before optimizing.

---

## Summary

| Scenario | Optimize For | Approach |
|---|---|---|
| User-facing API (web/mobile) | Latency (p99) with throughput floor | Cache, CDN, connection pool, async I/O |
| Data pipeline / ETL | Throughput | Batch, partition, compress, parallelize |
| Real-time systems (games, voice) | Latency above all | In-memory, non-blocking, co-location |
| Event streaming (IoT, logs) | Throughput | Kafka, partitioning, large batches |
| Databases | Both, with explicit trade-offs | Read replicas, sharding, pooling, indexing |
| Microservices | Latency on critical path, throughput via async | Parallelize calls, queue non-critical work |

**The engineering discipline is not choosing latency OR throughput. It is setting explicit SLOs for both, finding the bottleneck, and making deliberate trade-offs in service of your system's actual goals.**