# Performance Antipatterns

> Simple surface explanations of the most common performance mistakes in system design — what they are, why they happen, and how to recognize them.

---

## What Are Performance Antipatterns?

Performance antipatterns are recurring design or implementation mistakes that degrade system performance at scale. They often work fine in development or at low load but become critical bottlenecks in production. Most antipatterns are not immediately obvious — they emerge as systems grow.

---

## 1. N+1 Query Problem

### What It Is
For every item in a list, an additional database query is fired — resulting in N extra queries for N items, instead of one batched query.

### How It Looks
```
# Fetching 100 orders and then querying each user separately
orders = db.query("SELECT * FROM orders")         # 1 query
for order in orders:
    user = db.query("SELECT * FROM users WHERE id = ?", order.user_id)  # 100 queries
# Total: 101 queries instead of 1 JOIN
```

### Why It Happens
- ORMs (like ActiveRecord, Hibernate) lazy-load relationships by default
- Logic written without thinking about how many times a loop runs
- Works perfectly in tests with 5 rows; catastrophic with 50,000

### The Fix
- Use **eager loading** / JOIN queries
- Use **DataLoader** pattern (batching + caching — popularized by GraphQL)
- Use query analyzers to detect unexpected query counts

### Trade-offs
| Approach | Pro | Con |
|---|---|---|
| Eager loading always | Fewer queries | May fetch unnecessary data |
| Lazy loading always | Fetches only what's needed | N+1 risk in loops |
| DataLoader batching | Best of both worlds | Added complexity |

### Real-World Examples
- **Shopify**: Spent significant engineering effort eliminating N+1 queries in their storefront rendering pipeline
- **GitHub**: Uses extensive query counting in CI to catch N+1 regressions before deploy
- **Rails apps broadly**: So common that `bullet` gem was created solely to detect this antipattern

---

## 2. Unbounded Result Sets (Missing Pagination)

### What It Is
Queries or API endpoints that return all matching rows with no limit — fine at launch, catastrophic as data grows.

### How It Looks
```sql
-- No LIMIT clause
SELECT * FROM events WHERE user_id = 123;

-- Returns 3 rows today. Returns 3,000,000 rows in 2 years.
```

### Why It Happens
- Developers test with small datasets
- Business logic assumes a user "can't have that many" records
- Pagination seen as a frontend concern, not a backend necessity

### The Fix
- Always add `LIMIT` + `OFFSET` or **cursor-based pagination**
- Enforce maximum page sizes at the API layer
- Use keyset pagination (cursor) instead of offset for large datasets

### Trade-offs
| Strategy | Pro | Con |
|---|---|---|
| Offset pagination | Simple, stateless | Slow on deep pages (DB scans skipped rows) |
| Cursor pagination | Fast, stable | Can't jump to arbitrary pages |
| Streaming | Handles huge datasets | Complex client implementation |

### Real-World Examples
- **Twitter**: Migrated timelines from offset to cursor pagination to handle millions of tweets per user
- **Stripe API**: Uses cursor-based pagination (`starting_after`, `ending_before`) across all list endpoints
- **Elasticsearch**: Exposes `scroll` and `search_after` APIs specifically to avoid deep pagination pitfalls

---

## 3. Chatty I/O (Over-Fetching via Many Small Requests)

### What It Is
Making many small, frequent network or disk I/O calls instead of batching them into fewer, larger calls. Each call has overhead (network round-trips, syscalls, connection setup) that dominates the total cost.

### How It Looks
```
# Chatty: 1000 individual cache reads
for product_id in product_ids:
    product = cache.get(f"product:{product_id}")   # 1000 round-trips

# Better: one batched read
products = cache.mget([f"product:{id}" for id in product_ids])  # 1 round-trip
```

### Why It Happens
- Code written for single-item use cases then used in loops
- No awareness of network round-trip costs
- Microservices calling each other in request-per-item patterns

### The Fix
- Use bulk/batch APIs (`MGET` in Redis, `BatchGetItem` in DynamoDB)
- Implement **request coalescing** at the service layer
- Use message queues to aggregate writes before flushing

### Trade-offs
| Approach | Pro | Con |
|---|---|---|
| Individual calls | Simple code | High latency, high connection overhead |
| Batch calls | Low overhead | Larger payloads, partial failure handling |
| Async queuing | Decoupled, efficient | Adds latency, complexity |

