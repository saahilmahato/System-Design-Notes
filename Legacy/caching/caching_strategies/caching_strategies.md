# Caching Strategies

## What is Caching?

Caching is the practice of storing copies of frequently accessed data in a faster storage layer (the cache) so that future requests are served more quickly. A **cache hit** occurs when the requested data is found in cache; a **cache miss** occurs when it is not, forcing a fetch from the origin (database, API, disk).

**Core formula:**
```
Effective Latency = (Hit Rate × Cache Latency) + (Miss Rate × Origin Latency)
```

---

## Cache Placement Strategies

### 1. Client-Side Cache
Data cached in the browser or mobile app.
- HTTP headers: `Cache-Control`, `ETag`, `Last-Modified`
- Use case: Static assets (JS, CSS, images), API responses with low churn
- Examples: Browser cache, CDN edge nodes, DNS resolver cache

### 2. CDN Cache (Edge Cache)
Geographically distributed caches close to end-users.
- Serves static and semi-static content (HTML, media, assets)
- Reduces origin server load and improves global latency
- Examples: Cloudflare, AWS CloudFront, Fastly

### 3. Application-Level Cache (In-Process)
Cache lives within the application server's memory.
- Extremely fast (no network hop)
- Not shared across instances — each server has its own state
- Use case: Small, frequently read lookup data (feature flags, config)
- Examples: Guava Cache (Java), functools.lru_cache (Python)

### 4. Distributed Cache (Out-of-Process)
Shared cache accessed over the network by all application instances.
- Consistent data across multiple app servers
- Slightly higher latency than in-process but orders of magnitude faster than DB
- Examples: **Redis**, **Memcached**, AWS ElastiCache

### 5. Database Query Cache
Caches results of expensive queries at the DB layer.
- MySQL Query Cache (deprecated in 8.0), PostgreSQL's pgBouncer
- Limited flexibility; invalidation is complex

---

## Cache Write Strategies

### Write-Through
Data is written to the cache AND the database simultaneously on every write.

```
Client → App → Cache → DB (synchronous)
```

**Pros:**
- Cache always consistent with DB
- No risk of data loss on cache crash

**Cons:**
- Higher write latency (must wait for both)
- Writes less-frequently-read data pollutes cache (low hit rate for write-heavy workloads)

**Best for:** Systems where read consistency is critical and write volume is manageable (e.g., banking ledger reads).

---

### Write-Behind (Write-Back)
Data is written to cache first; DB write is deferred asynchronously.

```
Client → App → Cache → (async) → DB
```

**Pros:**
- Very low write latency
- Batching DB writes can improve throughput (fewer round trips)

**Cons:**
- Risk of data loss if cache crashes before flush
- Complexity: need durable write queue (e.g., Redis persistence + WAL)

**Best for:** High write-throughput systems tolerant of eventual DB consistency (e.g., analytics event counters, gaming leaderboards).

---

### Write-Around
Writes go directly to DB, bypassing the cache. Cache is populated only on reads.

```
Client → App → DB (write)
Client → App → cache miss → DB → cache (on read)
```

**Pros:**
- Prevents cache pollution for write-heavy, rarely-read data

**Cons:**
- First read after write is always a cache miss (cold read penalty)

**Best for:** Log data, bulk imports, data written once and rarely re-read.

---

## Cache Read Strategies

### Cache-Aside (Lazy Loading)
Application code manages the cache explicitly. Most common pattern.

```
Read:
  1. Check cache
  2. On hit → return
  3. On miss → query DB → populate cache → return

Write:
  1. Write to DB
  2. Invalidate / update cache entry
```

```python
def get_user(user_id):
    user = cache.get(f"user:{user_id}")
    if user is None:
        user = db.query("SELECT * FROM users WHERE id = ?", user_id)
        cache.set(f"user:{user_id}", user, ttl=300)
    return user
```

**Pros:**
- Only requested data gets cached (no wasted space)
- Cache failure is graceful — app falls back to DB
- Works with any underlying data store

**Cons:**
- Initial requests pay full miss penalty
- Risk of stale data between cache write and next TTL expiry
- Cache stampede risk on cold start

**Used by:** Almost universally — Instagram, Twitter timeline caches, Shopify product pages.

---

### Read-Through
Cache sits in front of the DB. Application only talks to cache; the cache itself fetches from DB on a miss.

```
Client → Cache → (on miss) → DB
```

**Pros:**
- Cleaner application code (single data access path)
- Cache automatically populated on first read

**Cons:**
- First request is always slow (miss penalty)
- Less flexible — caching logic embedded in cache layer

**Used by:** ORMs with second-level caches (Hibernate L2), some managed caching services.

---

### Refresh-Ahead (Prefetching)
Cache proactively refreshes entries before expiry, based on predicted access patterns.

