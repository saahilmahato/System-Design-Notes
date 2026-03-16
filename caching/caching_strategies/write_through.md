# Caching: Write-Through

## 1. What Is Write-Through Caching?

In a **write-through** cache strategy, every write operation goes to **both the cache and the backing store (database) synchronously** before the write is acknowledged as complete. The cache is never written independently — data is always written to both layers in a single atomic operation from the caller's perspective.

```
Client
  │
  ▼
┌─────────────┐   write (1)   ┌─────────────┐
│    Cache    │──────────────▶│  Database   │
│  (Redis /   │               │ (Postgres / │
│  Memcached) │               │  MySQL)     │
└─────────────┘               └─────────────┘
       ▲
       │ write (1) [same transaction / call]
       │
    Client
```

**Flow:**
1. Client sends a write request.
2. Application writes to cache first (or simultaneously).
3. Application writes to the database.
4. Only after both succeed is the write acknowledged to the client.

---

## 2. Core Properties

| Property              | Behavior                                                  |
|-----------------------|-----------------------------------------------------------|
| **Read latency**      | Low — reads are served from cache (warm)                  |
| **Write latency**     | Higher — every write hits both cache and DB               |
| **Data consistency**  | Strong — cache and DB are always in sync after a write    |
| **Cache freshness**   | High — cache always reflects latest written state         |
| **Write amplification** | Every write is doubled (cache + DB)                     |
| **Failure tolerance** | Depends on atomicity; partial failure can cause inconsistency |

---

## 3. Trade-offs

### ✅ Advantages

- **Strong consistency between cache and DB** — cache is never stale for data that was recently written.
- **Cache is always warm for recently written data** — subsequent reads are fast without a cache miss.
- **Simple reasoning** — no divergence window between cache and backing store; developers don't need to think about eventual consistency for writes.
- **No data loss on cache eviction** — since every write persists to the DB, eviction only affects performance (read latency), not durability.
- **Good for read-heavy workloads with occasional writes** — reads benefit from the always-warm cache, and the write penalty is acceptable at low write frequency.

### ❌ Disadvantages

- **Higher write latency** — every write requires two I/O operations (cache + DB), making it slower than write-back.
- **Write amplification** — even for data that is never read again, it still gets written to the cache, wasting cache capacity.
- **Cache pollution** — cold or one-time data (e.g., bulk imports, batch jobs) fills the cache unnecessarily. Mitigation: use TTLs aggressively.
- **Not suited for write-heavy workloads** — high throughput writes are bottlenecked by the synchronous dual-write.
- **Partial failure complexity** — if the cache write succeeds but the DB write fails (or vice versa), the system is in an inconsistent state. Requires transactional guarantees or compensating logic.

### Trade-off Summary Table

| Concern                  | Write-Through | Write-Back | Write-Around |
|--------------------------|:---:|:---:|:---:|
| Write latency            | Medium | Low | Low |
| Read latency (hot data)  | Low | Low | High (first read) |
| Data consistency         | Strong | Eventual | Strong (DB is source of truth) |
| Risk of data loss        | Low | Medium (unflushed) | None |
| Cache pollution          | Medium | Low | None |
| Implementation complexity | Low | Medium | Low |

---

## 4. When to Use Write-Through

**Use write-through when:**
- Reads significantly outnumber writes (read-heavy system).
- Data written is highly likely to be read soon after (temporal locality of access).
- Strong consistency between cache and DB is required.
- You cannot tolerate stale reads but also need fast reads.
- Cache durability guarantees are important (e.g., session data, user profiles).

**Avoid write-through when:**
- Write throughput is very high (e.g., high-frequency telemetry, click streams).
- Most written data is never read again (cold write paths).
- Minimizing write latency is the top priority.

---

## 5. Failure Modes & Mitigations

### Partial Write Failure

**Problem:** Cache write succeeds, DB write fails (or vice versa) → inconsistent state.

**Mitigations:**
- Use a **transactional write path**: wrap both writes in a try/catch and roll back the cache write if the DB write fails.
- Implement **write-through with compensation**: on DB write failure, immediately invalidate the cache key.
- Use **distributed transactions** (2PC) — high overhead, rarely worth it; prefer eventual correction.
- Design for **idempotent retries** so failed writes can be safely retried.

