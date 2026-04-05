# Caching

## 1. What is Caching?

Caching is the practice of storing copies of frequently accessed data in a fast-access storage layer (the **cache**) so that future requests can be served faster, reducing load on the origin data source (database, API, computation).

> **Core Idea:** Trade memory for speed. A cache hit is cheap; a cache miss falls back to the slower source.

---

## 2. Key Concepts & Terminology

| Term | Definition |
|---|---|
| **Cache Hit** | Requested data found in cache → served directly |
| **Cache Miss** | Data not in cache → fetched from origin, optionally stored |
| **Hit Rate** | `hits / (hits + misses)` — higher is better |
| **TTL (Time-to-Live)** | Duration before a cached entry expires |
| **Eviction** | Removing entries when cache is full |
| **Thundering Herd** | Simultaneous cache misses flooding the origin |
| **Hot Key** | A single cache key receiving disproportionately high traffic |
| **Cold Start** | Cache is empty; all requests are misses initially |

---

## 3. Where to Cache (Cache Layers)

```
Client → [ Client-Side Cache ] → [ CDN / Edge Cache ]
       → [ Load Balancer / Reverse Proxy Cache ]
       → [ Application Cache (in-process) ]
       → [ Distributed Cache (Redis / Memcached) ]
       → [ Database Query Cache ]
       → [ Storage / Disk Cache ]
```

### 3.1 Client-Side Cache
- Browser cache, mobile app local storage
- HTTP headers: `Cache-Control`, `ETag`, `Last-Modified`
- Best for: static assets, user-specific preferences

### 3.2 CDN / Edge Cache
- Geographically distributed PoPs (Points of Presence)
- Best for: static assets (images, JS, CSS), public API responses
- Examples: Cloudflare, Akamai, AWS CloudFront

### 3.3 Reverse Proxy Cache
- Sits in front of application servers
- Caches full HTTP responses
- Examples: Nginx, Varnish, Squid

### 3.4 Application-Level (In-Process) Cache
- In-memory, within the application process
- Zero network overhead
- Examples: Guava Cache (Java), `functools.lru_cache` (Python), `node-cache`
- Best for: computed values, config, small hot datasets

### 3.5 Distributed / External Cache
- Shared across multiple app instances
- Slightly higher latency than in-process, but consistent view
- Examples: **Redis**, **Memcached**
- Best for: session data, leaderboards, rate-limit counters, shared state

### 3.6 Database Query Cache
- Caches results of expensive queries
- MySQL query cache (deprecated in 8.0), PostgreSQL with `pg_bouncer` + app-level caching
- Best for: read-heavy, complex aggregate queries

---

## 4. Caching Strategies (Read)

### 4.1 Cache-Aside (Lazy Loading)
```
App → Check Cache
        ├── HIT  → Return data
        └── MISS → Read DB → Write to Cache → Return data
```
- **Pros:** Only caches what's actually requested; resilient to cache failure
- **Cons:** Cache miss = 3 round trips; risk of stale data
- **Used by:** Most general-purpose caching (Twitter timelines, product pages)

### 4.2 Read-Through
```
App → Read Cache
        └── Cache handles miss: fetches from DB, stores, returns
```
- Cache sits in the read path; app always talks to cache
- **Pros:** Simpler app logic; auto-populates on miss
- **Cons:** First request always slow (cold start)
- **Used by:** AWS ElastiCache with DAX (DynamoDB Accelerator)

### 4.3 Refresh-Ahead
- Cache proactively refreshes before TTL expires (based on access prediction)
- **Pros:** Low latency even at TTL boundary
- **Cons:** May cache data that won't be accessed; wasted resources

---

## 5. Caching Strategies (Write)

### 5.1 Write-Through
```
App → Write Cache + Write DB (synchronously)
```
- **Pros:** Cache always consistent with DB; no stale reads
- **Cons:** Write latency doubles (must wait for both); cache filled with rarely-read data
- **Used by:** Financial systems requiring strong consistency

### 5.2 Write-Behind (Write-Back)
```
App → Write Cache → Async Write DB (batched)
```
- **Pros:** Very fast writes; DB load reduced (batching)
- **Cons:** Risk of data loss if cache fails before DB write; complex consistency
- **Used by:** Gaming leaderboards, IoT telemetry, analytics pipelines

