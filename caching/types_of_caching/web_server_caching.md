# Web Server Caching

> Caching stores the results of expensive computations or frequently accessed data so future requests can be served faster — reducing latency, database load, and compute cost.

---

## Table of Contents
1. [What is Web Server Caching?](#what-is-web-server-caching)
2. [Caching Layers](#caching-layers)
3. [Cache Placement Strategies](#cache-placement-strategies)
4. [Cache Population Strategies](#cache-population-strategies)
5. [Cache Eviction Policies](#cache-eviction-policies)
6. [Cache Invalidation Strategies](#cache-invalidation-strategies)
7. [Cache Key Design](#cache-key-design)
8. [Trade-offs](#trade-offs)
9. [Real-World Examples](#real-world-examples)
10. [Decision Framework](#decision-framework)
11. [Anti-Patterns](#anti-patterns)
12. [Monitoring & Metrics](#monitoring--metrics)

---

## What is Web Server Caching?

A **cache** is a high-speed data storage layer that holds a subset of data — typically transient — so that future requests for that data are served faster than querying the primary source (database, API, file system).

### The Core Problem It Solves

```
Without Cache:
  Request → Web Server → Database (slow, 50–200ms) → Response

With Cache:
  Request → Web Server → Cache HIT (fast, <1ms) → Response
                       → Cache MISS → Database → Populate Cache → Response
```

### Key Metrics
- **Cache Hit Rate** = Hits / (Hits + Misses) — aim for >80% in production
- **Cache Miss Penalty** = Cost of serving from origin on a miss
- **TTL (Time-to-Live)** = How long a cached entry remains valid

---

## Caching Layers

Modern systems stack multiple caching layers. Each has a different scope and trade-off.

```
Browser Cache
     ↓
CDN / Edge Cache  (Cloudflare, Fastly, Akamai)
     ↓
Load Balancer / Reverse Proxy Cache  (Nginx, Varnish)
     ↓
Application-Level Cache  (in-process memory, Redis, Memcached)
     ↓
Database Query Cache  (MySQL query cache, read replicas)
     ↓
Primary Database / Storage
```

| Layer | Location | Latency | Scope | Examples |
|---|---|---|---|---|
| Browser | Client-side | 0ms | Per user | HTTP cache headers |
| CDN | Edge PoP | ~1–5ms | Global / per region | Cloudflare, Fastly |
| Reverse Proxy | Server-side edge | ~1ms | Per server | Nginx, Varnish |
| In-process | App server RAM | <0.1ms | Per instance | Guava Cache, caffeine |
| Distributed Cache | Separate tier | ~1–5ms | Cluster-wide | Redis, Memcached |
| DB Query Cache | DB server | ~5–10ms | Per DB node | MySQL, PostgreSQL |

---

## Cache Placement Strategies

### 1. Inline Cache (Look-aside / Lazy Loading)

The application code manages the cache explicitly.

```
App checks cache → HIT: return data
                 → MISS: query DB → write to cache → return data
```

```python
def get_user(user_id):
    key = f"user:{user_id}"
    cached = redis.get(key)
    if cached:
        return deserialize(cached)
    
    user = db.query("SELECT * FROM users WHERE id = ?", user_id)
    redis.setex(key, ttl=3600, value=serialize(user))
    return user
```

**Pros:** Only caches what's actually requested; resilient to cache failures (falls back to DB).  
**Cons:** Cache miss on first access (cold start); stale data until TTL expires.

---

### 2. Write-Through Cache

Every write goes to both cache and DB simultaneously.

```
App writes → Cache updated → DB updated (synchronous)
App reads  → always from Cache (always warm)
```

**Pros:** Cache is always warm; no stale reads.  
**Cons:** Write latency increases; cache filled with data that may never be read.

---

### 3. Write-Behind (Write-Back) Cache

Writes go to cache immediately; DB is updated asynchronously.

```
App writes → Cache updated immediately → Response returned
                                       → Async: persist to DB
```

**Pros:** Low write latency; batching possible.  
**Cons:** Risk of data loss if cache crashes before flush; eventual consistency only.

---

### 4. Refresh-Ahead Cache

Cache proactively refreshes entries before they expire.

```
TTL = 60s. At 50s → background thread pre-fetches and refreshes
```

**Pros:** Eliminates miss penalty for hot data; smooth latency.  
**Cons:** May refresh data that isn't needed; complex to implement.

---

## Cache Population Strategies

| Strategy | When to Use | Example |
|---|---|---|
| **Lazy (on-demand)** | Unpredictable access patterns | Most web apps |
| **Eager (pre-warm)** | Known high-traffic patterns | Product pages at launch |
| **Event-driven** | Data changes trigger cache update | User profile updated → invalidate |
| **Scheduled** | Periodic refresh of analytics/reports | Leaderboard every 60s |

---

## Cache Eviction Policies

When the cache is full, an eviction policy determines what gets removed.

| Policy | Full Name | How It Works | Best For |
|---|---|---|---|
| **LRU** | Least Recently Used | Evict the entry not accessed for the longest time | General web caching |
| **LFU** | Least Frequently Used | Evict the entry with fewest total accesses | Long-lived popular data |
| **FIFO** | First In First Out | Evict oldest inserted entry | Simple, predictable workloads |
| **MRU** | Most Recently Used | Evict the most recently accessed | Rarely-reused scan-heavy workloads |
| **Random** | — | Evict a random entry | Simple implementations |
| **TTL-based** | Time-to-Live | Evict entries past their expiry time | Time-sensitive data |

> **Default choice:** LRU is the most universally applicable policy — used by Redis, Memcached, and most CDNs by default.

---

## Cache Invalidation Strategies

> "There are only two hard things in Computer Science: cache invalidation and naming things." — Phil Karlton

Cache invalidation is one of the hardest problems. Here are the main strategies:

### 1. TTL Expiry (Time-Based)
Set a fixed expiry on every entry. Simple but can serve stale data until TTL elapses.

```
SETEX user:123 3600 "<user data>"   # expires in 1 hour
```

**Use when:** Slight staleness is acceptable (e.g., product prices, social feed counts).

---

### 2. Event-Driven Invalidation (Active Invalidation)
On data mutation, explicitly delete or update the cache entry.

```python
def update_user(user_id, data):
    db.update("users", user_id, data)
    redis.delete(f"user:{user_id}")   # invalidate immediately
```

**Use when:** Strong consistency is required (e.g., user auth tokens, account balances).

---

### 3. Cache-Aside with Versioning
Embed a version number in the cache key. Old keys become unreachable (stale orphans TTL out naturally).

```
Key: user:123:v7    →    bump to user:123:v8 on update
```

**Use when:** You need atomic key rotation without race conditions.

---

### 4. Write-Through (Implicit Invalidation)
Every write updates the cache immediately — no explicit invalidation needed.

**Use when:** Write volume is low and read consistency is critical.

---

### Invalidation Matrix

| Strategy | Consistency | Complexity | Staleness Risk |
|---|---|---|---|
| TTL Expiry | Eventual | Low | Medium (up to TTL window) |
| Event-Driven Delete | Strong | Medium | None |
| Versioned Keys | Strong | Medium | None (old keys orphaned) |
| Write-Through | Strong | High | None |

---

## Cache Key Design

Cache keys must be **unique**, **deterministic**, and **human-readable**.

### Best Practices

```
Format: <entity>:<id>[:<variant>]

Examples:
  user:123
  user:123:profile
  product:456:price:USD
  feed:user:123:page:2
  search:q=shoes&category=men&sort=price:asc
```

### Namespacing
Use namespaces to allow bulk invalidation:

```
product:*     → invalidate all product keys
user:123:*    → invalidate all keys for user 123
```

### Hashing for Long Keys
For complex query strings or object state:

```python
import hashlib, json

def cache_key(params: dict) -> str:
    digest = hashlib.md5(json.dumps(params, sort_keys=True).encode()).hexdigest()
    return f"search:{digest}"
```

---

## Trade-offs

### Performance vs. Consistency

| Dimension | Pro-Caching | Anti-Caching |
|---|---|---|
| Read latency | Sub-millisecond hits | Always pays full DB cost |
| Data freshness | Potentially stale (TTL window) | Always fresh |
| Write latency | Adds invalidation overhead | Direct to DB |
| DB load | Drastically reduced | Linear with traffic |

### Memory vs. Hit Rate

```
More memory allocated → Higher cache capacity → Higher hit rate
Less memory allocated → More evictions → Lower hit rate → Higher miss penalty
```

The optimal cache size is typically **10–30% of the total working set** for most workloads using LRU.

### In-Process vs. Distributed Cache

| | In-Process (Local) | Distributed (Redis) |
|---|---|---|
| Latency | <0.1ms | ~1–5ms |
| Consistency | Per-instance (cache divergence) | Cluster-wide shared state |
| Memory | Limited to one server's RAM | Horizontally scalable |
| Failure isolation | Cache lost on app crash | Survives app restarts |
| Use case | Hot config, per-request state | Shared session, user data |

> **Rule of thumb:** Use in-process cache for immutable or low-churn data. Use distributed cache (Redis) for anything shared across multiple app instances.

### TTL: Short vs. Long

| Short TTL | Long TTL |
|---|---|
| More DB load (more misses) | Less DB load |
| More up-to-date data | Higher staleness risk |
| Better for fast-changing data | Better for slow-changing data |
| More cache churn | Better hit rates |

---

## Real-World Examples

### Twitter / X — Timeline Caching
- User timelines are pre-computed and stored in Redis clusters (Nighthawk / Pelikan)
- **Fanout on write:** When a user tweets, the tweet is pushed to followers' cached timelines
- Celebrity accounts (>1M followers) use **fanout on read** to avoid thundering herd
- Cache key: `timeline:{user_id}` with sorted sets ordered by tweet timestamp
- Result: Timeline reads return in **<5ms** regardless of follower count

### Facebook — Memcached at Scale (TAO)
- Facebook runs one of the world's largest Memcached deployments (tens of thousands of servers)
- TAO (The Associations and Objects) is a distributed cache + graph layer
- Cache objects represent social graph nodes and edges
- Uses **lease tokens** to prevent thundering herd on cache misses
- Cache invalidation is event-driven: writes propagate invalidations via a message bus

### Cloudflare — CDN Edge Caching
- Static assets cached at 300+ PoPs (Points of Presence) globally
- Uses **Cache-Control** headers (`max-age`, `s-maxage`, `stale-while-revalidate`) for TTL
- **Cache purge API** allows instant global invalidation by tag, URL, or prefix
- Serves billions of cached requests per day with ~95%+ hit rates on static assets

### Netflix — EVCache (Distributed Memcached)
- EVCache is Netflix's globally distributed caching system built on Memcached
- Deployed in every AWS region; cache data is **replicated across zones**
- Handles ~30 million requests/second at peak
- Used for: user metadata, viewing history, personalization data, A/B test assignments
- TTLs are tuned per data type: session tokens (30 min), recommendations (1 hour), static config (24 hours)

### Shopify — Redis Caching for Storefront
- Product catalog and storefront pages cached in Redis
- Cache key includes **shop ID + product ID + currency** to handle multi-tenant isolation
- On inventory update, targeted invalidation fires via background job
- Uses **stale-while-revalidate** pattern for checkout pages — serve stale, refresh async

### GitHub — Fragment Caching for Pull Requests
- PR pages are expensive to render (diff computation, comment trees, CI status)
- Uses **Russian Doll caching**: outer cache wraps inner caches
- Each fragment (file diff, review thread) cached independently with its own key
- A comment update only invalidates the comment fragment, not the entire PR page

---

## Decision Framework

### Should You Cache This Data?

```
Is the data read frequently (>5x per write)?
  NO  → Probably not worth caching (high invalidation churn)
  YES ↓

Is the computation / DB query expensive (>10ms)?
  NO  → Marginal benefit; consider skipping
  YES ↓

Can your system tolerate stale data for a window?
  NO  → Cache only with event-driven invalidation + short TTL
  YES ↓

Is the data shared across multiple users?
  YES → Distributed cache (Redis)
  NO  → In-process or user-scoped cache (session store)
```

### Cache Tier Selection

```
Read-heavy, infrequently changing, global (CSS, JS, images)?
  → CDN (Cloudflare, Fastly)

API responses shared across users (product catalog, config)?
  → Reverse proxy cache (Nginx, Varnish)

User-specific data (session, cart, feed)?
  → Distributed cache (Redis)

Per-request hot data (auth token, feature flags)?
  → In-process cache (request-scoped memory)
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Caching mutable data with long TTL** | Stale reads; users see outdated data | Short TTL + event-driven invalidation |
| **Cache everything eagerly** | Cache bloat; evicts useful data; wasted memory | Cache only frequently read data |
| **No cache stampede protection** | Thundering herd: all misses hit DB simultaneously | Use locking or probabilistic early expiration |
| **Not caching computed results** | Expensive aggregations re-run on every request | Cache expensive query results explicitly |
| **Using the DB as a cache** | DB read replicas get overloaded | Add dedicated caching tier |
| **Ignoring cache warm-up** | Post-deploy cold start: 100% miss rate initially | Pre-warm critical keys after deploy |
| **Single cache key for all users** | Cache poisoning; security data leaks across users | Always include user/tenant ID in key |
| **Forgetting serialization costs** | JSON serialize/deserialize eats the latency savings | Use efficient formats (MessagePack, Protobuf) |

---

## Cache Stampede (Thundering Herd)

When a popular cache key expires, thousands of concurrent requests can simultaneously miss and hammer the database.

### Solution 1: Mutex / Cache Lock
```python
lock_key = f"lock:{cache_key}"
if redis.setnx(lock_key, 1, ex=5):   # acquire lock
    data = db.fetch(...)
    redis.set(cache_key, data, ex=3600)
    redis.delete(lock_key)
else:
    time.sleep(0.05)
    return get_with_retry(cache_key)  # retry
```

### Solution 2: Probabilistic Early Expiration (PER)
Randomly refresh the cache slightly before TTL ends — spreading load across the pre-expiry window:

```python
def should_refresh(ttl_remaining, beta=1.0):
    return (-beta * math.log(random.random())) > ttl_remaining
```

### Solution 3: Background Refresh (Refresh-Ahead)
A background worker proactively refreshes entries before TTL hits zero.

---

## Monitoring & Metrics

| Metric | Target | Alert Threshold |
|---|---|---|
| **Hit Rate** | >80–95% | <70% |
| **Miss Rate** | <20% | >30% |
| **Eviction Rate** | Low | Sudden spike |
| **Cache Latency (p99)** | <5ms | >20ms |
| **Memory Usage** | <80% capacity | >90% |
| **Key Expiry Rate** | Stable | Large spikes |
| **Connection Pool Usage** | <70% | >85% |

### Key Questions to Answer
- Are hit rates degrading over time? (Possible: cache size too small, TTL too short)
- Are eviction rates high? (Possible: cache undersized for working set)
- Are there latency spikes during traffic bursts? (Possible: stampede occurring)
- Is memory usage growing unboundedly? (Possible: keys without TTL leaking)