### Real-World Examples
- **Facebook**: DataLoader was built to coalesce individual GraphQL field resolver calls into batched DB/service calls
- **AWS SDK**: All major AWS services expose batch APIs (BatchWriteItem, SendMessageBatch) to combat chatty patterns
- **Netflix**: Internal RPC frameworks enforce batching guidelines across microservice boundaries

---

## 4. Synchronous Blocking on Non-Critical Work

### What It Is
Making a user request wait for work that doesn't need to complete before returning a response — such as sending emails, updating analytics, or resizing images — within the critical path.

### How It Looks
```
def place_order(order):
    db.save(order)
    email.send_confirmation(order)      # Blocks! Takes 500ms
    analytics.track_conversion(order)  # Blocks! Takes 200ms
    image.resize_product_thumbnails()  # Blocks! Takes 1s
    return {"status": "ok"}            # User waited 1.7s unnecessarily
```

### Why It Happens
- Easiest to write sequentially
- "It's fast enough" in development (email server is localhost)
- No clear ownership of what is vs. isn't critical path work

### The Fix
- Move non-critical work to **background job queues** (Sidekiq, Celery, SQS)
- Use **fire-and-forget** patterns for analytics/logging
- Apply **async/await** and event-driven processing

### Trade-offs
| Approach | Pro | Con |
|---|---|---|
| Sync everything | Simple, consistent | Slow response times, cascading failures |
| Background queues | Fast responses, decoupled | At-least-once delivery, harder debugging |
| Event streaming | Highly scalable | Operational complexity (Kafka, etc.) |

### Real-World Examples
- **Shopify**: Processes post-order work (email, fraud checks, fulfillment triggers) via background jobs, not request threads
- **Airbnb**: Sends booking confirmation emails via async queues, not during the booking API call
- **Stripe**: Webhook delivery is fully async — the charge API returns immediately, webhooks are delivered via a retry-capable queue

---

## 5. Missing or Misused Caching

### What It Is
Either not caching expensive, repeated computations at all — or caching incorrectly (wrong TTL, wrong granularity, stale data served indefinitely).

### Sub-patterns

#### 5a. No Caching (Cache Miss Avalanche)
Every request hits the database even for data that rarely changes — user profiles, product catalogs, config values.

#### 5b. Cache Stampede (Thundering Herd)
A hot cache key expires. Thousands of requests simultaneously find a cache miss and all hit the database to regenerate the same value.

#### 5c. Over-Caching (Stale Data)
TTLs set too high. Users see outdated prices, inventory counts, or profile info long after the underlying data changed.

#### 5d. Wrong Cache Granularity
Caching an entire page when only one component changes, forcing full cache invalidation on minor updates.

### The Fix
- Use **probabilistic early expiration** to refresh cache before it expires
- Use **mutex/locking** on cache miss to let only one request regenerate
- Choose TTLs based on acceptable staleness, not convenience
- Cache at the **right layer** (query result, serialized object, HTML fragment)

### Trade-offs
| Decision | Pro | Con |
|---|---|---|
| Short TTL | Fresh data | High DB load, more cache misses |
| Long TTL | Low DB load | Stale data risk |
| No expiry + explicit invalidation | Always fresh | Complex invalidation logic |

### Real-World Examples
- **Reddit**: Cache stampede on front page cache expiry took down the site in early scaling years
- **Facebook**: Memcache leases — a system to coordinate who regenerates a cache entry — was invented to solve thundering herd
- **Stack Overflow**: Runs almost entirely from cache; the database is rarely hit for reads

---

## 6. Database as a Message Queue

### What It Is
Using a database table as a job queue — polling rows with status `pending`, marking them `processing`, then `done`. Works at low scale; becomes a polling-and-locking disaster at high scale.

### How It Looks
```sql
-- Worker polls every second
SELECT * FROM jobs WHERE status = 'pending' LIMIT 10 FOR UPDATE;
UPDATE jobs SET status = 'processing' WHERE id IN (...);
-- Do the work
UPDATE jobs SET status = 'done' WHERE id IN (...);
```

### Why It Happens
- No message queue infrastructure available
- Simple to implement with existing DB
- "We'll replace it later" that never happens

### Why It Breaks
- Polling adds constant load even when queue is empty
- `FOR UPDATE` row locking causes contention at scale
- No built-in retry, dead-letter, or backoff mechanisms
- Table grows unbounded without careful archival

