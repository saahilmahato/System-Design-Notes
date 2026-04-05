# Cache-Aside Pattern
> Cloud Design Patterns → Data Management

---

## 1. Overview

The **Cache-Aside** pattern (also known as **Lazy Loading**) is a caching strategy where the application is responsible for loading data into the cache on demand. The cache does **not** automatically sync with the underlying data store — instead, the application explicitly manages reads and writes.

> **Core idea:** The cache sits "aside" from the data store. The application talks to both independently.

---

## 2. How It Works

### Read Path

```
Application → Cache
    ├── HIT  → Return cached value ✓
    └── MISS → Query Data Store
                    └── Write result to Cache
                    └── Return result to Application
```

### Write Path

```
Application → Write to Data Store
           → Invalidate (or update) Cache entry
```

### Step-by-Step Flow

```
1. Application requests data by key.
2. Check cache first.
   a. Cache HIT  → return data, done.
   b. Cache MISS → go to step 3.
3. Fetch data from the primary data store (DB, object store, etc.).
4. Populate the cache with the fetched data (set TTL).
5. Return data to the caller.
```

### ASCII Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Application                        │
└───────────┬─────────────────────────┬───────────────────┘
            │  READ                   │  WRITE
            ▼                         ▼
  ┌──────────────────┐      ┌──────────────────────┐
  │   Cache (Redis/  │      │   Primary Data Store │
  │   Memcached)     │      │   (PostgreSQL, MySQL,│
  │                  │      │    DynamoDB, etc.)   │
  │  Key → Value     │      │                      │
  └──────────────────┘      └──────────────────────┘
         ▲
         │ Populate on MISS
         └──────────────────────────────────────────┘
```

---

## 3. Implementation

### Python (with Redis)

```python
import redis
import json
import psycopg2

cache = redis.Redis(host='localhost', port=6379, db=0)
TTL = 300  # 5 minutes

def get_user(user_id: int) -> dict:
    cache_key = f"user:{user_id}"

    # Step 1: Check cache
    cached = cache.get(cache_key)
    if cached:
        return json.loads(cached)  # Cache HIT

    # Step 2: Cache MISS — query DB
    conn = psycopg2.connect(dsn="...")
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, email FROM users WHERE id = %s", (user_id,))
    row = cursor.fetchone()
    if not row:
        return None

    user = {"id": row[0], "name": row[1], "email": row[2]}

    # Step 3: Populate cache
    cache.setex(cache_key, TTL, json.dumps(user))

    return user  # Cache MISS resolved

def update_user(user_id: int, data: dict):
    # Step 1: Write to DB
    conn = psycopg2.connect(dsn="...")
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE users SET name=%s, email=%s WHERE id=%s",
        (data["name"], data["email"], user_id)
    )
    conn.commit()

    # Step 2: Invalidate cache
    cache.delete(f"user:{user_id}")
```

### Java (with Spring + Redis)

```java
@Service
public class UserService {

    @Autowired private RedisTemplate<String, User> redisTemplate;
    @Autowired private UserRepository userRepository;

    private static final Duration TTL = Duration.ofMinutes(5);

    public User getUser(Long userId) {
        String key = "user:" + userId;
        User cached = (User) redisTemplate.opsForValue().get(key);

        if (cached != null) return cached; // Cache HIT

        // Cache MISS
        User user = userRepository.findById(userId)
            .orElseThrow(() -> new NotFoundException("User not found"));

        redisTemplate.opsForValue().set(key, user, TTL); // Populate cache
        return user;
    }