### 5.3 Write-Around
```
App → Write DB (bypass cache)
    → Cache populated only on read miss
```
- **Pros:** Avoids polluting cache with write-once data
- **Cons:** First read is always a miss
- **Used by:** Log storage, batch imports, backup data

---

## 6. Cache Eviction Policies

| Policy | Description | Best For |
|---|---|---|
| **LRU** (Least Recently Used) | Evict least recently accessed | General purpose — most common |
| **LFU** (Least Frequently Used) | Evict least frequently accessed | Frequency-skewed workloads |
| **MRU** (Most Recently Used) | Evict most recently accessed | Streaming/scan workloads |
| **FIFO** | Evict oldest entry | Simple queues |
| **Random** | Evict a random entry | Very low overhead; approximate |
| **TTL-based** | Evict after expiry | Time-sensitive data |

> **Redis default:** LRU (configurable via `maxmemory-policy`)

---

## 7. Cache Invalidation

> *"There are only two hard things in Computer Science: cache invalidation and naming things."* — Phil Karlton

### Strategies

| Strategy | Mechanism | Pros | Cons |
|---|---|---|---|
| **TTL Expiry** | Entry auto-expires | Simple, no coordination | Stale data during TTL window |
| **Event-Driven** | DB write triggers cache delete/update | Near real-time consistency | Requires pub/sub or CDC |
| **Write-Through** | Cache updated on every write | Always consistent | Slower writes |
| **Cache Busting** | New key per version (e.g., `v2:product:123`) | Instant for new clients | Old keys linger until TTL |

### Cache Invalidation with CDC (Change Data Capture)
```
DB Write → Binlog (MySQL) / WAL (Postgres)
         → CDC Tool (Debezium)
         → Kafka Topic
         → Cache Consumer → Invalidate/Update Cache
```
Used by: Facebook (Memcached + MySQL binlog replication)

---

## 8. Distributed Caching Patterns

### 8.1 Cache Sharding
- Partition cache data across nodes using consistent hashing
- Prevents single-node bottleneck
- **Consistent Hashing** ensures minimal key remapping on node add/remove

### 8.2 Cache Replication
- Replica nodes for read scaling and availability
- Redis: Master-Replica replication
- Tradeoff: Replication lag = brief inconsistency

### 8.3 Cache Cluster (Redis Cluster)
- Data sharded + replicated across cluster
- Automatic failover
- Used by: Airbnb, Twitter, GitHub

---

## 9. Common Problems & Solutions

### 9.1 Cache Stampede / Thundering Herd
- **Problem:** A popular key expires; thousands of requests hit origin simultaneously
- **Solutions:**
  - **Mutex/Lock:** Only one request populates cache; rest wait
  - **Probabilistic Early Expiry (PER):** Start refreshing before TTL expires using a probability function
  - **Background Refresh:** Serve stale while async refresh happens

### 9.2 Cache Penetration
- **Problem:** Requests for keys that don't exist in cache OR origin (e.g., invalid IDs) — always miss
- **Solutions:**
  - **Cache null values** with short TTL
  - **Bloom Filter:** Probabilistic check before cache/DB lookup — reject definitively absent keys

### 9.3 Cache Avalanche
- **Problem:** Many keys expire simultaneously → origin overwhelmed
- **Solutions:**
  - **Jitter on TTL:** `TTL = base_ttl + random(0, jitter_window)`
  - **Staggered warm-up** on deploys
  - **Circuit breakers** on DB to limit overload

### 9.4 Hot Key Problem
- **Problem:** Single key receives millions of req/sec (e.g., a viral tweet)
- **Solutions:**
  - **Local in-process cache** as L1 in front of Redis
  - **Key replication:** `hot_key_1`, `hot_key_2`, … → distribute reads
  - **Read replicas** for Redis

---

## 10. Trade-offs

| Dimension | Benefit | Cost |
|---|---|---|
| **Speed vs. Consistency** | Dramatically lower latency | Data can be stale |
| **Memory vs. Coverage** | More cache = higher hit rate | Memory is expensive |
| **Simplicity vs. Freshness** | TTL is simple | May serve outdated data |
| **Write performance** | Write-behind = fast writes | Risk of data loss |
| **Distributed vs. Local** | Shared state across nodes | Network overhead, added complexity |
| **Pre-warming vs. Lazy** | No cold start | Wastes memory on unused data |

### Decision Framework

