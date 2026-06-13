# Throughput

**Definition:** Throughput is the number of operations, requests, or units of data a system can process in a given unit of time. It measures the **capacity** and **volume** a system can sustain — not the speed of any one request.

---

## Why Throughput Matters

- A system with low throughput becomes a **bottleneck** — no matter how fast individual requests are, the pipeline starves downstream.
- Black Friday traffic spikes expose systems with inadequate throughput.
- Data pipelines (Kafka, Spark) are entirely throughput-optimized — processing billions of events/day is the goal.
- Payment systems must sustain thousands of TPS (transactions per second) reliably.
- Throughput defines your system's **ceiling** — the maximum load it can absorb before degrading.

---

## Units of Measurement

| Unit | Common Context |
|---|---|
| **Requests/second (RPS)** | Web servers, APIs |
| **Transactions/second (TPS)** | Databases, payment systems |
| **Queries/second (QPS)** | Databases, search engines |
| **Bits/second (bps), Mbps, Gbps** | Network bandwidth |
| **Messages/second** | Message queues (Kafka, SQS) |
| **Jobs/hour** | Batch processing, ETL |
| **Words/clock period** | Hardware / FPGA / HLS design |
| **I/O operations/second (IOPS)** | Storage systems |

---

## The Manufacturing Analogy

A car factory takes **8 hours** to build one car but produces **120 cars/day**.
- **Latency** = 8 hours (time for one unit of work)
- **Throughput** = 120 cars/day = **5 cars/hour**

The key insight: even though each car takes 8 hours, many cars are being built **simultaneously** in parallel stages. **Pipelining and parallelism decouple latency from throughput.**

This is the fundamental trick behind all high-throughput system design.

---

## The Hardware Throughput Example (Know This for Interviews)

A communications device with:
- **Clock frequency:** 100 MHz
- **Time per computation:** 1000 ns
- **Data rate:** 640 Mbits/s
- **Output word width:** 64 bits

**Latency calculation:**
```
1000 ns × (100 × 10⁶ clocks/s) = 100 clock periods
```

**Throughput calculation:**
```
640 × 10⁶ bits/s
÷ 64 bits/word
÷ 100 × 10⁶ clocks/s
= 0.1 words/clock period
= 1 word every 10 clock periods
```

This is how hardware designers reason about throughput — **not in abstract terms, but in clock periods**. The same thinking applies to software: instead of clock periods, you think in **thread slots, queue capacity, and processing time per request**.

---

## Throughput vs. Bandwidth

These are often confused:

| Term | Meaning |
|---|---|
| **Bandwidth** | The **theoretical maximum** data a channel can carry (physical limit) |
| **Throughput** | The **actual** data successfully delivered in practice |

Throughput ≤ Bandwidth always. The gap is caused by protocol overhead, congestion, retransmits, and inefficiency.

**Example:** A 1 Gbps network link may only sustain 800 Mbps real throughput due to TCP headers, ACKs, and packet loss retransmits.

---

## What Limits Throughput

Throughput is always limited by the **slowest part of the system** — the bottleneck. Finding and eliminating the bottleneck is the entire discipline of performance engineering.

### Common Bottlenecks

| Bottleneck | Symptom | Common Fix |
|---|---|---|
| **CPU** | High CPU%, requests queueing | Scale horizontally, optimize algorithms |
| **Memory** | Swapping to disk, OOM kills | Add RAM, reduce memory footprint, tune GC |
| **Disk I/O** | High disk wait times | Move to SSD/NVMe, cache in memory, async I/O |
| **Network bandwidth** | Saturated NIC, high retransmit rate | Compression, larger instances, CDN offload |
| **Database** | Slow queries, connection exhaustion | Indexing, read replicas, sharding, connection pool |
| **Lock contention** | Threads waiting, low CPU but slow | Reduce lock scope, use lock-free structures, MVCC |
| **Single-threaded code** | One core at 100%, rest idle | Parallelize, async processing |
| **External API rate limits** | 429 errors, throttled responses | Caching, request batching, retry with backoff |

---

## Throughput Bottleneck Analysis: The Systematic Approach

Use **Universal Scalability Law (USL)** and **Amdahl's Law** to reason about limits.

### Amdahl's Law
If a fraction `P` of your system can be parallelized:
```
Speedup = 1 / ((1 - P) + P/N)
```
Where `N` = number of processors.

- If 90% is parallelizable, max speedup = 10x no matter how many machines you add.
- The serial (non-parallelizable) part becomes the ceiling.
- **Implication:** Eliminate serial bottlenecks before scaling out.