```
If TTL remaining < threshold → async refresh from DB
```

**Pros:**
- Near-zero miss latency for predictable access patterns
- Smooth user experience — no sudden miss spikes

**Cons:**
- Can refresh data that isn't needed again (wasted compute)
- Requires access pattern prediction

**Used by:** CDN prewarming, DNS prefetching, Netflix content prefetching by geography.

---

## Cache Eviction Policies

| Policy | Description | Best For |
|---|---|---|
| **LRU** (Least Recently Used) | Evicts entry not accessed longest | General purpose, temporal locality |
| **LFU** (Least Frequently Used) | Evicts entry accessed fewest times | Content popularity (videos, pages) |
| **MRU** (Most Recently Used) | Evicts most recently accessed | Large sequential scans, streaming |
| **FIFO** | Evicts oldest inserted entry | Simple queues, ordered data |
| **TTL-Based** | Evicts after fixed time window | Sessions, auth tokens, rate limits |
| **Random** | Evicts random entry | Low-cost approximation at scale |
| **ARC** (Adaptive Replacement Cache) | Hybrid LRU + LFU, auto-tunes | Mixed workloads |

**Redis default:** LRU (configurable via `maxmemory-policy`)

---

## Cache Invalidation Strategies

> "There are only two hard things in Computer Science: cache invalidation and naming things." — Phil Karlton

### TTL (Time-To-Live)
Every cache entry expires after a fixed duration.

- Simple, widely used
- Allows bounded staleness (known max drift)
- Cannot immediately reflect writes

### Event-Driven Invalidation
Write to DB triggers an invalidation event (delete or update cache key).

```
DB Write → Message Queue / Event → Cache Invalidation Service → Cache.delete(key)
```

- Strong consistency
- Complex infrastructure
- Risk of race conditions between write and invalidation

### Versioned Keys
Instead of invalidating, use a new key on each write.

```
cache.set("user:42:v3", data)  # v3 replaces v2
```

- No invalidation needed
- Old keys become orphans — needs TTL cleanup
- Used heavily in CDNs (cache-busting query params)

### Write-Through Invalidation
On every write, also update or delete the corresponding cache entry.

---

## Cache Stampede (Thundering Herd)

When a popular cache entry expires, many requests simultaneously hit the DB before the cache is repopulated.

### Solutions

**1. Mutex / Lock on Miss**
```python
def get_data(key):
    val = cache.get(key)
    if val: return val
    if cache.setnx(f"{key}:lock", 1, ex=5):  # Acquire lock
        val = db.query(...)
        cache.set(key, val)
        cache.delete(f"{key}:lock")
    else:
        time.sleep(0.05)  # Wait for lock holder
        return get_data(key)  # Retry
```

**2. Probabilistic Early Expiry (PER)**
Randomly refresh entries slightly before expiry based on miss cost.

**3. Stale-While-Revalidate**
Serve stale data while asynchronously refreshing — popularized by HTTP `Cache-Control: stale-while-revalidate`.

**4. Jitter on TTL**
Instead of `ttl = 300`, use `ttl = 300 + random(-30, 30)` to spread expiry times.

---

## Cache Consistency Patterns

| Pattern | Consistency | Latency | Complexity |
|---|---|---|---|
| Write-Through | Strong | High write | Medium |
| Write-Behind | Eventual | Low write | High |
| Write-Around | Eventual | Miss penalty | Low |
| Cache-Aside + TTL | Bounded stale | Medium | Low |
| Event-Driven Invalidation | Strong | Low | High |

---

## Distributed Cache Design Considerations

### Sharding / Partitioning
- **Consistent Hashing**: Distributes keys across nodes; minimal reshuffling when nodes are added/removed. Used by Redis Cluster, Memcached.
- **Mod-based Hashing**: `key % num_nodes` — simple but breaks on topology changes.

### Replication
- Redis supports primary-replica replication for read scaling and HA.
- Sentinel or Redis Cluster for automatic failover.

