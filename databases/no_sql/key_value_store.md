# NoSQL: Key-Value Store

## Table of Contents
1. [What is a Key-Value Store?](#what-is-a-key-value-store)
2. [Core Architecture](#core-architecture)
3. [Data Model](#data-model)
4. [Operations](#operations)
5. [Internal Design Concepts](#internal-design-concepts)
6. [Trade-offs](#trade-offs)
7. [Consistency & Replication Models](#consistency--replication-models)
8. [Partitioning Strategies](#partitioning-strategies)
9. [Eviction Policies](#eviction-policies)
10. [When to Use vs. Avoid](#when-to-use-vs-avoid)
11. [Real-World Systems & Applications](#real-world-systems--applications)
12. [Popular Key-Value Stores Compared](#popular-key-value-stores-compared)
13. [System Design Patterns](#system-design-patterns)
14. [Anti-Patterns](#anti-patterns)
15. [Monitoring & Observability](#monitoring--observability)

---

## What is a Key-Value Store?

A **Key-Value Store** is the simplest form of NoSQL database. It stores data as a collection of key-value pairs, where a **key** is a unique identifier and a **value** is opaque data (string, blob, JSON, binary, etc.) associated with that key.

```
+-------------+--------------------------------------------+
|     KEY     |                  VALUE                     |
+-------------+--------------------------------------------+
| user:1001   | {"name": "Alice", "email": "a@example.com"}|
| session:abc | {"userId": 1001, "expires": 1700000000}     |
| cart:1001   | ["item:42", "item:87", "item:203"]          |
| rate:api:x  | 47                                         |
+-------------+--------------------------------------------+
```

The store makes no assumptions about the structure of the value — it is treated as a black box. All logic is applied at the **application layer**.

---

## Core Architecture

```
                          ┌────────────────────────────────┐
                          │         Client / App           │
                          └──────────────┬─────────────────┘
                                         │  GET / SET / DEL
                          ┌──────────────▼─────────────────┐
                          │       Key-Value Store API       │
                          │  (TCP, HTTP, Redis Protocol)    │
                          └──────────────┬─────────────────┘
                                         │
               ┌─────────────────────────▼──────────────────────────┐
               │                   Storage Engine                    │
               │  ┌──────────────┐   ┌──────────────┐               │
               │  │  In-Memory   │   │  On-Disk /   │               │
               │  │  (e.g. Hash) │   │  Persistent  │               │
               │  └──────────────┘   └──────────────┘               │
               └────────────────────────────────────────────────────┘
                                         │
               ┌─────────────────────────▼──────────────────────────┐
               │        Replication / Clustering Layer               │
               │  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
               │  │  Primary    │  │  Replica 1  │  │ Replica 2 │  │
               │  └─────────────┘  └─────────────┘  └───────────┘  │
               └────────────────────────────────────────────────────┘
```

**Core components:**
- **API Layer** — exposes GET, SET, DEL, TTL commands over TCP or HTTP
- **In-Memory Hash Table** — O(1) average lookup via hash map (RAM-backed)
- **Persistence Layer** — AOF (Append-Only File) or RDB (snapshot) for durability
- **Replication Layer** — async/sync replication to followers for HA
- **Cluster Manager** — handles sharding, failover, node membership

---

## Data Model

### Key Design
Keys are **strings** (binary-safe in Redis). Well-designed key schemas are critical for organization and avoidance of collisions.

```
Recommended key naming convention:
  {resource}:{id}:{field}

Examples:
  user:1001:profile
  user:1001:session
  product:SKU-8823:inventory
  rate_limit:user:1001:endpoint:/api/v1/orders
```

**Key length**: Keep keys short but descriptive. Long keys waste memory and increase lookup time.

### Value Types (Redis example)
| Type         | Use Case                                |
|--------------|-----------------------------------------|
| String       | Counters, simple values, JSON blobs     |
| List         | Queues, timelines, log buffers          |
| Set          | Unique tags, friend lists, deduplication|
| Sorted Set   | Leaderboards, ranked feeds, scheduling  |
| Hash         | Objects/structs with field-level access |
| Bitmap       | Feature flags, presence tracking        |
| HyperLogLog  | Approximate unique count (< 1% error)  |
| Stream       | Event log / message queue               |

---

## Operations

| Operation       | Complexity | Description                              |
|-----------------|------------|------------------------------------------|
| `GET key`       | O(1)       | Retrieve value by key                    |
| `SET key value` | O(1)       | Write or overwrite a key-value pair      |
| `DEL key`       | O(1)       | Delete a key                             |
| `EXISTS key`    | O(1)       | Check if key exists                      |
| `EXPIRE key ttl`| O(1)       | Set a TTL (time-to-live) in seconds      |
| `TTL key`       | O(1)       | Get remaining TTL                        |
| `INCR key`      | O(1)       | Atomic increment (no race condition)     |
| `MGET k1 k2...` | O(N)       | Bulk GET — reduces round trips           |
| `SCAN cursor`   | O(N)       | Iterates keys without blocking (vs KEYS) |

> **Never use `KEYS *` in production** — it blocks the single-threaded Redis event loop.

---

## Internal Design Concepts

### Hash Table (In-Memory)
The primary index is a hash map: `key → memory address of value`. Average O(1) reads/writes, O(N) worst case on hash collision chains.

### Persistence Mechanisms

**RDB (Redis Database Snapshot)**
- Periodic point-in-time snapshots written to disk
- Fast restarts, compact files
- Risk: data loss between snapshots (e.g., last 5 min of writes)

**AOF (Append-Only File)**
- Every write command appended to a log file
- Replayable on restart for full durability
- Higher disk I/O; can be configured to `fsync` every second or every write

**Hybrid (Redis 4.0+)**: AOF with embedded RDB snapshot — fast restart + full durability.

### Single-Threaded Event Loop (Redis)
Redis processes commands on a single thread (network I/O is multi-threaded since v6.0). This eliminates locking overhead and race conditions at the cost of not utilizing multi-core CPUs directly.

```
Incoming Commands → Event Queue → Single Worker Thread → Response
```

Implication: one slow command (e.g., `KEYS *`) blocks all others.

### LSM Tree (LevelDB / RocksDB)
Disk-backed KV stores use **Log-Structured Merge Trees**:
- Writes go to an in-memory memtable → flushed to SSTables on disk
- Background compaction merges SSTables
- Optimized for write-heavy workloads; reads may require multiple file lookups (mitigated by Bloom filters)

---

## Trade-offs

### Advantages

| Advantage             | Detail                                                     |
|-----------------------|------------------------------------------------------------|
| **O(1) reads/writes** | Hash map lookup; extremely low latency (sub-millisecond)   |
| **Horizontal scale**  | Easy to shard by key range or hash                         |
| **Schema-less**       | No migrations; application owns structure                  |
| **High throughput**   | Redis: 100K+ ops/sec on a single node                      |
| **TTL support**       | Native expiry; ideal for sessions, caches, rate limiters   |
| **Simplicity**        | Minimal operational overhead vs. relational databases      |

### Disadvantages

| Disadvantage                  | Detail                                                      |
|-------------------------------|-------------------------------------------------------------|
| **No query language**         | Cannot filter/aggregate values; must know the exact key     |
| **No relationships**          | No foreign keys, joins, or referential integrity            |
| **Value opacity**             | The store cannot index or search within values              |
| **Memory-bound (in-memory)**  | Dataset must fit in RAM; expensive to scale vertically      |
| **Weak consistency options**  | Async replication can lose recent writes on failover        |
| **No ACID transactions**      | Limited multi-key atomic operations (Redis MULTI is not true ACID) |
| **Key design burden**         | Data access patterns must be baked into key structure upfront |

### vs. Other Database Types

| Dimension         | Key-Value Store     | Document Store       | Relational DB         |
|-------------------|---------------------|----------------------|-----------------------|
| Data model        | Opaque blobs        | Structured documents | Tables with schema    |
| Query flexibility | Key-only            | Field-level queries  | SQL joins, aggregates |
| Write speed       | ★★★★★             | ★★★★☆              | ★★★☆☆               |
| Read by value     | ✗                   | ✓                    | ✓                     |
| Transactions      | Limited             | Limited              | Full ACID             |
| Best for          | Cache, sessions      | Content, catalogs    | Financial, relational |

---

## Consistency & Replication Models

### Replication Topologies

**Primary-Replica (Single Primary)**
- All writes go to primary; replicas are read-only
- Async replication → eventual consistency
- Failover: replica promoted on primary failure (risk: lag-based data loss)

```
  Writer ──► Primary ──(async)──► Replica 1
                     └──(async)──► Replica 2
  Reader ──────────────────────────► Replica 1
```

**Multi-Primary (Active-Active)**
- Multiple primaries accept writes (DynamoDB Global Tables, Redis Enterprise)
- Conflict resolution required (last-write-wins or vector clocks)
- Higher availability at the cost of consistency complexity

**Quorum Reads/Writes (DynamoDB / Cassandra style)**
```
N = total replicas
W = nodes that must acknowledge a write
R = nodes that must respond to a read

Strong Consistency:    R + W > N  (e.g., N=3, W=2, R=2)
Eventual Consistency:  R + W ≤ N  (e.g., N=3, W=1, R=1 → max throughput)
```

---

## Partitioning Strategies

### Hash-Based Partitioning
Key is hashed and mapped to a shard. Uniform distribution but no range queries.

```
shard_id = hash(key) % num_shards
```

Problem: Resharding on node addition/removal requires massive key remapping.

### Consistent Hashing
Keys and nodes are placed on a virtual ring. Adding/removing a node only remaps keys adjacent to that node (~1/N of total keys).

```
      0°
    ┌─────┐
    │     │
270°│     │ 90°
    │     │
    └─────┘
      180°

  Node A: 45°–135°
  Node B: 135°–225°
  Node C: 225°–45°

  key hash → position on ring → clockwise to next node
```

**Virtual nodes (vnodes)**: Each physical node owns multiple positions on the ring for better load distribution.

### Range-Based Partitioning
Keys are sorted; each shard owns a range (e.g., `A–M`, `N–Z`). Enables range scans but risks hot spots on sequential keys.

---

## Eviction Policies

When memory is full, keys must be evicted (Redis):

| Policy             | Behavior                                              |
|--------------------|-------------------------------------------------------|
| `noeviction`       | Return error on write; never evict (dangerous)        |
| `allkeys-lru`      | Evict least recently used key across all keys         |
| `volatile-lru`     | Evict LRU key among keys with TTL set                 |
| `allkeys-lfu`      | Evict least frequently used key (Redis 4.0+)          |
| `volatile-ttl`     | Evict key with shortest remaining TTL                 |
| `allkeys-random`   | Evict random key (useful for uniform access patterns) |

**Design rule:** For caching use cases, use `allkeys-lru` or `allkeys-lfu`. For mixed cache + persistent data, use `volatile-lru` with TTLs on cache-only keys.

---

## When to Use vs. Avoid

### Use Key-Value Store When:
- ✅ Caching database query results, HTML fragments, API responses
- ✅ Session management (user auth tokens, shopping cart)
- ✅ Rate limiting and request throttling (atomic INCR + TTL)
- ✅ Pub/Sub messaging or job queues (Redis Streams, Lists)
- ✅ Leaderboards and ranking (Sorted Sets)
- ✅ Feature flag storage
- ✅ Real-time counters (page views, likes, inventory)
- ✅ Distributed locks (Redis SETNX / Redlock algorithm)

### Avoid Key-Value Store When:
- ❌ You need to query by value (use Document DB or Search)
- ❌ You need complex relationships / joins (use RDBMS)
- ❌ Data must be durable and cannot fit in RAM (use RocksDB or RDBMS)
- ❌ You need full ACID multi-entity transactions (use PostgreSQL)
- ❌ Schema enforcement is required (use relational DB)

---

## Real-World Systems & Applications

### Twitter / X — Timeline Caching
- Uses Redis to cache the "home timeline" for each user
- Precomputed fan-out: when a user tweets, the tweet ID is pushed to the Redis lists of all followers
- Key: `timeline:{user_id}` → Value: sorted list of tweet IDs
- Removes need to run expensive fan-out queries on read

### GitHub — Rate Limiting
- Uses Redis `INCR` + `EXPIRE` for API rate limiting
- Key: `rate_limit:{api_token}:{window}`
- Atomic increment ensures no race conditions under high concurrency
- TTL-based automatic window reset

### Uber — Geospatial Indexing (Surge Pricing)
- Uses Redis `GEO` commands to store and query driver locations
- Key: `drivers:city:{city_id}` → sorted set of (driver_id, lat/lon)
- `GEORADIUS` finds nearby drivers in real-time at O(N+log M) complexity

### Discord — Online Presence
- Stores user presence state (`online`, `idle`, `offline`) in Redis
- Key: `presence:{user_id}` with TTL; heartbeat resets TTL
- Millions of concurrent users tracked with sub-millisecond reads

### Amazon DynamoDB — Shopping Cart
- Amazon's own shopping cart was one of the original motivations for Dynamo (the research paper behind DynamoDB)
- Cart stored as a single key-value entry per user: `cart:{user_id}` → serialized cart object
- Designed for eventual consistency + high availability over strict consistency

### Netflix — EVCache
- Custom Redis-backed distributed cache built on top of Memcached/Redis
- Stores encoded video metadata, user preferences, A/B test bucket assignments
- Deployed across multiple AWS regions; provides low-latency reads globally

### Shopify — Session Storage
- Uses Redis to store Shopify merchant and customer sessions
- TTL-based expiry aligns with session timeout policies
- Enables horizontal scaling of stateless web servers

### Airbnb — Search Cache
- Caches search result pages in Redis to reduce PostgreSQL load
- Key structured around search parameters (location, dates, filters)
- Cache invalidated on new listing data

---

## Popular Key-Value Stores Compared

| Feature              | Redis            | Memcached        | DynamoDB           | RocksDB           | etcd              |
|----------------------|------------------|------------------|--------------------|-------------------|-------------------|
| **Storage**          | In-memory + disk | In-memory only   | SSD (managed)      | Disk (LSM tree)   | Disk (BoltDB)     |
| **Data types**       | Rich (10+ types) | String only      | String, Number, Map| String/bytes      | String only       |
| **Persistence**      | Yes (RDB + AOF)  | No               | Yes (managed)      | Yes               | Yes               |
| **Replication**      | Primary-replica  | Client-side      | Multi-region       | Manual            | Raft consensus    |
| **Clustering**       | Redis Cluster    | Client sharding  | Fully managed      | Embedded lib      | Native cluster    |
| **Transactions**     | Limited (MULTI)  | No               | Conditional writes | No                | MVCC              |
| **Pub/Sub**          | Yes              | No               | DynamoDB Streams   | No                | Watch API         |
| **Best for**         | General caching, queues | Simple cache | Serverless, AWS   | Storage engines   | Distributed config|
| **Latency**          | <1ms             | <1ms             | Single-digit ms    | 1–10ms            | Low               |

---

## System Design Patterns

### Cache-Aside (Lazy Loading)
```
App checks cache → Miss → App queries DB → App writes to cache → Return to user
App checks cache → Hit → Return from cache
```
- Most common pattern
- Cache only holds what's been requested
- Risk: cache stampede on cold start (many simultaneous misses)

### Write-Through
```
App writes to cache → Cache synchronously writes to DB → Acknowledge
```
- Cache always in sync with DB
- Higher write latency
- No stale reads

### Write-Behind (Write-Back)
```
App writes to cache → Acknowledge immediately → Cache async writes to DB
```
- Lowest write latency
- Risk: data loss if cache crashes before flush

### Read-Through
```
App reads from cache → Miss → Cache fetches from DB → Cache stores result → Return
```
- Cache manages DB read logic transparently
- Simpler application code

### Distributed Lock (Redlock Algorithm)
```python
# Acquire lock
SET resource_lock:{id} {token} NX PX 30000  # NX = only if not exists, PX = expire in 30s

# Release lock (Lua script for atomicity)
if GET resource_lock:{id} == token:
    DEL resource_lock:{id}
```
- Used for distributed mutual exclusion
- TTL prevents deadlock if lock holder crashes

### Rate Limiter (Token Bucket via Redis)
```
INCR rate:{user_id}:{window}
EXPIRE rate:{user_id}:{window} {window_seconds}  # only sets if not exists pattern

if count > limit:
    return 429 Too Many Requests
```

---

## Anti-Patterns

| Anti-Pattern                    | Problem                                        | Fix                                        |
|---------------------------------|------------------------------------------------|--------------------------------------------|
| **Using `KEYS *`**              | Blocks entire Redis event loop in prod         | Use `SCAN` with cursor                     |
| **Storing everything in Redis** | Memory exhaustion, high cost                   | Only cache hot data; set TTLs              |
| **No TTLs on cache keys**       | Memory leak; stale data accumulates            | Always set TTL for transient data          |
| **Giant values (>1MB)**         | Serialization cost, slow network, OOM risk     | Split or reference from object storage     |
| **Hotspot keys**                | Single shard overwhelmed (e.g., viral content) | Add local cache, key suffix sharding       |
| **No eviction policy**          | Redis returns errors when memory full          | Set appropriate eviction policy            |
| **Key namespace collisions**    | Unpredictable overwrites across services       | Use namespaced key schema with prefixes    |
| **Synchronous cache warming**   | Thundering herd on deploy/restart              | Pre-warm cache or use probabilistic early expiry |
| **Using cache as primary store**| Data loss on eviction or cache flush           | Cache should only be a read-through layer  |

---

## Monitoring & Observability

### Key Metrics to Track

| Metric                  | What it Reveals                                      |
|-------------------------|------------------------------------------------------|
| **Cache hit rate**      | `hits / (hits + misses)` — should be > 90% for caches |
| **Memory usage**        | Used vs max memory; triggers eviction or OOM         |
| **Evictions/sec**       | High evictions = memory pressure; increase capacity  |
| **Commands/sec**        | Throughput; detect traffic spikes                    |
| **Latency (p99)**       | Tail latency; detect slow commands                   |
| **Replication lag**     | Replica falling behind primary; staleness risk       |
| **Connected clients**   | Connection pool exhaustion                           |
| **Keyspace size**       | Total key count; validate key expiry is working      |
| **Blocked clients**     | Clients waiting on blocking commands (BLPOP, etc.)   |

### Redis-Specific Commands
```bash
INFO stats           # Throughput, hits, misses, evictions
INFO memory          # Memory usage breakdown
INFO replication     # Primary/replica lag
SLOWLOG GET 10       # Last 10 slow commands
MONITOR              # Real-time command stream (never in prod)
CLIENT LIST          # Active connections
```

---

## Summary Decision Framework

```
Need sub-millisecond reads/writes?
  └── Yes → Consider Key-Value Store
        │
        ├── Data fits in RAM + persistence needed?
        │     └── Redis (in-memory + AOF/RDB)
        │
        ├── Simple string cache, no persistence?
        │     └── Memcached
        │
        ├── Need serverless/managed + massive scale?
        │     └── DynamoDB (AWS) / Bigtable (GCP)
        │
        ├── Need strong consistency + distributed config?
        │     └── etcd / ZooKeeper
        │
        └── Need disk-based KV as storage engine?
              └── RocksDB (embedded in Kafka, TiKV, etc.)

Need queries by value, joins, or ACID?
  └── Do NOT use a Key-Value Store alone
        └── Pair with PostgreSQL / Elasticsearch / Cassandra
```