    public void updateUser(Long userId, UserDto dto) {
        userRepository.save(dto.toEntity(userId)); // Write to DB
        redisTemplate.delete("user:" + userId);    // Invalidate cache
    }
}
```

### Go

```go
func (s *UserService) GetUser(ctx context.Context, userID int64) (*User, error) {
    key := fmt.Sprintf("user:%d", userID)

    // Check cache
    val, err := s.redis.Get(ctx, key).Result()
    if err == nil {
        var user User
        json.Unmarshal([]byte(val), &user)
        return &user, nil // Cache HIT
    }

    // Cache MISS — query DB
    user, err := s.db.QueryUser(ctx, userID)
    if err != nil {
        return nil, err
    }

    // Populate cache
    data, _ := json.Marshal(user)
    s.redis.SetEx(ctx, key, data, 5*time.Minute)

    return user, nil
}
```

---

## 4. TTL Strategy

TTL (Time-To-Live) is critical for cache correctness and resource management.

| Scenario                        | Recommended TTL          | Rationale                                  |
|---------------------------------|--------------------------|--------------------------------------------|
| User profile / account data     | 5–15 min                 | Changes infrequently; stale window is fine |
| Product catalog / inventory     | 1–5 min                  | Changes more frequently                    |
| Session data                    | Match session expiry      | Must align with auth lifecycle             |
| Aggregated analytics / stats    | 30 sec – 5 min           | Acceptable slight staleness                |
| Frequently updated counters     | No caching / short TTL   | Risk of significant staleness              |
| Static reference data (configs) | 1–24 hrs                 | Rarely changes                             |

**TTL Jitter**: Add a random offset (±10–20%) to TTL to prevent **cache stampede** (thundering herd) when many entries expire simultaneously.

```python
import random
base_ttl = 300
jittered_ttl = base_ttl + random.randint(-30, 30)
cache.setex(key, jittered_ttl, value)
```

---

## 5. Cache Invalidation Strategies

Cache invalidation is one of the hardest problems in distributed systems.

### 5.1 TTL-Based Expiry
- Let the cache entry expire naturally.
- Simple but allows stale data until TTL elapses.

### 5.2 Explicit Invalidation (Delete on Write)
- On every write to DB, delete the corresponding cache key.
- Application must know all cache keys affected by a write.

### 5.3 Write-Through (Complementary Pattern)
- On write, update both DB and cache simultaneously.
- Cache is never stale, but adds write latency.

### 5.4 Event-Driven Invalidation
- Use a message bus (Kafka, SNS) to broadcast invalidation events.
- Other services/instances consume events and evict cache entries.
- Scales well in distributed environments.

```
DB Write Event
    └──→ Kafka Topic: cache.invalidation
              └──→ Cache Service Consumer
                        └──→ Redis DEL key