### Hot Key Problem
One key receives disproportionately high traffic (e.g., a viral tweet's like count).

**Solutions:**
- **Local in-process cache** in front of Redis for hottest keys
- **Key replication**: Shard a single hot key across N copies (`key:shard_0`, `key:shard_1`, ...) and route randomly
- **Read replicas**: Distribute reads across replicas

---

## Metrics to Monitor

| Metric | Target / Notes |
|---|---|
| **Hit Rate** | > 90% for most production caches |
| **Miss Rate** | < 10%; spikes indicate cold start or bad TTL |
| **Eviction Rate** | High evictions → cache too small |
| **Latency (p99)** | Redis should be < 1ms p99 |
| **Memory Usage** | Monitor vs. `maxmemory` limit |
| **Stampede Events** | Track lock contention / retry counts |
| **Key Count** | Unexpected growth → TTL misconfiguration |

---

## Decision Framework

```
Is the data read-heavy and relatively static?
├── Yes → Cache it (Cache-Aside + TTL is default choice)
└── No → Is it write-heavy?
    ├── Rarely read after write → Write-Around (don't pollute cache)
    ├── Low latency writes required → Write-Behind
    └── Consistency critical → Write-Through or Event-Driven Invalidation

Is the access pattern predictable?
├── Yes → Consider Refresh-Ahead / Prefetching
└── No → Stick with TTL + Cache-Aside

Does data change frequently?
├── Yes → Short TTL + Event-Driven Invalidation
└── No → Longer TTL, versioned keys

Does a single key get very high traffic?
└── Yes → Local cache layer + Key sharding (Hot Key mitigation)
```

---

## Real-World Examples

### Twitter / X — Timeline Caching
- Timelines are pre-computed ("fan-out on write") and stored in Redis as sorted sets.
- Each tweet creates writes to N followers' timeline caches (fan-out problem at scale: millions of followers).
- Solution: Hybrid fan-out — active users get pre-computed timelines; inactive users' timelines are computed on first read.
- **Strategy:** Write-Through for active users, Cache-Aside for inactive.

### Netflix — Content Metadata + EVCache
- Uses **EVCache** (an in-house distributed memcached layer) for member data, viewing history, and content metadata.
- Replicates cache data across AWS availability zones for resilience.
- TTL-based expiry with event-driven invalidation for high-sensitivity fields.
- CDN edge cache (OpenConnect) for video chunks — deployed ISP-side.
- **Strategy:** Multi-tier caching (CDN → EVCache → Cassandra/MySQL).

### Instagram — Photo Metadata
- Uses Redis for photo metadata and user session data.
- Originally used Memcached for feed/timeline data; migrated to Redis for richer data structures.
- Cache stampede mitigation via probabilistic early expiry on popular content.
- **Strategy:** Cache-Aside + TTL with hot key replication.

### Shopify — Product Catalog
- Product and inventory data cached heavily in Redis.
- Flash sales (Black Friday) trigger massive read spikes on specific product keys → hot key problem.
- Solved via local in-process caches + cache warming before sale events.
- **Strategy:** Cache warming + local L1 cache in front of Redis.

### Cloudflare — CDN + Edge Cache
- 250+ PoPs worldwide; serves ~36% of all web traffic.
- Uses aggressive content caching with `Cache-Control`, `ETag`, and `Vary` headers.
- Implements `stale-while-revalidate` and `stale-if-error` at edge.
- **Strategy:** Refresh-Ahead at CDN edges, Write-Around for origin.

### Discord — Message History
- Stores recent messages in Cassandra; hot channel message history in Redis.
- TTL-based eviction for older messages; cold data falls through to Cassandra.
- **Strategy:** Multi-tier cache (Redis hot tier → Cassandra cold tier).

### Google — Search Results
- Personalized search uses massive in-memory caching (Bigtable + Memorystore).
- DNS response caching and CDN edge caching for static search assets.
- **Strategy:** Distributed write-through cache with strong consistency for index updates.

### Uber — Geospatial Data
- Driver locations (high write, high read) stored in Redis geospatial structures (`GEOADD`, `GEORADIUS`).
- TTL-based eviction (stale driver location is meaningless after ~10s).
- **Strategy:** Write-Through + TTL for real-time location; Cache-Aside for trip history.

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Caching mutable, unique data (session-like) | Stale reads, bugs | Short TTL or skip cache |
| No TTL on cache entries | Memory leak, stale data forever | Always set TTL |
| Caching at the wrong layer | DB still bottlenecked | Move cache closer to hot path |
| Ignoring stampede risk | DB overwhelmed on expiry | Jitter TTLs, use locks, stale-while-revalidate |
| Treating cache as source of truth | Data loss on eviction | Cache is ephemeral — DB is ground truth |
| Over-caching (caching everything) | Wasted memory, complex invalidation | Cache only what is proven to be hot |
| Giant cache values (megabyte blobs) | Serialization overhead, network pressure | Store references, not full objects |
| No monitoring | Silent degradation | Track hit rate, eviction rate, latency |

---

## Summary

| Strategy | Read | Write | Consistency | Use Case |
|---|---|---|---|---|
| Cache-Aside | App checks cache | App writes DB, invalidates | Eventual (TTL) | Most general-purpose reads |
| Read-Through | Cache fetches from DB | — | Eventual | ORM L2 caches |
| Write-Through | — | Write to cache + DB | Strong | Critical reads (banking) |
| Write-Behind | — | Write to cache, async DB | Eventual | High write throughput |
| Write-Around | App checks cache | Bypass cache, write DB | Eventual | Write-once, rarely read |
| Refresh-Ahead | Proactive prefetch | — | Near-real-time | Predictable access patterns |