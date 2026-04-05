# Caching: Cache Aside (Lazy Loading)

---

## 1. What Is Cache Aside?

Cache Aside (also called **Lazy Loading**) is a caching strategy where the **application** is responsible for managing the cache. The cache does **not** interact with storage directly — the app reads from cache, and on a miss, fetches from the database and populates the cache itself.

> The cache sits "aside" — it is consulted, but it does not own the data pipeline.

---

## 2. How It Works

### Read Path

```
Client
  │
  ▼
┌─────────────┐     Cache HIT      ┌───────────────┐
│ Application │ ─────────────────► │     Cache     │
│             │ ◄─────────────────  │  (Redis/Memcached) │
└─────────────┘                    └───────────────┘
       │
       │  Cache MISS
       ▼
┌─────────────┐
│  Database   │  ──► App loads data ──► writes to Cache ──► returns to Client
└─────────────┘
```

**Step-by-step:**

1. App checks cache for the requested key.
2. **Cache HIT** → return data directly to client.
3. **Cache MISS** → app queries the database.
4. App writes the result into the cache (with a TTL).
5. App returns data to the client.

### Write Path (in Cache Aside)

Cache Aside does **not** define a write strategy — on writes, the application typically:
- **Invalidates** the cache entry (delete the key), OR
- **Updates** the cache entry directly.

Invalidation on write is more common because it avoids stale data and is simpler to implement correctly.

```
Write Request
  │
  ▼
┌─────────────┐
│ Application │──► Write to DB ──► Invalidate / Delete cache key
└─────────────┘
```

---

## 3. Pseudocode

```python
def get_user(user_id):
    # 1. Check cache
    user = cache.get(f"user:{user_id}")

    if user is None:
        # 2. Cache miss — fetch from DB
        user = db.query("SELECT * FROM users WHERE id = ?", user_id)

        if user:
            # 3. Populate cache with TTL
            cache.set(f"user:{user_id}", user, ttl=3600)

    return user


def update_user(user_id, data):
    # 1. Write to DB (source of truth)
    db.execute("UPDATE users SET ... WHERE id = ?", user_id)

    # 2. Invalidate cache (don't write stale data)
    cache.delete(f"user:{user_id}")
```

---

## 4. Trade-offs

| Dimension              | Detail |
|------------------------|--------|
| **Cache only stores what's requested** | Cold starts have 100% miss rate; cache warms up organically over time. |
| **Resilience to cache failure** | If the cache goes down, the app continues — it falls back to the DB. No single point of failure. |
| **Stale data risk** | Data can become stale if a write happens and the cache is not invalidated. TTL is the safety net. |
| **Cache stampede risk** | On a cold start or after a cache flush, many concurrent requests can all miss and hammer the DB simultaneously. |
| **Read-heavy workloads** | Excellent fit — repeated reads serve from cache, reducing DB load dramatically. |
| **Write-heavy workloads** | Poor fit — frequent invalidations mean low cache hit rate and repeated DB reads. |
| **Consistency** | Eventual consistency — there is a window between a write to DB and invalidation of the cache key. |
| **Complexity** | Low — simple to implement; the application owns all cache logic. |
| **Data layout flexibility** | Cache can store data in a different shape than the DB (e.g., aggregated, pre-joined objects). |

### Advantages

- Only requested data is cached (memory-efficient).
- Tolerates cache node failure gracefully.
- Simple to reason about — no magic, no middleware.
- Cache can hold denormalized/assembled views of data.

### Disadvantages

- First request after a miss is always slow (user pays the latency cost).
- Cache stampede under high concurrency (mitigated with locking or probabilistic early expiration).
- Stale data window between DB write and cache invalidation.
- Application code takes on the burden of cache management.

---

## 5. Cache Aside vs Other Caching Patterns

| Pattern           | Who populates cache? | Consistency | Complexity | Best For |
|-------------------|----------------------|-------------|------------|----------|
| **Cache Aside**   | Application (on miss) | Eventual | Low | Read-heavy, varied access |
| **Read-Through**  | Cache layer (transparently) | Eventual | Medium | Uniform read patterns |
| **Write-Through** | Cache layer (on write) | Strong | Medium | Write + read consistency |
| **Write-Behind**  | Cache layer (async write to DB) | Weak | High | Write-heavy, latency-sensitive |
| **Refresh-Ahead** | Cache layer (predictive prefetch) | Strong | High | Predictable access patterns |

---

## 6. Cache Stampede (Thundering Herd)

A cache stampede occurs when many concurrent requests all experience a cache miss at the same time — all of them query the DB simultaneously.

### Mitigation Strategies

**1. Mutex / Distributed Lock**
```python
def get_user(user_id):
    user = cache.get(f"user:{user_id}")
    if user:
        return user

    lock_key = f"lock:user:{user_id}"
    if cache.setnx(lock_key, 1, ex=5):  # acquire lock
        try:
            user = db.query(...)
            cache.set(f"user:{user_id}", user, ttl=3600)
        finally:
            cache.delete(lock_key)
    else:
        # Wait and retry — another process is populating
        time.sleep(0.1)
        return get_user(user_id)

    return user
```

**2. Probabilistic Early Expiration (PER)**
Slightly before a key expires, proactively refresh it. Prevents the cliff-edge miss.

**3. Background refresh**
Serve the stale value while asynchronously refreshing from the DB.

