# Database Caching

## What Is It?

Database caching is a layer that stores frequently accessed query results, computed data, or objects in fast in-memory storage — sitting between the application and the database. Instead of hitting the database on every read, the app checks the cache first. On a hit, data is returned immediately. On a miss, the DB is queried and the result is optionally stored in the cache for future requests.

```
Client
  │
  ▼
Application Server
  │
  ├──► Cache (Redis / Memcached)  ◄── HIT: return immediately
  │         │
  │         └── MISS
  │               │
  └──────────────►▼
               Database (PostgreSQL / MySQL / MongoDB)
```

---

## Core Concepts

### Cache Hit vs. Miss
- **Hit**: Data found in cache → sub-millisecond response
- **Miss**: Data not in cache → fall through to DB, optionally populate cache

### Cache Hit Rate
The percentage of requests served from cache. Target **> 90%** for a well-tuned cache. Lower rates mean the cache isn't providing much value.

```
Hit Rate = Cache Hits / (Cache Hits + Cache Misses)
```

### TTL (Time-to-Live)
Each cached entry has a TTL after which it expires and is evicted. TTL is the primary freshness knob — shorter TTL = fresher data but more DB load.

---

## Caching Strategies

### 1. Cache-Aside (Lazy Loading)
The most common pattern. The application owns the cache logic.

```
Read:
  1. Check cache
  2. On HIT → return
  3. On MISS → query DB → write to cache → return

Write:
  1. Write to DB
  2. Invalidate or update cache entry
```

**Pros**: Only caches what's actually read; cache failure doesn't break reads.  
**Cons**: First request always misses; risk of stale data if invalidation is missed.  
**Used by**: Most web apps (Django, Rails, Laravel with Redis).

---

### 2. Read-Through
The cache sits in front of the DB. On a miss, the cache itself fetches from DB.

```
App → Cache
         └── MISS → Cache fetches from DB → stores → returns
```

**Pros**: App logic is simpler; consistent data loading path.  
**Cons**: Cache must understand DB schema; first-hit latency penalty.  
**Used by**: ORM-level caches, some CDN edge caches.

---

### 3. Write-Through
Every write goes to cache AND DB synchronously.

```
App → Cache → DB (both updated on every write)
```

**Pros**: Cache always consistent with DB; no stale reads after writes.  
**Cons**: Write latency doubles; cache fills with data that may never be read.  
**Used by**: Systems where read consistency is critical (financial ledgers).

---

### 4. Write-Behind (Write-Back)
Writes go to cache first; DB is updated asynchronously in the background.

```
App → Cache (acknowledged immediately)
         └── async → DB (batched writes later)
```

**Pros**: Very low write latency; absorbs write spikes (burst buffering).  
**Cons**: Risk of data loss if cache crashes before flush; harder to implement.  
**Used by**: High-write systems (gaming leaderboards, analytics counters).

---

### 5. Refresh-Ahead
Cache proactively refreshes entries before they expire, based on access prediction.

```
TTL nearing expiry → background job re-fetches → updates cache
App always reads fresh data
```

**Pros**: Eliminates miss latency on hot keys; good for predictable access patterns.  
**Cons**: May refresh data that won't be needed again; complex to implement.  
**Used by**: News feeds, sports scores, dashboards.

---

## Eviction Policies

| Policy | Description | Best For |
|---|---|---|
| **LRU** (Least Recently Used) | Evicts the entry not accessed for the longest time | General-purpose; most common |
| **LFU** (Least Frequently Used) | Evicts the entry accessed the fewest times | Access frequency matters more than recency |
| **FIFO** | Evicts oldest entry regardless of use | Simple queues; time-ordered data |
| **TTL-based** | Evict on expiry | Data with natural staleness windows |
| **Random** | Evict random entry | Low overhead; acceptable for uniform access patterns |

Redis default: **LRU** (configurable via `maxmemory-policy`).

---

## Cache Invalidation

> "There are only two hard things in Computer Science: cache invalidation and naming things." — Phil Karlton

### Strategies

| Strategy | How | When to Use |
|---|---|---|
| **TTL Expiry** | Let entries expire naturally | Tolerable staleness window exists |
| **Event-driven Invalidation** | On write, delete/update cache key | Strong consistency needed |
| **Write-Through** | Update cache on every write | Cache always mirrors DB |
| **Versioned Keys** | `user:123:v5` — bump version on change | Avoids race conditions |
| **Cache Tags** | Tag groups of keys, invalidate by tag | Complex dependency graphs (e.g., Varnish, Drupal) |

