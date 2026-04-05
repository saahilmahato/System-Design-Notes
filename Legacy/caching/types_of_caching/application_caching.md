# Application Caching

## What is Application Caching?

Application caching is the practice of storing copies of frequently accessed data in a fast-access layer (the cache) so future requests can be served faster, avoiding expensive re-computation or repeated trips to slower data stores (databases, external APIs, disk).

The fundamental goal: **serve data faster by paying the cost once and reusing the result many times.**

```
Without cache:
  Client → App → Database (slow, repeated, expensive)

With cache:
  Client → App → Cache HIT  → Return immediately (fast)
                → Cache MISS → Database → Store in Cache → Return
```

---

## Core Concepts

### Cache Hit vs. Cache Miss
- **Cache Hit**: Requested data is found in cache → served directly (fast path)
- **Cache Miss**: Data is not in cache → fetched from origin, optionally stored in cache
- **Hit Rate** = (Cache Hits) / (Total Requests) — target > 80–90% for effective caching

### Cache Invalidation
One of the hardest problems in computer science. Strategies:
- **TTL (Time-to-Live)**: Data expires automatically after a set duration
- **Event-based**: Invalidate on write/update events (explicit purge)
- **Version-based**: Cache key includes a version token; old keys are abandoned
- **Write-through / Write-around / Write-back**: See Caching Strategies below

### Eviction Policies
When cache is full, what gets removed?
| Policy | Description | Best For |
|--------|-------------|----------|
| **LRU** (Least Recently Used) | Evict item not accessed for the longest time | General-purpose, most common |
| **LFU** (Least Frequently Used) | Evict item accessed the fewest times | When access frequency matters more than recency |
| **FIFO** | Evict oldest-inserted item | Simple, rarely optimal |
| **TTL-based** | Expire items after a fixed window | Time-sensitive data (sessions, tokens) |
| **MRU** (Most Recently Used) | Evict most recently used item | Rare; useful when most recent is least likely to be re-accessed |

---

## Where Caching Lives (Cache Tiers)

```
┌──────────────────────────────────────────────────────────────┐
│                         Request Flow                          │
│                                                              │
│  Client                                                       │
│    │                                                          │
│    ▼                                                          │
│  Browser / Client-side Cache  ◄── L1: Fastest, smallest      │
│    │                                                          │
│    ▼                                                          │
│  CDN / Edge Cache             ◄── L2: Geographic proximity   │
│    │                                                          │
│    ▼                                                          │
│  Load Balancer / Reverse Proxy Cache (Nginx, Varnish)        │
│    │                                                          │
│    ▼                                                          │
│  Application-level Cache      ◄── In-process (local) cache   │
│    │                                                          │
│    ▼                                                          │
│  Distributed Cache (Redis, Memcached)  ◄── Shared, external  │
│    │                                                          │
│    ▼                                                          │
│  Database Query Cache / Read Replicas                        │
│    │                                                          │
│    ▼                                                          │
│  Primary Database / Disk      ◄── Slowest, most durable      │
└──────────────────────────────────────────────────────────────┘
```

---

## Caching Strategies (Read)

### 1. Cache-Aside (Lazy Loading)
The application is responsible for managing the cache. Most common pattern.

```
Read:
  1. App checks cache
  2. Cache HIT → return data
  3. Cache MISS → App reads DB → App writes to cache → return data

Write:
  - Invalidate or update the cache entry on writes
```

**Pros**: Only cache what's actually requested; resilient to cache failure  
**Cons**: Cache miss is slow (3 steps); stale data risk if invalidation is missed  
**Use when**: Read-heavy workloads, not all data is equally accessed

---

### 2. Read-Through
Cache sits in front of the DB. App always talks to the cache, never to DB directly.

```
Read:
  1. App requests data from cache
  2. Cache HIT → return immediately
  3. Cache MISS → Cache fetches from DB, stores result, returns to App
```

**Pros**: App logic is simpler (no manual cache management); consistent cache population  
**Cons**: First access is always slow; cache layer must support DB fetching logic  
**Use when**: You want a clean abstraction layer (e.g., ORMs, caching proxies)

---

### 3. Write-Through
Every write goes to both cache and DB synchronously.

```
Write:
  1. App writes to cache
  2. Cache writes to DB
  3. Both succeed before returning
```

**Pros**: Cache always consistent with DB; no stale reads  
**Cons**: Higher write latency (writes must complete in both); cache filled with data that may never be read  
**Use when**: Data consistency between cache and DB is critical

---

### 4. Write-Behind (Write-Back)
Write goes to cache immediately; DB write happens asynchronously later.

```
Write:
  1. App writes to cache (returns immediately)
  2. Cache queues the DB write
  3. DB updated asynchronously (batched or delayed)
```

**Pros**: Very low write latency; can batch writes to DB for efficiency  
**Cons**: Risk of data loss if cache crashes before DB is updated; complex consistency  
**Use when**: High write throughput is critical and some data loss is tolerable (analytics, IoT)