```python
def write_through(key, value):
    try:
        db.write(key, value)       # DB first (durable)
        cache.set(key, value)      # Cache second
    except DBException:
        raise                      # Don't write cache; let it miss on next read
    except CacheException:
        pass                       # DB succeeded; cache miss on next read is fine
```

> **Best practice:** Write to DB first, then update cache. A cache miss is recoverable; a lost DB write is not.

### Cache Node Failure

**Problem:** Cache goes down; all traffic falls back to DB.

**Mitigation:** Design your system to tolerate cache misses gracefully (DB is always current with write-through). Cache node failure degrades performance, not correctness.

---

## 6. Implementation Patterns

### Pattern 1: Application-Level Write-Through

The application code handles both writes explicitly.

```python
class WriteThoughCache:
    def __init__(self, cache, db):
        self.cache = cache
        self.db = db

    def set(self, key, value, ttl=3600):
        # Write to DB first (authoritative store)
        self.db.execute("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT UPDATE SET value=?", 
                        key, value, value)
        # Then update cache
        self.cache.setex(key, ttl, value)

    def get(self, key):
        value = self.cache.get(key)
        if value is None:
            # Cache miss — read from DB and repopulate
            value = self.db.execute("SELECT value FROM kv WHERE key=?", key)
            if value:
                self.cache.setex(key, 3600, value)
        return value
```

### Pattern 2: Cache-Aside with Forced Invalidation (poor man's write-through)

```python
def update_user_profile(user_id, data):
    db.update("users", user_id, data)
    cache.delete(f"user:{user_id}")        # Invalidate stale entry
    cache.set(f"user:{user_id}", data, ttl=3600)  # Repopulate immediately
```

### Pattern 3: Write-Through via ORM / DAL Layer

Many ORMs and data-access libraries support write-through natively:

```yaml
# Spring Cache (Java) — declarative write-through
@CachePut(value = "users", key = "#user.id")
public User updateUser(User user) {
    return userRepository.save(user); // Saves to DB and updates cache
}
```

---

## 7. Architecture Diagram

```
                    ┌──────────────────────────────────────────────┐
                    │              Application Layer                │
                    └──────────────┬───────────────────────────────┘
                                   │
                      ┌────────────▼────────────┐
                      │     Write-Through        │
                      │       Coordinator        │
                      └────────┬────────┬────────┘
                               │        │
                    ┌──────────▼──┐  ┌──▼──────────┐
                    │    Cache    │  │  Database    │
                    │  (Redis)    │  │ (PostgreSQL) │
                    └─────────────┘  └─────────────┘
                         ▲                  ▲
                         │ Read (cache hit) │ Read (cache miss)
                         │                  │
                    ┌────┴──────────────────┴─────┐
                    │          Read Path           │
                    └─────────────────────────────┘
```

---

## 8. Real-World Systems & Applications

### 8.1 Facebook TAO (The Associations and Objects)

Facebook's distributed data store for the social graph uses a write-through strategy for object and association data. When a user creates a post or relationship:
- The write propagates to the persistent MySQL layer.
- TAO cache tiers are updated synchronously for the local region.
- This ensures that immediately after a write, reads from the same region see fresh data.

**Why write-through here:** Social graph data (follows, friend counts, post metadata) is read extremely frequently. Data written by one user is immediately read by many others, making the warm-cache guarantee valuable.

---

### 8.2 Amazon ElastiCache with RDS (General Pattern)

AWS-recommended architecture for e-commerce and user-facing applications:
- **Product catalog, pricing, inventory:** written through ElastiCache (Redis) and RDS (Aurora) together.
- Cart and session data use write-through to ensure the latest state is always cached and durable.

**Why write-through here:** Product pages and checkout flows are read-heavy. Items recently added to inventory or price changes need to reflect immediately in the cache. Strong consistency is required so users don't see stale prices.

---

### 8.3 GitHub — Repository Metadata

Repository metadata (star counts, forks, descriptions) uses write-through caching:
- Updates to metadata (e.g., a new star event) are written to both the cache and the backing MySQL store.
- This ensures repository pages (extremely read-heavy) always reflect current counts without a staleness window.

