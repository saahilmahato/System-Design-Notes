# Performance

## Definition

> **Performance** is about how fast a system responds to a single unit of work — latency, throughput, and resource efficiency under a given load.

- **If your system is slow for a single user, you have a performance problem.**
- Measured in: latency (ms), throughput (req/s), error rate (%), resource utilization (CPU/RAM %)

---

## Key Metrics

| Metric | Definition | Goal |
|---|---|---|
| **Latency** | Time to complete one request (p50, p95, p99) | As low as possible |
| **Throughput** | Requests handled per second | As high as possible |
| **Error Rate** | % of requests that fail | Near 0% |
| **CPU / Memory Utilization** | Resource burn per request | Efficient & predictable |
| **Time to First Byte (TTFB)** | How fast the first byte reaches the client | Minimize |
| **Apdex Score** | User satisfaction index based on latency thresholds | Closer to 1.0 |

> Always measure **p99 latency**, not just averages. Averages hide the worst user experiences.

---

## Root Causes of Poor Performance

- **Slow algorithms** — O(n²) where O(n log n) would suffice
- **N+1 query problem** — fetching parent then looping to fetch each child separately
- **Blocking I/O** — synchronous DB calls, file reads, network calls on critical paths
- **No caching** — recomputing the same result on every request
- **Unoptimized database queries** — missing indexes, full table scans, large joins
- **Memory leaks** — gradual memory growth causing GC pauses or OOM crashes
- **Serialization overhead** — converting large objects to/from JSON/Protobuf on hot paths
- **Chatty APIs** — many small requests instead of one batched request
- **Lock contention** — threads/processes fighting over shared resources

---

## Performance Optimization Techniques

### 1. Caching

- Store results of expensive operations so they don't need to be recomputed
- **Levels of caching:**

| Level | Example | Latency |
|---|---|---|
| CPU L1/L2/L3 | Processor cache | < 10 ns |
| In-process memory | HashMap, LRU cache | ~100 ns |
| Local disk | SSD | ~100 µs |
| Distributed cache | Redis, Memcached | ~1 ms |
| CDN | Cloudflare, Akamai | ~10 ms |

- **Cache eviction policies:** LRU (Least Recently Used), LFU (Least Frequently Used), TTL (Time-to-Live)
- **Cache invalidation strategies:** write-through, write-behind, cache-aside
- **Watch for:** cache stampede (many requests hit DB when cache expires simultaneously) → use locks or probabilistic early expiration

---

### 2. Database Optimization

- **Indexes:** Add indexes on frequently queried columns; composite indexes for multi-column filters
- **Query optimization:** Use `EXPLAIN`/`EXPLAIN ANALYZE` to inspect query plans
- **Avoid SELECT \*:** Fetch only the columns you need
- **Connection pooling:** Reuse DB connections (PgBouncer, HikariCP) instead of opening new ones per request
- **Denormalization:** Trade write complexity for read speed in read-heavy systems
- **Read replicas:** Offload read queries to replicas; writes go to primary only
- **Pagination:** Never return unbounded result sets; always use `LIMIT` + `OFFSET` or cursor-based pagination

---

### 3. Asynchronous & Non-Blocking I/O

- Don't block a thread waiting for a network call or disk read
- Use async/await, event loops (Node.js), reactive frameworks (Reactor, RxJava), or coroutines (Go, Kotlin)
- Move non-critical work off the request path: send emails, generate reports, trigger webhooks **asynchronously** via job queues

---

### 4. Algorithm & Data Structure Choice

- Profile before optimizing — don't guess
- Replace nested loops with hash lookups (O(1) vs O(n))
- Use appropriate data structures: bloom filters for set membership, tries for prefix search, heaps for priority queues
- Avoid premature optimization; optimize hot paths confirmed by profiling

---

### 5. Compression & Serialization

- Enable **gzip/Brotli** compression on HTTP responses — reduces payload size by 60–80%
- Use **binary serialization** (Protobuf, MessagePack, Avro) over JSON for internal service calls — faster to encode/decode, smaller wire size
- Compress large database columns (e.g., JSON blobs) at rest

---

### 6. Connection & Resource Pooling

- **Thread pools:** Avoid spawning a new thread per request; reuse from a bounded pool
- **DB connection pools:** A typical app needs far fewer DB connections than concurrent users
- **HTTP keep-alive:** Reuse TCP connections instead of handshaking every request

---

### 7. Content Delivery Networks (CDNs)

- Serve static assets (JS, CSS, images, videos) from edge nodes geographically close to users
- Reduces latency by avoiding round trips to origin servers
- Examples: Cloudflare, AWS CloudFront, Fastly

---

### 8. Profiling & Benchmarking

- **CPU profiling:** Flame graphs show where time is spent (py-spy, async-profiler, pprof)
- **Memory profiling:** Heap dumps, allocation tracking
- **Load testing:** Simulate real traffic (k6, JMeter, Locust, wrk)
- **APM tools:** Datadog, New Relic, Jaeger, OpenTelemetry for distributed tracing

---

## Performance Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| N+1 Queries | Loop triggers DB call per item | Batch fetch / JOIN |
| Synchronous HTTP calls in loops | Latency multiplies | Parallelize / batch |
| Returning full objects | Over-fetching data | Use projections / DTOs |
| No pagination | Memory explosion | Cursor or offset pagination |
| Magic sleeps / polling | Wasted CPU cycles | Use event-driven / webhooks |
| Unbounded thread creation | Thread exhaustion | Thread pool |
| No index on foreign keys | Slow joins | Always index FK columns |

---

### 📊 Tier Reference

| Tier | Range | Typical Operations |
|---|---|---|
| ⚡ Nanoseconds (ns) | 0.5 – 100 ns | CPU cache, branch prediction, RAM |
| ⏳ Microseconds (µs) | 1 – 999 µs | SSD reads, compression, in-DC network |
| 🐢 Milliseconds (ms) | 1 – 999 ms | HDD, cross-region calls, LLM tokens |
| 🚀 Seconds+ | 1 s – minutes | Full LLM responses, deep-space comms |

---

### 🔥 Key Mental Models

- **RAM is 200× faster than L1 cache is to HDD seek** — cache-friendly data access patterns matter enormously
- **An SSD is not a RAM replacement** — 1 MB sequential: RAM = 250 µs, SSD = 1 ms, HDD = 30 ms
- **Same-DC round trip (500 µs) vs cross-continent (150 ms)** — co-locate services that talk to each other frequently
- **A single frontier LLM call can cost 1–30 seconds** — never put it on a synchronous user-facing request path without streaming or async design
- **Mutex contention (25 ns) × millions of ops = real bottleneck** — design lock-free paths for hot code

> Credit: Original numbers by Jeff Dean (Google) and Peter Norvig. LLM entries updated for 2026 hardware and model landscape.

---

## Summary Checklist

- [ ] Profile before optimizing — find the actual bottleneck
- [ ] Cache expensive repeated computations at the right layer
- [ ] Index your database queries; avoid full table scans
- [ ] Use async I/O on network/disk bound operations
- [ ] Compress HTTP responses and use efficient serialization
- [ ] Pool threads and DB connections
- [ ] Measure p99 latency, not just averages
- [ ] Load test under realistic concurrency before releasing