# Performance Antipattern: No Caching

---

## Table of Contents

1. [Overview](#overview)
2. [What Is the No-Caching Antipattern?](#what-is-the-no-caching-antipattern)
3. [How It Manifests](#how-it-manifests)
4. [Root Causes](#root-causes)
5. [Symptoms & Detection](#symptoms--detection)
6. [Impact Analysis](#impact-analysis)
7. [Patterns of the Antipattern](#patterns-of-the-antipattern)
8. [Solutions & Caching Strategies](#solutions--caching-strategies)
9. [Caching Layers in a Modern System](#caching-layers-in-a-modern-system)
10. [Trade-offs](#trade-offs)
11. [Real-World Examples & Applications](#real-world-examples--applications)
12. [Decision Framework: When to Cache](#decision-framework-when-to-cache)
13. [Anti-Patterns Within Caching (Meta Anti-Patterns)](#anti-patterns-within-caching-meta-anti-patterns)
14. [Monitoring & Metrics](#monitoring--metrics)

---

## Overview

The **No-Caching Antipattern** is one of the most common and costly performance problems in distributed systems. It occurs when a system repeatedly fetches, computes, or regenerates data that could have been stored and reused, resulting in unnecessary latency, excessive resource consumption, and degraded scalability under load.

> **Core Principle:** If the same data is requested more than once and it doesn't change between requests, fetching it again is waste.

---

## What Is the No-Caching Antipattern?

At its essence, the No-Caching Antipattern describes any scenario where:

- **Expensive operations are repeated** when their results are deterministic or slowly-changing.
- **No intermediate storage layer** exists between the caller and the data source.
- **Every request goes to the origin** — a database, external API, or compute function — regardless of how recently the same result was served.

This is not limited to database queries. It extends to:

- Rendered HTML pages
- Computed aggregates and reports
- External API responses (e.g., currency exchange rates, weather data)
- Authentication & authorization decisions
- DNS lookups and connection handshakes
- Serialized/deserialized objects
- Static assets (images, JS bundles, CSS)

---

## How It Manifests

```
Without Caching:

User A ──► App Server ──► DB  (query: SELECT * FROM products WHERE id=42)
User B ──► App Server ──► DB  (same query, 5ms later)
User C ──► App Server ──► DB  (same query, 10ms later)
...1000 users...              (1000 identical DB round trips)

With Caching:

User A ──► App Server ──► Cache MISS ──► DB ──► Store in Cache
User B ──► App Server ──► Cache HIT  ──► return cached result
User C ──► App Server ──► Cache HIT  ──► return cached result
...1000 users...              (1 DB round trip, 999 cache hits)
```

---

## Root Causes

### 1. Premature Simplicity
Developers build the simplest working solution first — direct DB reads — and never introduce a caching layer as load grows.

### 2. Correctness Over Performance Bias
Fear of serving stale data leads teams to always fetch fresh data, even when staleness tolerance is acceptable (e.g., product catalog, user profiles).

### 3. Lack of Observability
Without proper monitoring, teams don't know which queries are hot paths or how frequently repeated they are.

### 4. Organizational Silos
Backend teams don't coordinate with frontend/infrastructure teams to identify what's worth caching at each layer.

### 5. Misunderstood Workload
Read-heavy workloads are treated identically to write-heavy ones; no differentiation in data access strategy.

### 6. Stateless Architecture Misconception
"Stateless" services are sometimes incorrectly interpreted as "no local state at all," precluding even short-lived request-level caches.

---

## Symptoms & Detection

| Symptom | Likely Cause |
|---|---|
| DB CPU spikes on read-heavy traffic | Repeated identical queries hitting DB |
| High p99 latency even for simple reads | No cache in hot path |
| DB connection pool exhaustion | Too many concurrent DB reads |
| External API rate limit errors | No caching of third-party responses |
| Identical rows in slow query logs | Hot keys not cached |
| App server CPU high on serialization | Objects deserialized from DB on every request |
| Cost spikes on managed DB services | Read replica overloaded, no caching buffer |

### Detection Tools
- **Slow query logs** (MySQL, PostgreSQL `pg_stat_statements`)
- **APM tools** (Datadog, New Relic, Dynatrace) — identify repeated expensive calls
- **Flame graphs** — identify CPU hotspots in serialization/fetch code
- **Query frequency analysis** — sort queries by call count, not just duration

---

## Impact Analysis

### Latency Impact

| Operation | Typical Latency | With Cache Hit |
|---|---|---|
| Disk I/O (HDD) | ~10ms | ~0.1ms (memory) |
| SSD read | ~0.1ms | ~0.1ms (memory) |
| Database query (network + compute) | 1–50ms | <1ms |
| Cross-region API call | 100–500ms | <1ms |
| DNS lookup | 20–120ms | <1ms |
| External auth validation | 50–200ms | <5ms |

### Throughput Impact

Without caching, throughput is bounded by the slowest layer in the chain. A database capable of 10,000 QPS serving 1,000 identical queries per second is wasting 99% of its capacity on redundant work.

### Cost Impact
- Cloud databases charge per read unit (DynamoDB RCUs, Cosmos DB RUs)
- API gateways charge per call (OpenAI, Stripe, Google Maps)
- Compute charges accumulate for repeated heavy processing
- Egress charges compound when data crosses network boundaries

---

## Patterns of the Antipattern

### 1. Hot Path DB Reads
```
GET /api/homepage
  → SELECT * FROM featured_products        (same 20 rows, fetched 10k times/min)
  → SELECT * FROM categories               (same 8 rows, fetched 10k times/min)
  → SELECT COUNT(*) FROM users             (expensive aggregate, fetched constantly)
```

### 2. N+1 Without Caching
```
For each order in orders:
    user = DB.query("SELECT * FROM users WHERE id = ?", order.user_id)
    # If 10 orders share the same user, this is 10 identical DB hits
```

### 3. Repeated External API Calls
```python
def get_exchange_rate(from_currency, to_currency):
    # Called on every transaction — but rate only changes every few minutes
    return requests.get(f"https://api.exchangerates.io/latest?base={from_currency}")
```

### 4. Uncached Auth/Session Validation
```
Every request:
  → Validate JWT: fetch public keys from Auth0 (HTTPS call, ~50ms)
  → Fetch user permissions from DB (query, ~5ms)
  # Both are nearly static for the session lifetime
```

### 5. Static Asset Anti-Pattern
```
# No cache headers — browser refetches on every page load
GET /static/bundle.js   → 200 OK (1.2MB, every page load)
GET /static/logo.png    → 200 OK (80KB, every page load)
```

### 6. Repeated Serialization / Computation
```python
def get_product_recommendations(user_id):
    # Runs ML inference on every page load
    # Result is valid for 30 minutes
    return ml_model.predict(fetch_user_features(user_id))
```

---

## Solutions & Caching Strategies

### Cache-Aside (Lazy Loading)
Most common pattern. Application checks cache first; on miss, loads from DB and populates cache.

```
read(key):
    value = cache.get(key)
    if value is None:
        value = db.query(key)
        cache.set(key, value, ttl=300)
    return value
```

**Best for:** Read-heavy, irregular access patterns, tolerable staleness.

---

### Read-Through
Cache sits in front of the DB; on miss, the cache itself fetches from DB.

```
App ──► Cache ──► (miss) ──► DB
              ◄── stores ───
App ◄── Cache (next request is a hit)
```

**Best for:** Consistent access patterns, shared cache across app instances.

---

### Write-Through
On every write, update both the cache and DB simultaneously.

```
write(key, value):
    db.write(key, value)
    cache.set(key, value, ttl=300)
```

**Best for:** Read-after-write consistency requirements.

---

### Write-Behind (Write-Back)
Write to cache immediately; asynchronously flush to DB in batches.

```
write(key, value):
    cache.set(key, value)
    queue.push(WriteJob(key, value))   # flushed to DB in background
```

**Best for:** Write-heavy workloads where latency matters more than durability.

---

### Refresh-Ahead
Proactively refresh cache entries before they expire, based on access patterns.

```
on cache hit:
    if ttl_remaining(key) < threshold:
        async: refresh_from_db(key)
return cached_value
```

**Best for:** Predictable hot keys, zero-tolerance for cache-miss latency spikes.

---

### Memoization (In-Process Cache)
Cache results of expensive function calls within a single process.

```python
from functools import lru_cache

@lru_cache(maxsize=512)
def compute_user_segment(user_id: int) -> str:
    return expensive_segmentation_query(user_id)
```

**Best for:** Pure functions, per-request deduplication, computed values with no side effects.

---

### HTTP Caching (Client + CDN)
Use cache-control headers to enable browser and CDN caching.

```
Cache-Control: public, max-age=86400, stale-while-revalidate=3600
ETag: "abc123"
Last-Modified: Wed, 20 Mar 2024 10:00:00 GMT
```

**Best for:** Static assets, public API responses, rarely-changing pages.

---

## Caching Layers in a Modern System

```
                        ┌──────────────┐
                        │   Browser    │  ← HTTP Cache, Service Worker
                        └──────┬───────┘
                               │
                        ┌──────▼───────┐
                        │     CDN      │  ← Edge Cache (CloudFront, Fastly)
                        └──────┬───────┘
                               │
                    ┌──────────▼───────────┐
                    │    Load Balancer /   │  ← TLS session cache, rate limit state
                    │    API Gateway       │
                    └──────────┬───────────┘
                               │
                ┌──────────────▼──────────────┐
                │        App Server            │
                │  ┌────────────────────────┐  │  ← In-process cache (LRU, memoize)
                │  │  Local Memory Cache    │  │
                │  └────────────────────────┘  │
                └──────────────┬───────────────┘
                               │
                ┌──────────────▼──────────────┐
                │    Distributed Cache        │  ← Redis, Memcached
                │    (Redis / Memcached)      │
                └──────────────┬───────────────┘
                               │
                ┌──────────────▼──────────────┐
                │       Database              │  ← Query cache, buffer pool, indexes
                │   (PostgreSQL, MySQL)        │
                └─────────────────────────────┘
```

Each layer absorbs traffic before it reaches the next. The goal is to serve as many requests as possible from the highest (cheapest, fastest) layer.

---

## Trade-offs

### Caching vs. Consistency

| Aspect | No Cache | With Cache |
|---|---|---|
| Data freshness | Always fresh | Potentially stale (TTL-dependent) |
| Consistency guarantees | Strong (direct DB) | Eventual (until TTL expires) |
| Complexity | Low | Moderate to High |
| Failure modes | DB overload | Cache stampede, stale reads |

### Caching vs. Memory

| Cache Size | Trade-off |
|---|---|
| Too small | High miss rate, frequent cold paths |
| Too large | Memory pressure, eviction thrashing |
| Optimal | High hit rate without memory waste |
| Unbounded | Memory leaks, OOM risk |

### Cache Invalidation Complexity

> *"There are only two hard problems in computer science: cache invalidation, naming things, and off-by-one errors."* — attributed to Phil Karlton

| Invalidation Strategy | Staleness Risk | Complexity | Best For |
|---|---|---|---|
| TTL-based expiry | Medium | Low | Read-heavy, tolerates eventual consistency |
| Event-driven invalidation | Low | High | Write-heavy, strong consistency needs |
| Cache versioning | Low | Medium | Deployments, schema changes |
| Write-through | None | Medium | Read-after-write consistency |
| Manual invalidation | Low (if correct) | High | Fine-grained control |

### Latency vs. Complexity Trade-off

| Approach | Latency Reduction | Operational Complexity |
|---|---|---|
| No caching | Baseline | None |
| In-process LRU | 80–95% | Low |
| Redis (same region) | 70–90% | Moderate |
| CDN edge cache | 90–99% | Low–Moderate |
| Multi-layer cache | 95–99.9% | High |

### Cache Hit Rate Economics

```
Cost per request = (hit_rate × cache_cost) + (miss_rate × db_cost)

If cache_cost = $0.001 and db_cost = $0.10:
  At 90% hit rate:  0.9×0.001 + 0.1×0.10 = $0.0109 per request
  At 99% hit rate:  0.99×0.001 + 0.01×0.10 = $0.0020 per request
  At 0% hit rate:   $0.10 per request (50x more expensive than 99% cached)
```

---

## Real-World Examples & Applications

### 1. Twitter / X — Timeline Caching
Twitter's home timeline is one of the most read-heavy operations in tech. Early versions computed timelines on read — a massive fan-out query aggregating tweets from all followed accounts.

**Problem:** With users following thousands of accounts, this was an N+1 query nightmare at scale.

**Solution:** Precomputed, cached timelines in Redis. Write fan-out: when a tweet is posted, it's pushed into the in-memory timeline cache of each follower. Reads become O(1) cache lookups instead of O(follows) DB queries.

**Lesson:** For read-heavy social features, compute on write and cache the result.

---

### 2. Facebook — Memcached at Scale
Facebook's paper *"Scaling Memcache at Facebook"* describes running over 800 Memcached servers to handle billions of requests per second.

**Problem:** Without caching, even their heavily sharded MySQL cluster could not handle read volume from 1B+ users.

**Solution:** Every social graph lookup, news feed item, and user profile is cached in Memcached. The DB is the source of truth but rarely the hot path.

**Architecture:** Regional pools, lease mechanisms to prevent thundering herd, invalidation via McSqueal (MySQL binlog consumer).

**Lesson:** At massive scale, the DB should almost never be on the hot read path.

---

### 3. Shopify — Russian Doll Caching
Shopify serves millions of storefronts, each with unique product pages. Rendering each page involves nested components (store layout → product card → variant selector).

**Solution:** Russian Doll (nested) caching — each template fragment has its own cache key based on its data dependencies. When a product price changes, only that fragment is invalidated; the surrounding layout remains cached.

**Lesson:** Granular cache invalidation allows aggressive caching even on mutable data.

---

### 4. GitHub — Git Object Caching
Every `git clone` or `git fetch` request requires computing pack files from raw object storage.

**Problem:** Recomputing pack files for popular repos (Linux kernel, Rails) on every clone was CPU-intensive.

**Solution:** Cached pack files keyed by repo + commit SHA. Popular repos' pack files are pre-warmed. CDN caches git smart HTTP responses at the edge.

**Lesson:** Even binary/computed artifacts benefit from caching when computation is expensive and results are deterministic.

---

### 5. Netflix — Multi-Layer CDN Caching
Netflix delivers ~15% of global internet bandwidth. Serving video without caching is physically impossible at this scale.

**Architecture:**
- **Open Connect Appliances (OCAs):** Netflix-operated CDN nodes embedded in ISP networks
- **Edge nodes** cache the most popular content locally
- **Origin** only serves long-tail or new content
- **Metadata cache:** Show metadata (titles, thumbnails, descriptions) cached in EVCache (Netflix's Memcached wrapper)

**Hit rate:** ~95%+ of bytes served from edge cache.

**Lesson:** For media-heavy workloads, CDN caching is not an optimization — it's the core architecture.

---

### 6. Stripe — Idempotency Key Caching
Stripe handles payment API calls where repeated identical requests are dangerous (double charges).

**Problem:** Without caching idempotency results, retried API calls could trigger duplicate operations.

**Solution:** Stripe caches the response of idempotent API calls (keyed by `Idempotency-Key` header) for 24 hours in Redis. Retries return the cached response instead of reprocessing.

**Lesson:** Caching isn't just for performance — it enables correctness in distributed systems.

---

### 7. Uber — Geospatial Cache
Uber needs to find nearby drivers in real-time for millions of simultaneous riders.

**Problem:** Computing proximity from raw driver GPS coordinates in a DB on every request is too slow.

**Solution:** Geospatial cache using Redis GEOADD/GEORADIUS. Driver positions are continuously updated in Redis; rider dispatch reads from this cache, not from a relational DB.

**Lesson:** For high-velocity, high-read geospatial data, a specialized in-memory cache is the only viable architecture.

---

### 8. Stack Overflow — Aggressive Application Caching
Stack Overflow serves over a billion page views per month from a remarkably small infrastructure.

**Secret:** Aggressive use of Redis and in-process memory caching. The top questions (which receive the majority of all traffic) are fully cached in RAM. The hot path rarely touches SQL Server.

**Lesson:** A small number of "celebrity" items often account for the majority of traffic. Cache them aggressively.

---

## Decision Framework: When to Cache

```
Is the data frequently read?
    │
    ├── NO  ──► Caching provides little benefit; skip
    │
    └── YES
         │
         Is it expensive to generate? (DB query, API call, computation)
             │
             ├── NO  ──► Only cache if read frequency is extreme (>100 req/s same key)
             │
             └── YES
                  │
                  Can you tolerate some staleness?
                      │
                      ├── NO  ──► Write-through cache or short TTL (<10s)
                      │
                      └── YES
                           │
                           How does data change?
                               │
                               ├── EVENT-DRIVEN  ──► Event-based invalidation
                               │                    (pub/sub, message queue)
                               │
                               └── TIME-BASED    ──► TTL-based expiry
                                                     (choose TTL = acceptable staleness window)
```

### Staleness Tolerance by Data Type

| Data Type | Acceptable Staleness | Recommended TTL |
|---|---|---|
| Static assets (JS, CSS) | Days–weeks | `max-age=604800` + versioned URLs |
| Product catalog | Minutes–hours | 5–30 minutes |
| User profile | Seconds–minutes | 30–300 seconds |
| Authentication token | Session lifetime | Until expiry |
| Real-time prices | Seconds | 1–10 seconds |
| Live sports scores | Sub-second | No cache / event-push |
| Search results | Minutes | 1–5 minutes |
| Aggregated metrics | Minutes | 1–15 minutes |

---

## Anti-Patterns Within Caching (Meta Anti-Patterns)

Even when you introduce caching, these mistakes recreate the performance problems:

### 1. Cache Stampede (Thundering Herd)
When a popular cache entry expires, thousands of simultaneous requests miss and all hit the DB at once.

**Fix:** Mutex/lock on cache miss (only one request rebuilds), probabilistic early expiration, or request coalescing.

```python
# Probabilistic early expiry to avoid synchronized expiry
import random
def get_with_jitter(key, ttl):
    value = cache.get(key)
    if value is None or (time_to_expiry(key) < ttl * 0.1 and random.random() < 0.1):
        value = db.fetch(key)
        cache.set(key, value, ttl + random.randint(-ttl//10, ttl//10))
    return value
```

### 2. Cache Pollution
Caching low-frequency, large objects evicts high-frequency small objects. Wastes memory on data that will never be a cache hit.

**Fix:** Segment caches by access pattern; use admission policies (TinyLFU).

### 3. Ignoring Cache Warm-up
After a deployment or cache flush, cold start causes a thundering herd against the DB.

**Fix:** Pre-warm cache before switching traffic; shadow warm-up in staging.

### 4. Inconsistent Invalidation
Different code paths update the same entity but only some paths invalidate the cache. Results in stale reads indefinitely.

**Fix:** Centralize cache invalidation in a single write path or use write-through caching.

### 5. Caching Mutable, Sensitive Data
Caching user-specific sensitive data (PII, payment details) in a shared cache creates security exposure.

**Fix:** Never cache sensitive data in shared caches; use per-user cache keys with encryption, or avoid caching altogether.

### 6. Too-Short TTLs
Setting TTLs so short that the cache hit rate is negligible — effectively recreating the no-caching antipattern.

**Fix:** Profile actual data change frequency; set TTL to match real staleness tolerance.

---

## Monitoring & Metrics

### Cache Performance KPIs

| Metric | Formula | Target |
|---|---|---|
| Cache Hit Rate | `hits / (hits + misses)` | >90% for hot paths |
| Cache Miss Rate | `misses / (hits + misses)` | <10% for hot paths |
| Eviction Rate | `evictions / total_keys` | As low as possible |
| Memory Utilization | `used_memory / max_memory` | 60–80% |
| Cache Latency (p99) | Percentile of get() calls | <1ms |
| DB QPS (before vs. after) | Queries per second | Significant drop after caching |

### Redis Monitoring Commands
```bash
redis-cli INFO stats | grep -E "keyspace_hits|keyspace_misses|evicted_keys"

# Output:
# keyspace_hits:9847261
# keyspace_misses:94821
# evicted_keys:0
# Hit rate = 9847261 / (9847261 + 94821) = 99.05%
```

### Alerting Thresholds

| Alert | Condition | Action |
|---|---|---|
| Cache Miss Rate High | `miss_rate > 20%` | Investigate TTL, key patterns |
| Eviction Rate Spike | `evictions > 1000/min` | Increase memory or review key sizing |
| Cache Latency High | `p99 > 5ms` | Check network, CPU, connection pool |
| Hit Rate Drop | `hit_rate drops > 10% in 5min` | Possible cache flush or key invalidation bug |

---

## Summary

| Dimension | No Caching | With Caching |
|---|---|---|
| Latency | High (DB/API bound) | Low (memory-speed) |
| Throughput | Limited by origin | Scales with cache size |
| Cost | High (per-read charges) | Low (amortized over hits) |
| Consistency | Strong | Eventual (configurable) |
| Complexity | Low | Moderate |
| Failure modes | DB overload, timeouts | Stampede, staleness, invalidation bugs |
| Scalability | Poor (vertical only) | Excellent (horizontal cache clusters) |

> **Bottom Line:** The No-Caching Antipattern is a latency and cost multiplier. The first cache layer you introduce (typically a distributed cache like Redis in front of your primary DB) almost always delivers the highest ROI of any performance optimization. Identify your hot read paths, measure their frequency, and cache aggressively — accepting the complexity of invalidation as a worthwhile trade-off for orders-of-magnitude improvements in throughput and latency.