### Little's Law
```
L = λ × W
```
- `L` = average number of requests in the system (concurrency)
- `λ` = average arrival rate (throughput)
- `W` = average time each request spends in the system (latency)

**Rearranging:** `Throughput (λ) = Concurrency (L) / Latency (W)`

This is profoundly useful. To increase throughput, either:
1. **Increase concurrency** (more threads, more servers), or
2. **Decrease latency** (faster processing per request)

---

## Strategies to Increase Throughput

### 1. Horizontal Scaling (Scale Out)
- Add more servers/instances to distribute load.
- **Stateless services** scale perfectly horizontally — each request can go to any server.
- **Stateful services** require sticky sessions, shared storage, or distributed state management.
- Combined with a **load balancer** to distribute traffic evenly.
- Cost: slightly increased latency from load balancer overhead and potential cross-node communication.

### 2. Parallelism
- Run multiple units of work **simultaneously** rather than sequentially.
- **Thread-level parallelism:** Multiple threads handling requests concurrently (thread pools).
- **Process-level parallelism:** Multiple processes (Python multiprocessing to bypass GIL).
- **Data parallelism:** Same operation on different data chunks (map-reduce, GPU computing).
- **Pipeline parallelism:** Different stages of a pipeline run on different cores simultaneously.

### 3. Asynchronous Processing & Message Queues
- Decouple producers from consumers using a queue (Kafka, RabbitMQ, SQS, NATS).
- Producers write to queue and continue immediately — throughput is no longer limited by consumer speed.
- Consumers process at maximum sustainable rate.
- **Enables:** Absorbing traffic spikes (queue acts as buffer), independent scaling of producers/consumers.
- **Trade-off:** Higher end-to-end latency (request → queue → consume → respond).

**Key queue throughput numbers (approximate):**
| Queue | Max Throughput |
|---|---|
| RabbitMQ | ~50K-100K messages/s (single node) |
| Apache Kafka | ~1M+ messages/s (partitioned cluster) |
| AWS SQS | ~3,000 messages/s (standard), ~300 FIFO |
| Redis Pub/Sub | ~1M+ messages/s |

### 4. Batching
- Group multiple small requests into one larger request to amortize fixed overhead.
- **Examples:**
  - DB: INSERT 1000 rows in one statement vs. 1000 individual INSERTs.
  - Network: Send 100 events per HTTP call vs. 100 separate HTTP calls.
  - Kafka: Produce messages in batches to maximize throughput.
- **Trade-off:** Increases latency for individual items (must wait to fill batch). Classic throughput-latency trade-off.

### 5. Pipelining
- Start processing the next unit of work **before** the current one finishes.
- CPU instruction pipelines, HTTP pipelining, database prefetching.
- Analogous to the car assembly line — no one waits for one car to finish before starting another.
- **Result:** Increases throughput without necessarily increasing latency of the pipeline as a whole.

### 6. Partitioning / Sharding
- Split your data or work across multiple independent nodes.
- Each node owns a subset — queries/writes go only to the relevant shard.
- **Horizontal partitioning (sharding):** Split rows across nodes (e.g., user IDs 1-1M → shard 1, 1M-2M → shard 2).
- **Vertical partitioning:** Split columns across nodes (separate tables for hot vs. cold columns).
- Enables near-linear throughput scaling — each shard handles its own slice.
- **Challenge:** Cross-shard queries (JOINs) become expensive. Design shard keys carefully.

### 7. Compression
- Reduce the amount of data transferred over the network or stored on disk.
- Less data to transfer = more transfers possible in the same time = higher throughput.
- **Algorithms:** gzip (general), Snappy (speed-optimized), LZ4 (fastest), Zstandard (best ratio+speed), Brotli (web).
- **Trade-off:** CPU overhead for compression/decompression may reduce throughput if CPU is the bottleneck.
- Best for: network-bound systems (large payloads, slow connections), storage-heavy systems.

### 8. Caching (Throughput Perspective)
- Serving from cache is multiple orders of magnitude faster than DB/disk.
- Cache hit = request handled in µs instead of ms → same servers handle far more requests/second.
- Cache also reduces load on downstream systems (DB gets fewer queries → its throughput budget goes further).
- A well-tuned cache can increase effective system throughput by **10-100x**.

### 9. Read Replicas
- For read-heavy workloads, route reads to replica databases.
- Write throughput is still limited to the primary, but read throughput scales linearly with replicas.
- Common pattern: 1 primary + N read replicas behind a read load balancer.
- Used by: MySQL (RDS Read Replicas), PostgreSQL (streaming replication), MongoDB (secondary reads).