---

## Cache Topologies

### Local (In-Process) Cache
Cache lives inside the application process (e.g., Guava Cache, Caffeine in JVM).

- **Pros**: Zero network latency; simplest setup
- **Cons**: Not shared across instances; inconsistency across replicas; lost on restart
- **Use for**: Immutable config, lookup tables, per-request memoization

### Distributed Cache (Shared)
External cache shared by all application instances (e.g., Redis, Memcached).

- **Pros**: Consistent across all app servers; survives app restarts; horizontally scalable
- **Cons**: Network hop (~0.5–2ms); operational complexity; single point of failure if not HA
- **Use for**: Session storage, rate limiting counters, shared query results

### Multi-Level Cache (L1 + L2)
Local cache (L1) in front of distributed cache (L2) in front of DB.

```
App → L1 (local, ~µs) → L2 (Redis, ~1ms) → DB (~10ms+)
```

- **Use for**: High-frequency reads on a small hot dataset (product catalogs, user profiles)

---

## Trade-offs

| Dimension | Benefit | Cost |
|---|---|---|
| **Latency** | Sub-ms reads from memory | Added complexity in write path |
| **Throughput** | Orders of magnitude more reads/sec | Cache layer becomes a bottleneck if undersized |
| **Consistency** | — | Stale reads during TTL window or missed invalidation |
| **Durability** | — | In-memory data is volatile; risk of data loss |
| **Cost** | Reduces DB load and hardware cost | RAM is expensive; operational overhead |
| **Scalability** | Trivially scales reads horizontally | Cache stampede / thundering herd on cold start |
| **Simplicity** | — | Cache invalidation bugs are notoriously hard to debug |

---

## Failure Modes & Mitigations

### Cache Stampede (Thundering Herd)
Many requests miss simultaneously (e.g., after cache restart), all hitting the DB at once.

**Mitigations**:
- **Mutex/Locking**: Only one request fetches from DB; others wait (Redis `SETNX`)
- **Probabilistic early expiration**: Refresh slightly before TTL expires
- **Jitter on TTL**: Randomize TTL across keys to spread expiry: `TTL = base_ttl + random(0, jitter)`

### Cache Penetration
Requests for keys that don't exist in cache OR DB (e.g., attacker probing fake IDs) bypass cache every time.

**Mitigations**:
- Cache negative results: store `null` with a short TTL
- **Bloom Filter**: Probabilistic structure to quickly reject impossible keys before hitting DB

### Cache Avalanche
Many cache entries expire at the same time → DB overwhelmed.

**Mitigations**:
- Jitter on TTL (same as thundering herd)
- Stagger cache population on startup
- Circuit breaker on DB layer

### Hot Key Problem
A single cache key receives disproportionate traffic (e.g., a viral post).

**Mitigations**:
- Replicate hot keys across multiple cache nodes: `post:viral:1`, `post:viral:2`
- Local L1 cache for ultra-hot keys
- Read replicas

---

## Sizing & Capacity

### Working Set Estimation
Cache only the hot data. In most systems, **80% of reads touch 20% of data** (Pareto principle).

```
Cache Size ≈ Working Set Size × Avg Object Size × Safety Factor (1.5x)
```

### Memory Pressure
When cache is full, eviction kicks in. Monitor:
- **Eviction rate**: High eviction → cache too small or TTL too short
- **Hit rate**: Dropping hit rate → working set outgrew cache

### Redis Cluster Sizing Example
```
Daily active users:  1,000,000
Avg session size:    2 KB
Hot session ratio:   10%

Required cache RAM = 1,000,000 × 0.10 × 2 KB = 200 MB
With safety factor = 200 MB × 1.5 = 300 MB
```

---

## Monitoring Metrics

| Metric | Target | Alert Threshold |
|---|---|---|
| **Hit Rate** | > 90% | < 80% |
| **Eviction Rate** | Near 0 | Sustained evictions |
| **Latency (P99)** | < 5ms | > 10ms |
| **Memory Usage** | < 80% of max | > 85% |
| **Connection Count** | Within pool limits | Pool exhaustion |
| **Cache Miss Rate** | < 10% | > 20% |
| **Key Expiry Rate** | Stable | Sudden spikes (avalanche signal) |

---

## Real-World Systems

