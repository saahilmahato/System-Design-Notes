# Latency vs Throughput

---

## Definitions

### Latency
The **time taken to complete a single operation** — from the moment a request is sent to the moment a response is received.

- Measured in: `ms`, `µs`, `ns`
- Perspective: **Per-request** experience
- Key question: *"How fast does one thing happen?"*

> **Examples:** Time to load a webpage, time to execute a database query, round-trip time (RTT) of a network packet.

---

### Throughput
The **number of operations a system can handle per unit of time**.

- Measured in: `requests/sec (RPS)`, `messages/sec`, `MB/s`, `transactions/sec (TPS)`
- Perspective: **System-wide** capacity
- Key question: *"How much can the system handle?"*

> **Examples:** Number of API requests a server handles per second, rows written to a database per second, bytes transferred over a network per second.

---

## The Relationship

Latency and throughput are related but **not the same**, and optimizing for one can negatively impact the other.

```
Throughput ≈ Concurrency / Latency        (Little's Law approximation)
```

| Scenario | Latency | Throughput |
|---|---|---|
| Single fast request, no parallelism | Low | Low |
| Batching requests together | Higher (per item) | High |
| Heavy caching | Low | High (ideal) |
| Overloaded system | High | Degraded |
| Pipeline parallelism | Low | High |

**High throughput does not guarantee low latency** — a system can process millions of messages/sec while individual messages wait in queues for seconds.

---

## Key Concepts

### Bandwidth vs Throughput
- **Bandwidth** is the *theoretical maximum* capacity of a channel.
- **Throughput** is the *actual achieved* data transfer rate (always ≤ bandwidth).

### Tail Latency (P99, P999)
- Average latency hides outliers. Systems should be measured at **percentiles**.
- `p50` = median, `p99` = 99th percentile, `p999` = 99.9th percentile.
- Tail latency matters most in user-facing systems where even 1% of slow requests affects real users.

### Latency Numbers to Know
| Operation | Approximate Latency |
|---|---|
| L1 cache reference | ~0.5 ns |
| L2 cache reference | ~7 ns |
| RAM access | ~100 ns |
| SSD random read | ~100 µs |
| HDD seek | ~10 ms |
| Same datacenter round trip | ~500 µs |
| Cross-region round trip | ~150 ms |

### Queuing & Utilization
- As system **utilization approaches 100%**, latency increases non-linearly (queuing theory).
- A system at 70% utilization handles spikes gracefully; at 95% it becomes fragile.

---

## Trade-offs

### 1. Batching → Higher Throughput, Higher Latency
Grouping multiple operations together amortizes overhead (network, I/O, CPU).
- **Gain:** Throughput increases significantly.
- **Cost:** Individual items wait until the batch is full — latency increases.
- **Example:** Kafka producers batch messages before flushing; database bulk inserts.

---

### 2. Caching → Lower Latency, Potential Staleness
Serving results from memory avoids expensive recomputation or I/O.
- **Gain:** Latency drops dramatically (RAM vs disk/network).
- **Cost:** Risk of stale data; cache invalidation complexity.
- **Example:** CDN edge caches, Redis for session data.

---

### 3. Parallelism / Concurrency → Higher Throughput, Resource Cost
Running multiple operations simultaneously increases overall system throughput.
- **Gain:** More work done per unit time.
- **Cost:** Increased memory, CPU, coordination overhead (locks, contention).
- **Example:** Multi-threaded web servers, parallel database query execution.

---

### 4. Synchronous vs Asynchronous Processing
- **Sync:** Low latency for the caller, lower throughput under load.
- **Async (queues):** Higher throughput, but caller waits longer for a result (or never gets one directly).
- **Example:** REST API (sync) vs event-driven architecture with Kafka (async).

---

### 5. Replication → Lower Read Latency, Write Overhead
Reading from geographically close replicas reduces latency for reads.
- **Gain:** Lower read latency, higher read throughput.
- **Cost:** Replication lag introduces potential inconsistency; writes must propagate.
- **Example:** Database read replicas, CDN replication.