### 10. Connection Pooling
- Database connections are expensive to create (~5-10ms, significant memory).
- Without pooling, high request throughput → connection exhaustion → requests fail.
- **Pool** maintains a set of open connections reused across requests.
- **PgBouncer** (PostgreSQL), **HikariCP** (Java), **pgpool-II**, **SQLAlchemy pool** (Python).
- Can increase DB throughput 10x+ by eliminating connection setup overhead.

---

## Throughput in Real Systems — Benchmarks to Know

| System | Approximate Max Throughput |
|---|---|
| **Nginx (static files)** | ~100,000+ RPS (single server) |
| **Node.js (hello world)** | ~30,000-80,000 RPS |
| **PostgreSQL (simple queries)** | ~10,000-50,000 QPS |
| **MySQL (InnoDB)** | ~10,000-100,000 QPS |
| **Redis** | ~100,000-1,000,000 ops/s |
| **Kafka (single cluster)** | ~1,000,000 messages/s |
| **Cassandra (writes)** | ~100,000-500,000 ops/s |
| **Elasticsearch** | ~10,000-100,000 QPS |
| **S3 (per prefix)** | 3,500 PUT/s, 5,500 GET/s |

> Note: These are rough reference figures. Real throughput depends heavily on hardware, data size, query complexity, and configuration.

---

## Throughput Patterns in System Design

### The Funnel Pattern
```
Ingestion Layer     →    Processing Layer    →    Storage Layer
(High throughput)         (Medium throughput)       (Lower throughput)
e.g. Kafka                e.g. Spark Streaming      e.g. PostgreSQL
~1M events/s              ~100K events/s            ~50K writes/s
```
- Each layer should have higher throughput than the layer ahead of it.
- A slower downstream layer must buffer or back-pressure the upstream.

### Back-Pressure
- When a downstream system is overloaded, it signals upstream to slow down.
- Prevents cascading failures from buffer overflow.
- Reactive Streams / Project Reactor / Akka Streams implement back-pressure natively.
- Without back-pressure: queues grow unboundedly → OOM → service crash.

### The Thundering Herd Problem
- A large number of requests arrive simultaneously (e.g., cache expiry, deployment, flash sale).
- All hit backend simultaneously → overload → latency spike → timeouts → retry storm → worse.
- **Mitigations:**
  - **Jitter** in retry/cache expiry times.
  - **Request coalescing** — deduplicate in-flight requests for the same key.
  - **Rate limiting** at the ingestion layer.
  - **Gradual rollouts / ramp-up** for traffic shifting.

---

## Measuring Throughput Correctly

### Don't Rely on Single-Node Benchmarks
- Benchmark at the **system level** under realistic load.
- Use tools: `wrk`, `k6`, `locust`, `JMeter`, `vegeta`, `Apache Bench (ab)`.

### Sustained Throughput vs. Burst Throughput
- **Burst throughput:** Peak rate for a short period (buffers/queues absorb spikes).
- **Sustained throughput:** Rate maintainable indefinitely without degradation.
- **Always design for sustained throughput.** Burst headroom is a bonus.

### Measuring with the Right Percentile
- Report **p95/p99 throughput degradation** under load, not just steady-state.
- As load approaches saturation, throughput flattens and latency explodes — find that knee point.

---

## Throughput SLOs — How to Set Them

| System Type | Typical Throughput Requirement |
|---|---|
| Internal microservice | 1,000 – 10,000 RPS |
| E-commerce checkout | 1,000 – 50,000 TPS |
| Social media feed | 100,000+ RPS |
| Payment processing | 1,000 – 65,000 TPS |
| Event streaming (IoT/logs) | Millions of events/second |
| High-frequency trading | Microsecond-level, millions of orders/second |

---

## Quick Reference: Throughput Improvement Checklist

- [ ] Have you identified the current bottleneck (CPU, I/O, network, DB, locks)?
- [ ] Are you using connection pooling for DB and HTTP clients?
- [ ] Are you batching writes to the database instead of individual INSERTs?
- [ ] Are you using async/non-blocking I/O where possible?
- [ ] Have you added read replicas for read-heavy DB workloads?
- [ ] Are you using a message queue to decouple high-throughput producers from consumers?
- [ ] Are large payloads compressed in transit?
- [ ] Is caching reducing repetitive downstream load?
- [ ] Is your sharding strategy allowing linear write throughput scaling?
- [ ] Do you have back-pressure mechanisms to prevent cascade failures?
- [ ] Have you validated throughput under sustained load, not just burst?