### Twitter / X
- **Redis** for Timeline Cache: Pre-computed home timelines for users are stored in Redis. Fan-out on write pushes tweet IDs into follower caches.
- **Twemcache** (Memcached fork): Used for user profile and social graph caching at massive scale.
- Hot key problem addressed by replicating celebrity tweet IDs across multiple Redis nodes.

### Netflix
- **EVCache** (Memcached-based): Distributed cache deployed across AWS availability zones. Stores user viewing history, personalization data, and metadata.
- Cache-aside pattern: On miss, data is fetched from the backend Cassandra store and re-populated.
- Local JVM caches used for near-zero-latency access to immutable catalog metadata.

### Facebook / Meta
- **Memcached** at massive scale (billions of keys, hundreds of TB of RAM).
- **Lease mechanism** to solve thundering herd: Instead of all missers fetching from DB, one gets a "lease" token; others wait and retry.
- **Mcrouter**: Memcached proxy that handles sharding, replication, and failover transparently.
- **Tao**: Facebook's distributed object graph cache, designed specifically for social graph queries.

### Uber
- **Redis** for geospatial data: Driver locations stored as Redis GEO keys, enabling fast radius queries (`GEORADIUS`).
- Write-behind pattern: Location updates buffered in Redis, flushed to persistent store asynchronously.
- Surge pricing calculations cached with short TTL to avoid hitting ML scoring service on every request.

### Shopify
- **Redis** for session and cart caching: Scales storefront reads during flash sales (Black Friday traffic spikes 10–100x).
- Multi-level caching: Rack middleware cache (L1) + Redis (L2) + MySQL (DB).
- Page-level HTML fragment caching with Russian Doll caching pattern (nested cache invalidation).

### Stack Overflow
- Notably runs with a very small server footprint due to aggressive **SQL Server query result caching** using a custom in-memory cache.
- Demonstrates that a well-tuned cache can substitute for horizontal scaling — millions of requests served from ~9 web servers.

---

## Decision Framework

```
Is data read much more than written?
  ├── YES → Cache is a strong candidate
  │     ├── Can you tolerate stale data?
  │     │     ├── YES → Cache-Aside with TTL
  │     │     └── NO  → Write-Through or event-driven invalidation
  │     └── Is the data user-specific or shared?
  │           ├── Shared (product catalog, config) → Distributed cache, long TTL
  │           └── User-specific (session, cart) → Distributed cache, medium TTL
  └── NO → Cache may not help; consider DB optimization first
        └── Are writes bursty?
              └── YES → Write-Behind cache to absorb write spikes
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Caching mutable data without invalidation** | Stale reads indefinitely | Add TTL or event-driven invalidation |
| **Caching everything** | RAM wasted on cold data; eviction of hot data | Cache only the working set; monitor hit rate |
| **No TTL on cache entries** | Memory leaks; stale data survives indefinitely | Always set a TTL |
| **Using cache as primary store** | Data loss on eviction or restart | Cache is a performance layer, not a DB |
| **Ignoring cache stampede** | DB overwhelmed after cache restart | Mutex, jitter, or probabilistic refresh |
| **Fine-grained key per field** | High overhead, many round trips | Cache whole objects; invalidate whole objects |
| **Cache penetration on invalid IDs** | DB hammered by cache-bypassing requests | Bloom filter + negative caching |

---

## Technology Comparison

| Feature | Redis | Memcached |
|---|---|---|
| **Data Structures** | Strings, Hashes, Lists, Sets, Sorted Sets, Streams, HyperLogLog, Geo | Strings only |
| **Persistence** | RDB snapshots + AOF log (optional) | None (pure in-memory) |
| **Replication** | Master-replica + Redis Sentinel + Cluster | Third-party (Mcrouter) |
| **Lua Scripting** | Yes (atomic server-side logic) | No |
| **Pub/Sub** | Yes | No |
| **Memory Efficiency** | Slightly higher overhead | More memory-efficient for simple KV |
| **Multi-threading** | Single-threaded core (I/O multi-threaded since v6) | Multi-threaded |
| **Use When** | Rich data structures, persistence needed, pub/sub | Pure high-throughput KV with minimal overhead |

**Default choice: Redis** — richer feature set and most teams are already running it.

---

## Summary

Cache is the **first lever** to pull when DB read latency or throughput becomes a bottleneck. The right strategy depends on your consistency requirements: use **Cache-Aside with TTL** as the default, switch to **Write-Through** when stale reads are unacceptable, and **Write-Behind** when you need to absorb write spikes. Always monitor hit rate, eviction, and latency — a cache with a low hit rate is often worse than no cache due to added complexity.