---

### 5. Refresh-Ahead
Cache proactively refreshes data before it expires, based on predicted access patterns.

```
  Before TTL expires:
    Cache pre-fetches updated data from DB in the background
```

**Pros**: No cold-start penalty; consistently low latency for hot data  
**Cons**: May cache data that won't be accessed (wasted computation); requires predicting what to refresh  
**Use when**: Predictable, high-traffic hot data (homepage, trending feeds)

---

## Cache Invalidation Strategies

| Strategy | How it Works | Consistency | Complexity |
|----------|-------------|-------------|------------|
| **TTL Expiry** | Cache auto-expires after fixed time | Eventual | Low |
| **Event-Driven** | Invalidate on write/update event | Strong | Medium |
| **Cache-Key Versioning** | Include version/hash in key (e.g., `user:123:v5`) | Strong | Medium |
| **Write-Through** | Always update cache on write | Strong | Low-Medium |
| **Stale-While-Revalidate** | Serve stale data, refresh in background | Eventual | Medium |

---

## Trade-offs

### Consistency vs. Performance
| Dimension | Strong Consistency | Eventual Consistency |
|-----------|-------------------|----------------------|
| **Strategy** | Write-through, event-driven invalidation | TTL-based, write-behind |
| **Latency** | Higher (synchronous updates) | Lower |
| **Staleness** | None | Possible |
| **Complexity** | Higher | Lower |

### Memory vs. Hit Rate
- More cache memory → higher hit rate → better performance
- Cache is expensive; not all data benefits equally
- Use **access frequency analysis** to determine what to cache (Pareto: ~20% of data → ~80% of reads)

### Local vs. Distributed Cache

| Factor | Local (In-Process) Cache | Distributed Cache (Redis) |
|--------|--------------------------|--------------------------|
| **Latency** | Sub-millisecond | ~1ms network hop |
| **Scale** | Limited to single instance | Shared across all instances |
| **Consistency** | Inconsistent across instances | Consistent across all nodes |
| **Memory** | Limited (JVM heap, process memory) | Scales out horizontally |
| **Failure** | Cache lost on process restart | Survives application restarts |
| **Use case** | Single-server or session-sticky setups | Multi-instance, horizontally scaled apps |

### Cache Stampede (Thundering Herd)
When a popular cache entry expires, many requests simultaneously hit the DB.

**Mitigations:**
- **Mutex/Lock**: Only one request fetches from DB; others wait
- **Probabilistic Early Expiry**: Randomly refresh before TTL ends (jitter)
- **Background Refresh (Refresh-Ahead)**: Pre-warm cache before expiry
- **Stale-While-Revalidate**: Serve stale data while refreshing in background

---

## What to Cache (and What NOT To)

### Good Candidates
- Expensive DB query results (aggregations, joins)
- Rendered HTML fragments
- Session/authentication tokens
- Third-party API responses
- Configuration data / feature flags
- User profile data (read-heavy, infrequently updated)
- Static reference data (country lists, product catalog)

### Poor Candidates
- Highly personalized, unique-per-request data
- Data that changes extremely frequently (real-time prices, live counters)
- Small data where DB lookup is already fast (< 1ms queries with index)
- Sensitive data (PII, credentials) unless encrypted and access-controlled
- Write-heavy data with low read multiplier

---

## Cache Key Design

Good cache keys are deterministic, specific, and collision-free.

```
Pattern:  {namespace}:{entity_type}:{id}[:{variant}]

Examples:
  user:profile:1234
  product:details:SKU-9876:en-US
  feed:timeline:user:1234:page:2
  api:response:weather:NYC:2024-11-01
```

**Pitfalls:**
- Too broad keys → stale data from unrelated updates
- Too specific keys → low hit rate, defeats the purpose
- Unbounded key spaces → cache fills with long-tail one-off entries
- Missing namespace → key collisions across features

---

## Monitoring & Observability

| Metric | Target | What It Tells You |
|--------|--------|-------------------|
| **Hit Rate** | > 80–90% | Cache effectiveness |
| **Eviction Rate** | Low | Cache size adequacy |
| **Memory Usage** | < 80% max | Headroom, avoid OOM |
| **Latency (p50/p99)** | < 1–5ms for Redis | Cache layer health |
| **Miss Latency** | Tracks DB fallback cost | Impact of misses |
| **Key Count** | Track growth | Unbounded key spaces |
| **Stampede Events** | Minimize | Concurrency issues on miss |

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|--------------|---------|-----|
| **Cache everything** | Memory waste; stale data everywhere | Cache only hot, expensive, stable data |
| **No expiration (eternal TTL)** | Stale data lives forever | Always set a reasonable TTL |
| **Caching at every layer** | Cache invalidation hell across tiers | Pick the right tier for each data type |
| **Ignoring stampedes** | DB crush on hot-key expiry | Add jitter, locks, or refresh-ahead |
| **Sensitive data in cache** | Security risk | Encrypt or avoid caching PII |
| **Large monolithic cache values** | Partial updates invalidate everything | Break into smaller, independently cacheable units |
| **Cache as source of truth** | Data loss on cache flush | Cache is auxiliary; DB is the source of truth |