### The Fix
- Use purpose-built queues: **RabbitMQ**, **SQS**, **Kafka**, **Redis Streams**
- If you must use a DB queue: use **SKIP LOCKED** (Postgres) for efficient polling
- Use libraries like **Sidekiq**, **Celery**, or **Faktory** that abstract this correctly

### Trade-offs
| Approach | Pro | Con |
|---|---|---|
| DB as queue | No new infrastructure | Polling overhead, locking contention |
| Redis queue | Fast, simple | Data loss risk if not persisted |
| Dedicated MQ (RabbitMQ/SQS) | Reliable, feature-rich | Operational overhead |
| Kafka | Durable, replayable | Heavy for simple job queues |

### Real-World Examples
- **GitHub Actions**: Originally backed by a DB queue; migrated to dedicated infrastructure as load grew
- **Basecamp**: Wrote **Solid Queue** (a well-engineered DB-backed queue using `SKIP LOCKED`) to prove DB queues can work — but only with the right implementation
- **Delayed::Job (Rails)**: A widely-used DB-backed queue that works for moderate scale but is explicitly not recommended for high-throughput systems

---

## 7. Monolithic Transactions Spanning Too Much

### What It Is
Wrapping large amounts of work — including non-DB operations like HTTP calls, file writes, or long computations — inside a single database transaction. Holds locks for too long, reducing throughput and increasing deadlock risk.

### How It Looks
```python
with db.transaction():
    order = db.save(order)
    inventory = db.update_inventory(items)     # OK
    response = stripe.charge(card, amount)     # BAD: external HTTP call inside transaction!
    email.send_confirmation(order)             # BAD: side effect inside transaction!
    db.create_audit_log(order)
```

### Why It Happens
- Feels "safe" — everything succeeds or rolls back together
- Misunderstanding of transaction scope
- The "just wrap it in a transaction" instinct

### Why It Breaks
- Transaction holds DB locks for the duration of the HTTP call (could be seconds)
- If the HTTP call hangs, the transaction hangs — and holds locks
- Rollback can't undo the email already sent or the Stripe charge already processed

### The Fix
- Keep transactions **short and focused** — only DB writes
- Use the **Outbox Pattern** for reliable side effects without long transactions
- Use **Saga Pattern** for distributed transactions across services

### Trade-offs
| Pattern | Pro | Con |
|---|---|---|
| Single long transaction | Simple rollback logic | Lock contention, deadlocks |
| Short transactions + compensating actions | High throughput | Complex failure handling |
| Outbox pattern | Reliable event delivery | Extra table, CDC/polling overhead |
| Saga | Distributed correctness | Complex coordination logic |

### Real-World Examples
- **Stripe**: Uses idempotency keys instead of distributed transactions — each step can be safely retried
- **Uber**: Uses the Outbox pattern to guarantee that trip events are published to Kafka only after the DB write succeeds
- **Amazon**: Built the entire order fulfillment pipeline on Sagas — no global transactions across services

---

## 8. Fat Client / Overfetching

### What It Is
The server sends far more data than the client needs. The client then filters/processes locally. Common in REST APIs returning full resource representations when only a few fields are needed.

### How It Looks
```json
// Client only needs: name, price
// Server returns entire product object (50 fields, nested objects, images):
{
  "id": "...", "name": "...", "price": "...", "description": "...",
  "variants": [...], "images": [...], "metadata": {...}, ...
}
```

### Why It Happens
- Single generic REST endpoint used by many clients
- Mobile clients added later without tailoring the API
- "Return everything, the client will figure it out"

### The Fix
- **GraphQL**: Clients declare exactly which fields they need
- **Sparse fieldsets** (JSONAPI standard): `?fields[products]=name,price`
- **Backend-for-Frontend (BFF)**: Tailored API per client type (mobile, web, partner)

### Trade-offs
| Approach | Pro | Con |
|---|---|---|
| Generic REST | Simple to maintain | Overfetching, large payloads |
| GraphQL | Precise fetching | Query complexity, N+1 risk in resolvers |
| BFF | Optimized per client | More services to maintain |

### Real-World Examples
- **Netflix**: Uses a BFF pattern — mobile clients get different, slimmed-down API responses vs. Smart TV clients
- **GitHub**: Added GraphQL API v4 specifically because REST v3 returned too much data for their API consumers
- **Shopify**: Storefront API is GraphQL to give merchants fine-grained control over payload size

---

## 9. Retry Storms

### What It Is
When a downstream service is slow or failing, clients retry immediately and repeatedly — amplifying load on an already-struggling service and preventing recovery.