```
Is data read-heavy?               → YES → Cache it
Is data highly dynamic?           → Consider short TTL or skip caching
Can users tolerate stale data?    → YES → Longer TTL, simpler setup
Is write throughput critical?     → Write-behind
Is consistency critical?          → Write-through or skip caching
Is data user-specific?            → Client-side or per-user cache keys
Is data global/shared?            → Distributed cache (Redis)
Is data static?                   → CDN
```

---

## 11. Real-World Systems & Applications

### Twitter / X
- **Problem:** Timeline reads must be fast for 500M+ users
- **Solution:** Fan-out on write — pre-compute timelines in Redis (sorted set per user)
- **Key insight:** Cache-aside + write-through hybrid; VIPs (celebrities) use fan-out on read to avoid massive write amplification

### Facebook
- **Problem:** Serve billions of social graph reads per second
- **Solution:** Multi-tier Memcached cluster (named **TAO** for graph data)
- **Key insight:** Uses MySQL binlog + invalidation messages to keep Memcached consistent; regional caches with eventual consistency across DCs

### Netflix
- **Problem:** Serve metadata (titles, artwork, recommendations) globally with low latency
- **Solution:** **EVCache** — Memcached-based, multi-region, multi-AZ distributed cache
- **Key insight:** Replicates cache data across AZs for resilience; write-invalidation pattern on content updates

### Uber
- **Problem:** Real-time driver location, surge pricing, ETAs at massive scale
- **Solution:** Redis for real-time geospatial indexing (`GEOADD`, `GEORADIUS`) + in-memory rate-limit counters
- **Key insight:** Very short TTLs (seconds) for location data; accepts staleness within a small window

### Shopify
- **Problem:** Flash sales create massive read spikes on product/inventory data
- **Solution:** Redis as primary cache for product catalog, cart sessions, and inventory counts
- **Key insight:** Cache stampede protection using mutex locks; background jobs to warm caches before sales

### Stack Overflow
- **Problem:** Millions of page views daily on a relatively small engineering team
- **Solution:** Aggressive SQL query result caching in Redis; entire HTML fragments cached
- **Key insight:** Achieves massive scale with minimal infrastructure by treating the cache as the primary read layer

### Discord
- **Problem:** Millions of concurrent users checking message history and online presence
- **Solution:** Read-through cache in front of Cassandra for message history; Redis for presence (online/offline status)
- **Key insight:** Presence data has sub-second TTL; message cache uses LRU with generous memory budget

---

## 12. Cache Sizing & Metrics

### Sizing Rule of Thumb
- **80/20 Rule:** 20% of data accounts for 80% of reads → cache the hot 20%
- Start with: `cache_size = 20% * working_set_size`
- Monitor hit rate and grow until hit rate plateaus

### Key Metrics to Monitor

| Metric | Target | Alert Threshold |
|---|---|---|
| **Hit Rate** | > 90% | < 80% |
| **Eviction Rate** | Low | Sustained high evictions |
| **Memory Usage** | < 80% capacity | > 90% |
| **Cache Latency (p99)** | < 1ms (Redis) | > 5ms |
| **Miss Rate** | < 10% | > 20% |
| **Key Expiry Rate** | Steady | Sudden spikes = avalanche risk |

---

## 13. Redis vs. Memcached

| Feature | Redis | Memcached |
|---|---|---|
| **Data Structures** | Strings, Hashes, Lists, Sets, Sorted Sets, Streams | Strings only |
| **Persistence** | RDB snapshots + AOF (append-only file) | None |
| **Replication** | Master-Replica + Sentinel/Cluster | None built-in |
| **Lua Scripting** | Yes | No |
| **Pub/Sub** | Yes | No |
| **Multi-threading** | Single-threaded core (I/O threaded in v6+) | Multi-threaded |
| **Use when** | Rich data types, persistence, complex ops | Simple KV, max throughput, horizontal scale |

---

## 14. Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Caching mutable data without invalidation** | Stale reads indefinitely | Use TTL or event-driven invalidation |
| **Using cache as primary store** | Data loss on cache flush | Cache is a copy, DB is the source of truth |
| **Over-caching** | Memory waste; cache churn | Cache only hot/expensive data |
| **Ignoring cold start** | Thundering herd on deploy | Pre-warm caches before going live |
| **No TTL on all keys** | Memory leak; unbounded growth | Always set a TTL or use explicit eviction |
| **Caching at too fine a granularity** | Excessive invalidation complexity | Cache at the right abstraction level |
| **Single cache node** | SPOF; hot key bottleneck | Cluster + replication |