```

---

## 6. Trade-offs

### Advantages

| Benefit                        | Description                                                                   |
|--------------------------------|-------------------------------------------------------------------------------|
| **Resilience**                 | Cache can fail without taking down the application; fall back to DB           |
| **Only useful data is cached** | Only data actually requested gets loaded — no wasted cache memory             |
| **Flexible TTL control**       | Application controls exactly when cache entries expire                        |
| **Read performance**           | Dramatic reduction in DB load and read latency for hot data                   |
| **Technology agnostic**        | Works with any cache (Redis, Memcached, local in-process) and any data store  |

### Disadvantages

| Drawback                       | Description                                                                   |
|--------------------------------|-------------------------------------------------------------------------------|
| **Cache miss penalty**         | First request always pays full DB + cache write cost (cold start problem)     |
| **Stale data**                 | Window of inconsistency between DB write and cache expiry/invalidation        |
| **Cache stampede**             | Many concurrent misses for the same key can flood the DB (thundering herd)    |
| **Complexity**                 | Application code must manage cache logic explicitly (no automatic sync)       |
| **Cache inconsistency**        | Invalidation bugs lead to stale reads surviving long beyond TTL               |
| **Double write risk**          | Race conditions between cache invalidation and subsequent reads               |

### Cache-Aside vs. Other Caching Patterns

| Pattern            | Who loads cache? | Write behavior           | Staleness risk | Complexity |
|--------------------|------------------|--------------------------|----------------|------------|
| **Cache-Aside**    | Application      | Invalidate on write      | Medium         | Medium     |
| **Write-Through**  | Cache layer      | Sync write to DB + cache | Low            | Medium     |
| **Write-Behind**   | Cache layer      | Async write to DB        | Low (short)    | High       |
| **Read-Through**   | Cache layer      | N/A (read only)          | Medium         | Low        |
| **Refresh-Ahead**  | Cache layer      | Pre-populate before TTL  | Very Low       | High       |

---

## 7. Failure Modes & Mitigations

### 7.1 Cache Stampede (Thundering Herd)

**Problem**: Many requests simultaneously experience a cache miss for the same key (e.g., after TTL expiry), causing a flood of DB queries.

**Mitigations**:
- **Mutex/Locking**: Only one request fetches from DB; others wait.
  ```python
  lock_key = f"lock:user:{user_id}"
  if cache.set(lock_key, "1", nx=True, ex=5):  # nx = only if not exists
      user = db.query(user_id)
      cache.setex(f"user:{user_id}", 300, json.dumps(user))
      cache.delete(lock_key)
  else:
      time.sleep(0.1)
      return get_user(user_id)  # retry
  ```
- **TTL Jitter**: Spread out expiry times.
- **Probabilistic Early Expiration (PER)**: Proactively refresh cache slightly before expiry.

### 7.2 Cache Poisoning
**Problem**: Incorrect data written to cache.
**Mitigation**: Validate data before caching; short TTLs as safety net.

### 7.3 Hot Key Problem
**Problem**: A single cache key is hammered by enormous read traffic (e.g., a viral post).
**Mitigation**: 
- Replicate hot keys across multiple cache shards with suffix (`post:123:shard:2`).
- Use local in-process caching as a secondary layer.

### 7.4 Cache Eviction Under Memory Pressure
**Problem**: LRU/LFU eviction removes entries before TTL, causing unexpected misses.
**Mitigation**: Size cache appropriately; monitor eviction rate metrics.

---

## 8. When to Use Cache-Aside

### Use When
- Read-heavy workloads with infrequent writes.
- Data can tolerate a short window of staleness.
- You need resilience: the system must work even if the cache is unavailable.
- Only a subset of data is "hot" (Pareto: 20% of keys get 80% of traffic).
- You need fine-grained control over cache population and invalidation logic.

### Avoid When
- Data must always be strongly consistent (financial transactions, inventory counts).
- Write-heavy workloads where cache misses are constant.
- The cache is a critical dependency (not just an optimization layer).
- Data access patterns are uniform — caching provides little benefit.

---

## 9. Real-World Systems and Applications

### 9.1 Facebook (Meta) — Social Graph & TAO
- Facebook's **TAO** (The Associations and Objects) system uses cache-aside heavily for social graph reads.
- User profile data, friend lists, and post metadata are cached with TTL.
- On writes (e.g., posting, friending), relevant cache keys are invalidated.
- At Facebook's scale, cache hit rates must exceed 99% to keep MySQL clusters alive.

### 9.2 Twitter/X — Timeline Service
- User timelines are assembled from cached tweet objects and follower graphs.
- Individual tweet objects are fetched with cache-aside from Redis clusters.
- On tweet deletion, cache entries are explicitly invalidated.
- Twitter's **Twemcache** (a fork of Memcached) was purpose-built for cache-aside workloads.

### 9.3 Netflix — Content Metadata
- Netflix uses cache-aside for movie/show metadata (titles, descriptions, artwork).
- **EVCache** (Netflix's distributed Memcached layer built on AWS) powers this.
- On metadata updates, TTL-based expiry and explicit invalidation both used depending on criticality.
- Cache-aside allows the service to function in degraded mode when cache nodes fail.

### 9.4 Amazon — Product Catalog
- Product detail pages are served from cache-aside backed by DynamoDB/Aurora.
- Product metadata (title, description, ratings count) tolerates seconds of staleness.
- Inventory counts use shorter TTLs or write-through since stock accuracy matters.
- AWS **ElastiCache** (Redis/Memcached) is the canonical service for this pattern.

### 9.5 Uber — Driver/Rider Matching
- Driver location and availability data is served from Redis using cache-aside.
- Trip metadata (trip state, route info) is cached after first fetch.
- Writes (status changes) trigger explicit cache invalidation.

### 9.6 GitHub — Repository Metadata
- Repository stats (star count, fork count, commit count) are served from cache-aside.
- Read-heavy, slightly stale data is fine — exact counts are not critical.
- Cache miss triggers DB query; result is cached for next N requests.

---

## 10. Observability & Metrics to Monitor

| Metric                  | Description                                   | Alert Threshold        |
|-------------------------|-----------------------------------------------|------------------------|
| **Cache Hit Rate**      | `hits / (hits + misses)`                      | < 80% warrants review  |
| **Cache Miss Rate**     | Proportion of requests hitting DB             | Spike = potential issue|
| **Eviction Rate**       | Keys evicted before TTL expiry                | High = cache too small |
| **Cache Latency (p99)** | Tail latency for cache reads                  | > 5ms is a concern     |
| **DB Load**             | QPS to primary DB                             | Spike on cache failure |
| **Memory Usage**        | Cache node memory utilization                 | > 80% = resize needed  |
| **Key TTL Distribution**| Spread of expiry times                        | Clustered = stampede risk |

---

## 11. Decision Flowchart

```
Is the data read-heavy?
    │
    ├─ NO  → Cache-aside provides limited benefit; consider write-through or skip caching
    │
    └─ YES → Can you tolerate short-term staleness?
                 │
                 ├─ NO  → Use write-through + synchronous invalidation
                 │
                 └─ YES → Is only a subset of data hot (Pareto principle)?
                               │
                               ├─ YES → Cache-aside is ideal ✓
                               │
                               └─ NO  → Consider read-through or pre-warming
```

---

## 12. Interview Cheat Sheet

| Question                                | Answer                                                              |
|-----------------------------------------|---------------------------------------------------------------------|
| What is Cache-Aside?                    | App manages cache: read cache first, miss → fetch DB → populate    |
| How does it differ from Read-Through?   | App controls logic vs. cache layer handles it transparently         |
| What is cache stampede?                 | Many concurrent misses → flood DB; mitigated by locks + TTL jitter  |
| How do you handle writes?               | Write to DB, then invalidate (delete) the cache key                 |
| When does it fail?                      | Strong consistency required, write-heavy, cache is a hard dep       |
| What TTL should you use?                | Depends on data volatility; add jitter to prevent mass expiry       |
| How do you warm the cache?              | Pre-populate on startup or after deploy with predicted hot keys     |
| What cache should you use?              | Redis (rich types, persistence) or Memcached (pure speed, simpler)  |