### How It Looks
```
# 10,000 clients all retry at the same time:
t=0s   → All 10,000 requests fail
t=1s   → All 10,000 retry simultaneously → service still overwhelmed
t=2s   → All 10,000 retry simultaneously → service still overwhelmed
# ... service can never recover
```

### Why It Happens
- Fixed retry intervals (no backoff)
- No jitter (all clients synchronized)
- Retry logic added as an afterthought

### The Fix
- **Exponential backoff**: Double the wait time on each retry
- **Jitter**: Add random delay to desynchronize clients
- **Circuit breaker**: Stop retrying entirely when failure rate is high
- **Retry budgets**: Limit retries per time window at the client level

```python
# Exponential backoff with jitter
delay = min(cap, base * 2 ** attempt) + random.uniform(0, 1)
```

### Trade-offs
| Strategy | Pro | Con |
|---|---|---|
| No retry | Simple | Single transient failure = user error |
| Fixed retry | Simple | Amplifies load during outages |
| Exponential backoff + jitter | Reduces storm | Slower recovery for individual requests |
| Circuit breaker | Prevents cascading failure | Requires tuning thresholds |

### Real-World Examples
- **Amazon**: AWS SDK implements exponential backoff with jitter by default — documented as the required pattern for all AWS service clients
- **Google**: All internal RPC frameworks enforce backoff; retry storms took down internal services before this was standardized
- **Netflix**: Hystrix (circuit breaker library) was built specifically to stop retry storms from cascading across microservices

---

## 10. Hotspot / Hot Partition

### What It Is
A disproportionate amount of traffic or data lands on a single node, shard, or partition — while others sit idle. The hot node becomes the bottleneck for the entire system.

### Why It Happens
- Poor partition key choice (e.g., partitioning by timestamp — all writes go to the "latest" shard)
- Celebrity effect: one user/item gets massive traffic
- Sequential IDs used as shard keys (monotonically increasing → always hitting the last shard)

### Examples
```
# Bad: Partition by date — all inserts hit "today's" partition
INSERT INTO events PARTITION BY date ...

# Bad: Shard by user_id, but one user generates 10,000x more events than average
```

### The Fix
- Choose **high-cardinality, uniformly distributed** shard keys (e.g., hash of user_id)
- Add **random suffix salting** to hot keys to spread across shards
- Use **adaptive sharding** to detect and split hot partitions automatically
- Apply **local caching or rate limiting** specifically for hot keys

### Trade-offs
| Strategy | Pro | Con |
|---|---|---|
| Hash-based sharding | Even distribution | Range queries span all shards |
| Range-based sharding | Efficient range scans | Hotspot risk on monotonic keys |
| Consistent hashing | Minimal resharding on node changes | Complexity |
| Key salting | Distributes hot keys | Must query all salted variants on read |

### Real-World Examples
- **DynamoDB**: Provides built-in adaptive capacity to automatically absorb hotspots; recommends against sequential or low-cardinality partition keys
- **Cassandra**: Token-aware load balancing distributes partition-key-based requests, but poor key design still causes hotspots
- **Twitter**: "Trending topics" and celebrity tweets cause celebrity hotspots; handled with caching and fan-out-on-read strategies

---

## Quick Reference: Antipattern Detection Cheat Sheet

| Symptom | Likely Antipattern |
|---|---|
| DB CPU spikes when listing resources | N+1 Query |
| Response time grows linearly with data size | Unbounded result sets |
| Latency = sum of many small service calls | Chatty I/O |
| P99 latency >> P50 latency on writes | Blocking non-critical work |
| Load spikes after cache expiry | Cache stampede |
| DB connection pool exhausted on job workers | DB as message queue |
| Deadlocks correlating with external API calls | Long transactions |
| Mobile app slow on slow networks | Overfetching |
| Downstream service can't recover from outage | Retry storms |
| One DB shard at 100%, others at 5% | Hot partition |

---

## Summary

Performance antipatterns share a common theme: **they work at small scale and fail at large scale**. The most dangerous ones are invisible until they cause incidents in production.

The key mindset shift:
- **Think in loops**: If something runs once it's fine. If it runs N times, question every I/O call inside it.
- **Think in growth**: What does this query look like with 1000x the data?
- **Think in contention**: What happens when 1000 clients do this simultaneously?
- **Measure before optimizing**: Use query analyzers, tracing, and profiling to confirm the antipattern before fixing it.