---

### 6. Compression → Higher Throughput, Higher CPU Latency
Compressing data reduces bytes transferred, improving network throughput.
- **Gain:** Higher effective throughput on bandwidth-constrained links.
- **Cost:** CPU time added to compress/decompress — increases latency.
- **Example:** gzip/Brotli in HTTP, Snappy in Kafka, columnar compression in Parquet.

---

## Design Strategies

### To Minimize Latency
- Use in-memory data stores (Redis, Memcached)
- Place compute close to data (co-location, edge computing)
- Reduce network hops (service mesh, local caching)
- Use connection pooling to avoid handshake overhead
- Avoid synchronous blocking I/O (use async/non-blocking models)
- Optimize critical path — reduce p99 latency, not just average

### To Maximize Throughput
- Use batching and buffering
- Use async, non-blocking I/O (event loops, reactive systems)
- Horizontal scaling — add more workers/nodes
- Partition/shard data to parallelize processing
- Use efficient serialization formats (Protobuf, Avro over JSON)
- Pipeline stages to overlap computation and I/O

---

## Real-World Systems & Applications

### 1. Google Search
- **Priority: Ultra-low latency** (target <200ms end-to-end)
- Uses massive parallelism — fans out queries to hundreds of servers simultaneously, then merges results (scatter-gather pattern).
- Sacrifices some throughput efficiency to meet strict latency SLAs.

### 2. Apache Kafka
- **Priority: Very high throughput** (millions of messages/sec)
- Batches messages, uses sequential disk I/O, zero-copy transfer.
- Individual message latency is in the tens of milliseconds — acceptable for async pipelines.
- Used by LinkedIn, Uber, Netflix for event streaming.

### 3. Netflix CDN (Open Connect)
- **Priority: Both** — low latency for playback start, high throughput for video streaming.
- Caches video chunks at ISP-level edge nodes to reduce latency.
- Bulk pre-positions content during off-peak hours to maximize throughput without impacting playback latency.

### 4. High-Frequency Trading (HFT) Systems
- **Priority: Absolute minimum latency** (microseconds matter)
- Co-located servers in exchange data centers.
- Use kernel bypass networking (DPDK, RDMA), custom hardware (FPGAs).
- Throughput is secondary — a single trade executed at the right microsecond is the goal.

### 5. Amazon S3
- **Priority: High throughput** for large object transfers; reasonable latency for metadata operations.
- Multipart uploads parallelize large file transfers to maximize throughput.
- Uses separate optimized paths for small (latency-sensitive) vs large (throughput-sensitive) objects.

### 6. WhatsApp / Messaging Systems
- **Priority: Low latency** for message delivery (real-time feel).
- Uses persistent connections (WebSocket/XMPP) to avoid connection setup overhead.
- Messages are queued if the recipient is offline — throughput handled asynchronously.

### 7. Hadoop MapReduce
- **Priority: Maximum throughput** over batch datasets.
- Not designed for low latency — jobs can take minutes to hours.
- Optimized for processing terabytes of data efficiently.
- Contrast with Spark, which trades some throughput for lower latency via in-memory processing.

---

## Summary

| | **Latency** | **Throughput** |
|---|---|---|
| **Focus** | Speed of one request | Volume of requests handled |
| **Optimized by** | Caching, fewer hops, async I/O | Batching, parallelism, sharding |
| **Measured by** | ms / µs, p50/p99/p999 | RPS, TPS, MB/s |
| **Use case** | Real-time, user-facing systems | Batch processing, data pipelines |
| **Risk of over-optimizing** | Lower throughput, wasted resources | Higher latency, poor UX |

> **Golden Rule:** Optimize for the bottleneck. A user-facing API needs low latency. A data pipeline needs high throughput. Most real systems need a **deliberate balance** between the two.