---

### 8.4 Stripe — Idempotency Keys

Stripe stores idempotency keys (used to deduplicate payment requests) with a write-through pattern:
- On receiving a new payment request with an idempotency key, the key is written to both cache (for fast lookup) and the database (for durability).
- Strong consistency is critical here: a missed cache entry or stale value could result in a duplicate charge.

**Why write-through here:** Safety and correctness is more important than write throughput. Each idempotency key write is rare but must be immediately visible on any subsequent request.

---

### 8.5 Shopify — Product & Order State

Shopify uses write-through caching for merchant storefront data:
- When a merchant updates a product title, price, or availability, it is written to both the Memcached/Redis layer and the primary data store simultaneously.
- This ensures buyers see accurate inventory and pricing data even on high-traffic flash sales.

**Why write-through here:** Price and inventory accuracy is a business-critical correctness requirement. Cache staleness would result in oversells or incorrect checkout prices.

---

## 9. Write-Through vs. Related Patterns

### Write-Through vs. Write-Back (Write-Behind)

| | Write-Through | Write-Back |
|---|---|---|
| **When DB is written** | Synchronously, on every write | Asynchronously, after a delay |
| **Write latency** | Higher (waits for DB) | Lower (returns after cache write) |
| **Risk of data loss** | Very low | Medium (unflushed dirty pages) |
| **Best for** | Read-heavy, consistency-critical | Write-heavy, latency-sensitive |
| **Example** | User profiles, pricing data | Analytics counters, IoT telemetry |

### Write-Through vs. Write-Around

| | Write-Through | Write-Around |
|---|---|---|
| **What gets cached on write** | Everything | Nothing (bypasses cache) |
| **Cache on first read** | Already warm | Cold — must be populated on read |
| **Cache pollution** | Medium risk | No pollution |
| **Best for** | Data that is read soon after write | Bulk ingest / cold data |

### Write-Through vs. Cache-Aside (Lazy Loading)

| | Write-Through | Cache-Aside |
|---|---|---|
| **Cache population** | On write | On first read (miss) |
| **Consistency** | Stronger | Weaker (potential stale window) |
| **Initial cache state** | Warm for written keys | Cold until first read |
| **Complexity** | Moderate | Simple (most common pattern) |

---

## 10. Key Metrics to Monitor

| Metric | What It Tells You |
|---|---|
| **Cache hit rate** | Whether write-through is keeping the cache warm |
| **Write latency (p50/p99)** | Impact of dual-write on overall write path latency |
| **Cache-DB consistency drift** | Detect partial write failures |
| **Cache eviction rate** | Whether write-through is causing cache pollution |
| **DB write throughput** | Whether write-through is creating a DB bottleneck |
| **Error rate on cache vs. DB writes** | Detect split-brain / inconsistency events |

---

## 11. Anti-Patterns

- **Writing non-cacheable data through the cache**: Batch import jobs, analytics dumps, and ETL writes should bypass the cache (use write-around instead). Writing them through pollutes the cache.
- **Using write-through without TTLs**: Cache entries can grow stale via out-of-band DB mutations (e.g., direct SQL). Always set TTLs as a safety net.
- **Treating the cache as the primary store**: Write-through still makes the DB the source of truth. The cache is an acceleration layer, not a replacement.
- **Ignoring the ordering of writes**: Writing to the cache before the DB risks serving stale data if the DB write fails. Always write DB first.
- **No circuit breaker on DB writes**: If the DB is slow or down, write-through will cascade the latency/error to the entire write path. Implement timeouts and circuit breakers.

---

## 12. Summary

```
Write-Through in One Sentence:
Every write goes to both cache and DB synchronously,
so the cache is always fresh but writes are never faster than the DB.
```

**Decision checklist:**
- [ ] Reads >> Writes? → Write-through is a good fit.
- [ ] Data read soon after write? → Write-through is a good fit.
- [ ] Consistency more important than write throughput? → Write-through is a good fit.
- [ ] High write volume / write latency is critical? → Consider write-back instead.
- [ ] Data almost never re-read after write? → Consider write-around instead.