---

## Real-World Systems & Applications

### Twitter / X — Fan-out Cache
- Uses Redis to store pre-computed home timelines for users
- On tweet creation, fan-out writes to followers' timeline caches (write-behind for celebrities)
- Heavy users (~300M followers) use pull-on-read instead to avoid thundering herd on write
- Redis cluster at massive scale, with custom eviction for inactive users

### Netflix — Multi-Tier Caching
- **EVCache** (built on Memcached): globally replicated cache for member data, viewing history
- **CDN caching** (Open Connect appliances): ISP-level video chunk caching, eliminating ~95% of internet traffic
- Refresh-ahead used for recommendation model outputs to prevent cold starts
- Cache-aside for metadata (titles, artwork) with explicit invalidation on content updates

### Facebook / Meta — Memcached at Scale
- Deployed one of the largest Memcached clusters in the world (~thousands of servers)
- Uses **regional pools** and **lease tokens** to prevent stampedes and stale sets
- **McRouter** middleware for routing, failover, and traffic shaping across pools
- Published seminal paper: "Scaling Memcache at Facebook" (2013)

### Shopify — Redis for Session & Cart
- Distributed Redis for session storage (millions of concurrent shoppers)
- Cart data cached with TTL; durably stored in DB as backup
- Product catalog queries cached with event-driven invalidation on merchant updates
- Rate-limit counters stored in Redis with sliding window or token bucket

### GitHub — Fragment Caching
- Rails fragment caching for rendered HTML (repository headers, file trees)
- Redis for rate limit state, session tokens
- Varnish reverse-proxy cache in front of web servers for unauthenticated pages
- Cache keys versioned with deploy identifiers to invalidate on code changes

### Uber — Geospatial Cache
- Driver location data cached in Redis with very short TTL (seconds) — intentionally stale-tolerant
- ETA/pricing computations cached per route segment to avoid re-running surge algorithms
- Consistent hashing for Redis sharding across geo-regions
- City-level configuration data cached at app startup (refresh-ahead on deployment)

### Stripe — API Response Caching
- Idempotency keys stored in Redis to deduplicate retried payment requests
- Rate limit counters per API key in Redis (token bucket algorithm)
- Webhook delivery state cached to manage retry logic and deduplication
- Payment intents cached briefly to handle race conditions in concurrent requests

---

## Decision Framework: Which Caching Approach?

```
Is data read many more times than it's written?
  NO  → Caching has low ROI; reconsider
  YES →
        Is data the same across all users?
          YES → Shared cache (Redis, CDN)
          NO  → Per-user cache keys with namespace isolation

        How stale can data be?
          Not at all → Write-through + event-driven invalidation
          Seconds OK → Short TTL (5–60s), stale-while-revalidate
          Minutes OK → Longer TTL, cache-aside

        Is this read or write heavy?
          Read-heavy  → Cache-aside or Read-through
          Write-heavy → Write-behind (if some data loss tolerable)
          Mixed       → Write-through with careful TTL

        Single server or distributed?
          Single        → In-process cache (Caffeine, Guava)
          Distributed   → Redis or Memcached
          Both layers   → L1 local + L2 Redis (two-tier caching)
```

---

## Technology Reference

| Tool | Type | Strengths | Common Use |
|------|------|-----------|------------|
| **Redis** | In-memory data structure store | Rich data types, persistence, pub/sub, clustering | Sessions, queues, leaderboards, distributed locks |
| **Memcached** | In-memory key-value cache | Simpler, multi-threaded, slightly faster for pure KV | High-throughput pure caching |
| **Varnish** | HTTP reverse proxy cache | Excellent HTTP cache, VCL scripting | API/page caching at the edge |
| **Caffeine** (JVM) | In-process local cache | Near-zero latency, W-TinyLFU eviction policy | JVM services, L1 local cache |
| **Guava Cache** (JVM) | In-process local cache | Simpler API, well-tested | Smaller JVM services |
| **CDN (Cloudflare, Akamai)** | Edge/network cache | Global PoPs, HTTP semantics | Static assets, API responses, HTML |

---

## Summary: The Caching Hierarchy of Decisions

1. **Do you need a cache?** — Only if reads >> writes AND the uncached path is measurably slow
2. **Where should it live?** — Pick the tier closest to the read (client → edge → app → DB)
3. **What strategy?** — Cache-aside for most cases; write-through for strong consistency
4. **How long is data valid?** — Set a TTL; never cache indefinitely without a plan
5. **How will you invalidate?** — TTL + event-driven for correctness, version keys for safety
6. **How will you handle cold starts?** — Warm-up scripts, refresh-ahead, or accept initial latency
7. **How will you monitor?** — Track hit rate, eviction rate, and miss latency at minimum