---

## 7. TTL Strategy

| Scenario | Recommended TTL |
|----------|-----------------|
| User profile data | 1–24 hours |
| Product catalog | 10–60 minutes |
| Session data | Sliding (refresh on access) |
| Aggregated counts (likes, views) | 30–300 seconds |
| Frequently changing data | Short TTL or skip caching |
| Static/rarely changing config | Hours to days |

> **Rule of thumb**: TTL = acceptable staleness window. If stale data for 60 seconds is acceptable, TTL = 60s.

---

## 8. Cache Key Design

Good key design prevents collisions and enables targeted invalidation.

```
# Pattern: namespace:entity:id[:variant]

user:profile:1234
user:profile:1234:summary
product:detail:5678
product:list:category:electronics:page:1
rate_limit:user:1234:write
```

**Principles:**
- Use namespaces to group related keys for bulk invalidation.
- Include version/variant in key if data shape differs by context.
- Avoid overly broad keys that cache too much in one entry.

---

## 9. When to Use Cache Aside

**Use Cache Aside when:**
- The workload is **read-heavy** with repeated access to the same keys.
- You need **resilience** — app must tolerate cache outages.
- You want **control** over what gets cached (not everything, only hot paths).
- Data shapes in cache differ from DB (e.g., pre-assembled API response objects).
- You have **heterogeneous access patterns** — not all data is accessed equally.

**Avoid Cache Aside when:**
- Workload is **write-heavy** — constant invalidation destroys hit rate.
- You need **strong consistency** — stale reads are unacceptable.
- Access patterns are uniform and predictable — Read-Through is simpler.
- You want to cache on write regardless of whether something reads it.

---

## 10. Real-World Systems & Applications

### Twitter / X
- User timelines and profile data are fetched using Cache Aside with Redis.
- On a cache miss, the app queries the social graph DB (Manhattan/MySQL) and populates the cache.
- Separate TTLs are applied to active users (short) vs. inactive users (long or not cached).

### Facebook
- TAO (The Associations and Objects cache) implements a variant of Cache Aside for social graph reads.
- The app checks TAO first; on a miss, it falls back to MySQL and fills TAO.
- Invalidation is broadcast via a changelog to maintain consistency across data centers.

### Netflix
- Content metadata (titles, artwork, descriptions) is served via Cache Aside using EVCache (a Memcached wrapper).
- On a miss, the app fetches from Cassandra/MySQL and caches the result.
- This reduces the read load on the underlying DB by 95%+ for popular content.

### Airbnb
- Listing details and availability calendars use Cache Aside with Redis.
- Cache keys are invalidated on host updates to the listing.
- Separate cache tiers exist for ML-served recommendation features.

### Shopify
- Product catalog and storefront data are cached aside in Redis per-shop.
- Cache is invalidated on merchant product updates via webhooks.
- During high-traffic sales (flash sales, BFCM), cache pre-warming is triggered proactively.

### Stack Overflow
- Question and answer content is cached aside using Redis.
- On a cache miss, queries hit SQL Server; results are stored in the cache with a short TTL.
- The system is intentionally read-heavy (~100:1 read-to-write ratio) — ideal for Cache Aside.

---

## 11. Failure Modes & Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **No TTL set** | Stale data persists indefinitely | Always set a TTL, even if long |
| **Caching null/empty results** | DB returns empty; next request misses again | Cache negative results with a short TTL |
| **Giant cache values** | Large objects slow serialization and evict other keys | Break into smaller objects; cache IDs, not full lists |
| **No cache key namespacing** | Collisions across features | Use `namespace:entity:id` format |
| **Writing back to cache on update** | Race condition: stale write wins | Invalidate on write; don't update in place |
| **Caching mutable collections** | List of IDs changes frequently; cache is always stale | Cache individual entities, not collections |

---

## 12. Monitoring & Metrics

| Metric | Target / Signal |
|--------|-----------------|
| **Cache Hit Rate** | > 90% for steady-state; < 70% warrants investigation |
| **Cache Miss Rate** | Spike → cold start, deployment, or eviction pressure |
| **Eviction Rate** | High evictions → cache is undersized |
| **Cache Latency (P99)** | Should be sub-millisecond for in-memory caches |
| **DB Query Rate** | Should decrease as cache warms up |
| **Key TTL Distribution** | Ensure keys are expiring as expected |
| **Memory Usage** | Monitor for OOM risk; tune `maxmemory` and eviction policy |

---

## 13. Summary

```
┌────────────────────────────────────────────────────────────┐
│                   Cache Aside — At a Glance                │
├──────────────────┬─────────────────────────────────────────┤
│ Read strategy    │ Lazy load on miss                        │
│ Write strategy   │ Invalidate (app-managed)                 │
│ Consistency      │ Eventual                                 │
│ Cache failure    │ Graceful degradation to DB              │
│ Best fit         │ Read-heavy, heterogeneous access         │
│ Worst fit        │ Write-heavy, strong consistency needed   │
│ Typical cache    │ Redis, Memcached                        │
│ Key risk         │ Cache stampede, stale data window        │
└──────────────────┴─────────────────────────────────────────┘
```

> **Default to Cache Aside** for most production systems. It is the most widely deployed, easiest to debug, and most resilient caching pattern. Reach for Read-Through or Write-Through only when you need tighter consistency or want to remove cache logic from the application layer.