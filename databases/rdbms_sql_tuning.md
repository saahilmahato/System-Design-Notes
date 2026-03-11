# RDBMS: SQL Tuning

## Table of Contents
1. [Overview](#overview)
2. [Query Execution Pipeline](#query-execution-pipeline)
3. [Indexing Strategies](#indexing-strategies)
4. [Query Optimization Techniques](#query-optimization-techniques)
5. [Schema Design for Performance](#schema-design-for-performance)
6. [EXPLAIN / Query Plans](#explain--query-plans)
7. [Connection & Resource Management](#connection--resource-management)
8. [Partitioning](#partitioning)
9. [Caching Layers](#caching-layers)
10. [Trade-offs](#trade-offs)
11. [Real-World Systems & Applications](#real-world-systems--applications)
12. [Anti-Patterns](#anti-patterns)
13. [Monitoring & Metrics](#monitoring--metrics)
14. [Quick Reference](#quick-reference)

---

## Overview

SQL tuning is the process of improving database query performance by analyzing execution plans, optimizing schema design, leveraging indexes, and configuring the database engine. In high-traffic systems, unoptimized queries are among the most common causes of scalability bottlenecks.

**Primary Goals:**
- Reduce query execution time (latency)
- Reduce resource consumption (CPU, memory, I/O)
- Increase throughput (queries per second)
- Avoid full table scans on large datasets
- Minimize lock contention

---

## Query Execution Pipeline

Understanding *how* a query executes is fundamental to tuning it.

```
SQL Query
    │
    ▼
┌─────────────────────────────────────────┐
│           Parser                        │  → Syntax validation, parse tree
├─────────────────────────────────────────┤
│           Rewriter / Analyzer           │  → Semantic checks, view expansion
├─────────────────────────────────────────┤
│           Query Planner / Optimizer     │  → Generates candidate plans,
│                                         │    estimates costs via statistics
├─────────────────────────────────────────┤
│           Executor                      │  → Fetches pages, applies operators
└─────────────────────────────────────────┘
    │
    ▼
Result Set
```

The **Query Optimizer** is the most critical component — it chooses *how* to execute a query (join order, index usage, scan type) based on table statistics. Stale statistics lead to bad plans.

**Key Optimizer Statistics:**
- Row count per table
- Column cardinality (number of distinct values)
- Data distribution histograms
- Index selectivity

```sql
-- PostgreSQL: Refresh statistics manually
ANALYZE table_name;

-- MySQL: Update statistics
ANALYZE TABLE table_name;
```

---

## Indexing Strategies

Indexes are the single most impactful tuning lever. They trade write overhead and storage for read speed.

### Index Types

| Index Type | Use Case | Engine Support |
|---|---|---|
| **B-Tree** | Range queries, equality, ORDER BY | PostgreSQL, MySQL (default) |
| **Hash** | Exact equality lookups only | PostgreSQL, MySQL (Memory engine) |
| **GIN** | Full-text search, array/JSONB columns | PostgreSQL |
| **GiST** | Geospatial, fuzzy matching | PostgreSQL |
| **Partial Index** | Index subset of rows | PostgreSQL |
| **Covering Index** | Include all query columns | PostgreSQL, MySQL |
| **Composite Index** | Multi-column filtering | All major RDBMS |
| **Bitmap Index** | Low-cardinality columns, analytics | Oracle, PostgreSQL (internally) |
| **Function-based Index** | Expressions, computed values | PostgreSQL, Oracle |

---

### B-Tree Index: The Workhorse

```
                  [40 | 70]
                 /    |    \
          [10|20]  [50|60]  [80|90]
           /  \    /   \    /   \
         [5] [15] [45] [55] [75] [85]
```

Supports: `=`, `<`, `>`, `<=`, `>=`, `BETWEEN`, `LIKE 'prefix%'`

Does NOT help with: `LIKE '%suffix'`, `LIKE '%middle%'`, `NOT IN`, function on indexed column

---

### Composite Index & Column Order

The **leftmost prefix rule** governs composite index usage:

```sql
-- Index: (last_name, first_name, birth_date)
CREATE INDEX idx_user ON users(last_name, first_name, birth_date);

-- ✅ Uses index (full)
SELECT * FROM users WHERE last_name='Smith' AND first_name='John' AND birth_date='1990-01-01';

-- ✅ Uses index (partial - leftmost prefix)
SELECT * FROM users WHERE last_name='Smith' AND first_name='John';

-- ✅ Uses index (leftmost column only)
SELECT * FROM users WHERE last_name='Smith';

-- ❌ SKIPS leading column — index NOT used
SELECT * FROM users WHERE first_name='John';

-- ❌ SKIPS leading column — index NOT used
SELECT * FROM users WHERE birth_date='1990-01-01';
```

**Rule:** Always put the most selective / most frequently filtered column first.

---

### Covering Index (Index-Only Scan)

A covering index contains **all columns** needed by a query, eliminating heap fetches entirely.

```sql
-- Query
SELECT user_id, email FROM orders WHERE status = 'pending';

-- Without covering index: index scan → heap fetch for each row
-- With covering index: index-only scan (no heap access)
CREATE INDEX idx_orders_covering ON orders(status) INCLUDE (user_id, email);
-- PostgreSQL: INCLUDE clause for non-key columns
-- MySQL: list all columns in index definition
```

---

### Partial Index

Index only the rows you actually query — dramatically smaller, faster index.

```sql
-- Only index active users (99% of queries filter active=true)
CREATE INDEX idx_active_users ON users(email) WHERE active = true;

-- Only index unfulfilled orders
CREATE INDEX idx_pending_orders ON orders(created_at) WHERE status = 'pending';
```

---

### Function-Based Index

```sql
-- Query uses LOWER() — regular index on email won't help
SELECT * FROM users WHERE LOWER(email) = 'john@example.com';

-- Solution: index the expression
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
```

---

### Index Selectivity

Selectivity = distinct values / total rows. Higher selectivity → more useful index.

```sql
-- Check cardinality of a column (PostgreSQL)
SELECT n_distinct FROM pg_stats WHERE tablename='orders' AND attname='status';

-- Low selectivity (bad index candidate): status has 3 values in 10M rows
-- High selectivity (great index candidate): user_id has 5M distinct values
```

**Rule of thumb:** Index columns with > 5-10% distinct value ratio. For lower-cardinality columns, use partial indexes or composite indexes.

---

## Query Optimization Techniques

### 1. Avoid SELECT *

```sql
-- ❌ Fetches all columns, defeats covering indexes
SELECT * FROM orders WHERE user_id = 123;

-- ✅ Fetch only what you need
SELECT order_id, status, total_amount FROM orders WHERE user_id = 123;
```

### 2. Avoid Functions on Indexed Columns in WHERE

```sql
-- ❌ Prevents index usage on order_date
SELECT * FROM orders WHERE YEAR(order_date) = 2024;

-- ✅ Use range instead
SELECT * FROM orders WHERE order_date >= '2024-01-01' AND order_date < '2025-01-01';

-- ❌ Breaks index
SELECT * FROM users WHERE UPPER(email) = 'USER@EXAMPLE.COM';

-- ✅ Use a function-based index OR normalize data at write time
```

### 3. Use EXISTS Instead of IN for Subqueries

```sql
-- ❌ IN with subquery: materializes the entire subquery result
SELECT * FROM orders WHERE user_id IN (SELECT user_id FROM vip_users);

-- ✅ EXISTS: short-circuits on first match
SELECT * FROM orders o
WHERE EXISTS (SELECT 1 FROM vip_users v WHERE v.user_id = o.user_id);
```

### 4. Avoid N+1 Query Problem

```sql
-- ❌ N+1: 1 query for orders + N queries for each user
orders = SELECT * FROM orders LIMIT 100;
for each order:
    user = SELECT * FROM users WHERE user_id = order.user_id;

-- ✅ JOIN: single query
SELECT o.*, u.name, u.email
FROM orders o
JOIN users u ON o.user_id = u.user_id
LIMIT 100;
```

### 5. Efficient Pagination

```sql
-- ❌ OFFSET is slow — must scan and discard all preceding rows
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20 OFFSET 10000;

-- ✅ Keyset / Cursor-based pagination (constant time)
SELECT * FROM orders
WHERE created_at < '2024-03-01T10:00:00'  -- last seen cursor
ORDER BY created_at DESC
LIMIT 20;
```

### 6. Use UNION ALL Instead of UNION

```sql
-- ❌ UNION: performs deduplication (sort + scan)
SELECT user_id FROM buyers UNION SELECT user_id FROM sellers;

-- ✅ UNION ALL: no dedup, faster when duplicates are acceptable or impossible
SELECT user_id FROM buyers UNION ALL SELECT user_id FROM sellers;
```

### 7. Batch INSERTs / UPDATEs

```sql
-- ❌ Individual inserts: one transaction per row
INSERT INTO events VALUES (1, 'click', NOW());
INSERT INTO events VALUES (2, 'view', NOW());
-- (thousands of times)

-- ✅ Batched insert: single round-trip
INSERT INTO events (id, type, created_at) VALUES
  (1, 'click', NOW()),
  (2, 'view', NOW()),
  (3, 'purchase', NOW());
-- Or use COPY (PostgreSQL) for bulk loading: orders of magnitude faster
COPY events FROM '/tmp/events.csv' CSV;
```

### 8. Limit JOIN Fan-out

```sql
-- ❌ Joining on non-unique column causes row multiplication
SELECT u.name, o.order_id, p.product_name
FROM users u
JOIN orders o ON u.user_id = o.user_id        -- 1-to-many
JOIN order_items oi ON o.order_id = oi.order_id -- 1-to-many
JOIN products p ON oi.product_id = p.product_id; -- potential explosion

-- ✅ Pre-aggregate before joining, or use EXISTS / subqueries
-- ✅ Always verify expected cardinality in EXPLAIN output
```

### 9. Short-Circuit with Early Filtering (Predicate Pushdown)

```sql
-- Push filters as early as possible in the pipeline
-- ✅ Filter BEFORE join
SELECT u.name, order_counts.cnt
FROM users u
JOIN (
    SELECT user_id, COUNT(*) AS cnt
    FROM orders
    WHERE status = 'completed'     -- filter BEFORE aggregation
    GROUP BY user_id
) order_counts ON u.user_id = order_counts.user_id;
```

### 10. Use CTEs Wisely (Optimization Fence Awareness)

```sql
-- In PostgreSQL < 12, CTEs are optimization fences (always materialized)
-- In PostgreSQL >= 12, CTEs are inlined by default unless MATERIALIZED is specified

-- ❌ Unintentional fence in older PG: CTE runs fully even if outer query filters
WITH all_orders AS (SELECT * FROM orders)
SELECT * FROM all_orders WHERE user_id = 123;

-- ✅ Use subquery or ensure PG >= 12
SELECT * FROM (SELECT * FROM orders) AS all_orders WHERE user_id = 123;
```

---

## Schema Design for Performance

### Normalization vs. Denormalization

| Approach | Pros | Cons |
|---|---|---|
| **Normalized (3NF)** | Minimal redundancy, easy updates | More JOINs, slower reads |
| **Denormalized** | Fewer JOINs, faster reads | Data redundancy, harder updates |

**Strategy:** Start normalized. Denormalize only specific hot-path read queries when JOINs become a bottleneck (measure first).

### Data Types Matter

```sql
-- ❌ Using VARCHAR for status (wastes storage, slower comparisons)
status VARCHAR(20)

-- ✅ Use ENUM or TINYINT (1 byte vs. 20 bytes)
status ENUM('pending', 'active', 'cancelled')

-- ❌ Storing IDs as VARCHAR
user_id VARCHAR(36)  -- UUID as string: 36 bytes

-- ✅ Store UUID as binary
user_id BINARY(16)   -- 16 bytes, faster comparisons

-- ❌ DATETIME for timestamps (no timezone)
created_at DATETIME

-- ✅ TIMESTAMPTZ or BIGINT (epoch ms)
created_at TIMESTAMPTZ   -- PostgreSQL
created_at BIGINT        -- epoch millis: portable, sortable, indexable
```

### Avoiding Hot Spots (UUID vs. Sequential IDs)

```
Sequential INT PK:        UUID PK (random):
┌──────────────────┐      ┌──────────────────┐
│ 1, 2, 3, 4, 5...│      │ Inserts scattered │
│ Inserts always   │      │ across B-tree →   │
│ append to end    │      │ Page splits,      │
│ → Fast inserts   │      │ fragmentation     │
└──────────────────┘      └──────────────────┘

Solution: UUID v7 (time-ordered) or ULID — random uniqueness + sequential ordering
```

---

## EXPLAIN / Query Plans

`EXPLAIN` reveals how the database will execute a query. It's the most essential tuning tool.

```sql
-- PostgreSQL: EXPLAIN with actual runtime statistics
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) 
SELECT * FROM orders WHERE user_id = 123 AND status = 'pending';
```

### Reading an EXPLAIN Output

```
Nested Loop  (cost=0.42..1234.56 rows=10 width=128) (actual time=0.123..4.567 rows=8 loops=1)
  ->  Index Scan using idx_orders_user on orders
        Index Cond: (user_id = 123)
        Filter: (status = 'pending')
        Rows Removed by Filter: 42
  ->  Index Scan using users_pkey on users
        Index Cond: (user_id = orders.user_id)
```

### Key Fields to Watch

| Field | What It Tells You |
|---|---|
| **Seq Scan** | Full table scan — usually bad on large tables |
| **Index Scan** | Uses index, fetches from heap |
| **Index Only Scan** | Covering index hit — ideal |
| **Nested Loop** | Good for small outer sets |
| **Hash Join** | Good for larger sets |
| **Merge Join** | Good for pre-sorted inputs |
| **rows estimate vs. actual** | Large divergence = stale statistics |
| **Buffers: shared hit/read** | Cache hits vs. disk reads |
| **cost=X..Y** | Estimated startup cost..total cost |

### Red Flags in EXPLAIN

```
❌ Seq Scan on large table         → Add/fix index
❌ rows=1 estimated, actual=100000 → Run ANALYZE, check statistics
❌ Hash Batches > 1                → Insufficient work_mem
❌ Nested Loop on large outer set  → Consider Hash Join hints or restructure
❌ Sort (disk)                     → Increase work_mem or add covering index for ORDER BY
```

---

## Connection & Resource Management

### Connection Pooling

Each DB connection consumes memory (~5-10MB in PostgreSQL). At scale, direct connections become the bottleneck.

```
Application Servers
  [App1] [App2] [App3] [App4] ... [AppN]
      \      \     |     /       /
       ────────────────────────
              Connection Pool
              (PgBouncer / ProxySQL)
              ────────────────────────
                     │
              PostgreSQL / MySQL
              (limited connections)
```

| Pooler | Mode | Best For |
|---|---|---|
| **PgBouncer** | Transaction-level pooling | PostgreSQL, high concurrency |
| **ProxySQL** | Query routing + pooling | MySQL, read/write split |
| **pgpool-II** | Connection pooling + HA | PostgreSQL with replication |
| **RDS Proxy** | Managed pooling | AWS Aurora/RDS |

**Transaction pooling** (PgBouncer default) — connection returned to pool after each transaction. Most efficient but incompatible with session-level features (prepared statements per-session, advisory locks).

### Key Configuration Parameters

```ini
# PostgreSQL postgresql.conf

# Memory
shared_buffers = 25% of RAM          # Buffer pool for frequently accessed pages
effective_cache_size = 75% of RAM    # Hint to planner about OS cache
work_mem = 4MB-256MB                 # Per-sort/hash operation (careful: per operation)
maintenance_work_mem = 1GB           # For VACUUM, CREATE INDEX, etc.

# Parallelism
max_parallel_workers_per_gather = 4  # Parallel query workers
max_worker_processes = 8

# WAL / Write Performance
wal_buffers = 64MB
checkpoint_completion_target = 0.9
synchronous_commit = off             # Async commits (risk: lose last ~100ms of data on crash)

# Connection
max_connections = 200                # Keep low; use PgBouncer for high concurrency
```

```ini
# MySQL my.cnf
innodb_buffer_pool_size = 70-80% of RAM   # InnoDB page cache
innodb_log_file_size = 1-4GB              # Larger = better write throughput, slower recovery
innodb_flush_log_at_trx_commit = 2        # Async flush (durability trade-off)
query_cache_size = 0                      # Disable in MySQL 5.7+ (deprecated, harmful at scale)
max_connections = 500
```

---

## Partitioning

Partitioning divides a large table into smaller physical segments while maintaining a single logical table. Each partition can be queried, indexed, and maintained independently.

### Partition Types

```
Range Partitioning (by date):
┌─────────────┬─────────────┬─────────────┬─────────────┐
│  orders_Q1  │  orders_Q2  │  orders_Q3  │  orders_Q4  │
│ Jan-Mar 2024│ Apr-Jun 2024│ Jul-Sep 2024│ Oct-Dec 2024│
└─────────────┴─────────────┴─────────────┴─────────────┘

List Partitioning (by region):
┌────────────┬────────────┬────────────┬────────────┐
│  orders_US │  orders_EU │  orders_AP │  orders_LA │
└────────────┴────────────┴────────────┴────────────┘

Hash Partitioning (by user_id mod N):
┌────────────┬────────────┬────────────┬────────────┐
│  shard_0   │  shard_1   │  shard_2   │  shard_3   │
│ id % 4 = 0 │ id % 4 = 1 │ id % 4 = 2 │ id % 4 = 3 │
└────────────┴────────────┴────────────┴────────────┘
```

```sql
-- PostgreSQL declarative partitioning (range on date)
CREATE TABLE orders (
    order_id BIGINT,
    user_id  BIGINT,
    status   TEXT,
    created_at TIMESTAMPTZ
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2024_q1 PARTITION OF orders
    FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');

CREATE TABLE orders_2024_q2 PARTITION OF orders
    FOR VALUES FROM ('2024-04-01') TO ('2024-07-01');
```

### Benefits of Partitioning

- **Partition pruning:** queries touching only one partition skip all others
- **Efficient VACUUM:** archive old partitions, drop entire partition instead of DELETE
- **Parallel I/O:** different partitions can be on different tablespaces/disks
- **Index size:** per-partition indexes are smaller → faster lookups

### Partition Pruning Example

```sql
-- Query automatically prunes to orders_2024_q1 partition only
SELECT * FROM orders WHERE created_at BETWEEN '2024-01-01' AND '2024-03-31';

-- EXPLAIN will show: "Partitions: orders_2024_q1"
-- orders_2024_q2, q3, q4 are never touched
```

---

## Caching Layers

SQL tuning alone can only go so far. Layered caching eliminates database load entirely for repeated reads.

```
                        Request
                           │
              ┌────────────▼──────────────┐
              │    Application Cache       │   → In-process cache (Guava, Caffeine)
              │    (L1: in-memory)         │     Hit rate: ~microseconds
              └────────────┬──────────────┘
                           │ MISS
              ┌────────────▼──────────────┐
              │    Distributed Cache       │   → Redis / Memcached
              │    (L2: remote cache)      │     Hit rate: ~1ms
              └────────────┬──────────────┘
                           │ MISS
              ┌────────────▼──────────────┐
              │    Query Result Cache      │   → PostgreSQL shared_buffers
              │    (L3: DB buffer pool)    │     (~10ms if in memory)
              └────────────┬──────────────┘
                           │ MISS
              ┌────────────▼──────────────┐
              │    Disk / Storage          │   → SSD/HDD (~10-100ms)
              └───────────────────────────┘
```

### Query Result Caching Pattern

```python
def get_user_orders(user_id: int):
    cache_key = f"user_orders:{user_id}"
    
    # L2: Check Redis first
    cached = redis.get(cache_key)
    if cached:
        return deserialize(cached)
    
    # Cache miss: query database
    result = db.execute(
        "SELECT * FROM orders WHERE user_id = %s ORDER BY created_at DESC LIMIT 20",
        [user_id]
    )
    
    # Write to cache with TTL
    redis.setex(cache_key, ttl=300, value=serialize(result))
    return result
```

---

## Trade-offs

### Indexing Trade-offs

| Decision | Benefit | Cost |
|---|---|---|
| Add index on read-heavy column | Faster SELECT | Slower INSERT/UPDATE/DELETE; extra storage |
| Composite index (many columns) | Fast for specific query pattern | Not used for other patterns; maintenance overhead |
| Covering index | Eliminates heap fetches | Large index size; write amplification |
| Partial index | Tiny, fast | Only helps queries matching the partial filter |
| No index (OLAP/analytics) | Fast bulk writes | Sequential scans on large tables |

**Rule:** Every index is a write tax. Don't index columns that are rarely filtered or have very low cardinality without a partial/composite strategy.

---

### Normalization vs. Denormalization Trade-offs

| | Normalized | Denormalized |
|---|---|---|
| **Read performance** | Slower (JOINs) | Faster (fewer JOINs) |
| **Write performance** | Faster (no redundancy) | Slower (update multiple places) |
| **Data consistency** | High (single source of truth) | Risk of inconsistency |
| **Storage** | Compact | Redundant |
| **Best for** | OLTP, frequent writes | Read-heavy, analytics, OLAP |

---

### Synchronous vs. Asynchronous Commits

| | Synchronous (`fsync=on`) | Asynchronous (`synchronous_commit=off`) |
|---|---|---|
| **Durability** | Full — data survives crash | May lose ~100ms of commits |
| **Latency** | Higher (~2-10ms per commit) | Lower (~0.1ms) |
| **Throughput** | Lower | Up to 3-5x higher |
| **Use case** | Financial, billing, audit | Logging, analytics, caching tables |

---

### Pagination Trade-offs

| Method | Performance at Depth | Consistency | Implementation |
|---|---|---|---|
| **OFFSET / LIMIT** | O(n) — degrades with depth | Eventual (inserts shift pages) | Simple |
| **Keyset / Cursor** | O(1) — constant | Stable | Moderate |
| **Seek Method** | O(log n) — uses index | Stable | Complex |

---

### Partitioning Trade-offs

| Benefit | Cost |
|---|---|
| Query pruning (fast range queries) | Complex schema management |
| Fast archive/drop of old data | Cross-partition queries may be slow |
| Smaller per-partition indexes | Partition key must be chosen correctly upfront |
| Parallel I/O | Some constraint types not supported across partitions |

---

## Real-World Systems & Applications

### PostgreSQL at Shopify

- **Problem:** Orders table grew to billions of rows, query times degrading.
- **Solution:** Time-based range partitioning on `created_at`; old partitions archived to cold storage.
- **Outcome:** Query times on recent orders reduced 10x; VACUUM times dropped dramatically.
- **Lesson:** Partitioning is the most effective way to manage ever-growing transactional tables at scale.

---

### Instagram: Index Optimization

- **Problem:** Feed queries joining users, follows, and media tables were slow at 100M+ user scale.
- **Solution:** Introduced composite indexes on `(user_id, created_at DESC)` for feed generation; used covering indexes to eliminate heap fetches.
- **Outcome:** P99 feed load times went from seconds to sub-100ms.
- **Lesson:** For social graph queries, composite indexes on (entity_id, time DESC) are the dominant pattern.

---

### Airbnb: Cursor-based Pagination

- **Problem:** Search results with OFFSET-based pagination caused O(n) scans; page 5000 of listings took 30 seconds.
- **Solution:** Migrated to keyset/cursor-based pagination using a stable sort key (`(price ASC, listing_id ASC)`).
- **Outcome:** Pagination became O(log n) regardless of page depth.
- **Lesson:** OFFSET is fine for UIs that paginate < 100 pages deep; anything deeper requires cursor pagination.

---

### GitHub: Read Replicas + Connection Pooling (ProxySQL)

- **Problem:** MySQL master overwhelmed by read-heavy traffic (PR diffs, blame views, file browsing).
- **Solution:** ProxySQL routes read queries to replicas, write queries to master. PgBouncer-equivalent connection pooling reduces connection count.
- **Outcome:** Master CPU reduced by ~70%; replica read latency <5ms.
- **Lesson:** Read/write splitting is often cheaper and faster than index tuning for predominantly-read workloads.

---

### Stripe: Partial Indexes for Soft-Delete Pattern

- **Problem:** Tables with `deleted_at IS NULL` soft-delete pattern caused index bloat (index contained millions of logically-deleted rows).
- **Solution:** Partial indexes on `WHERE deleted_at IS NULL` reduced index size by 90% on high-churn tables.
- **Outcome:** Index scans 10x faster; storage reduced significantly.
- **Lesson:** Soft-delete columns are a prime candidate for partial indexes.

---

### Uber: Denormalization for Trip Data

- **Problem:** Trip queries joining drivers, riders, routes, pricing in real-time were too slow at 15M+ daily trips.
- **Solution:** Pre-computed denormalized trip summary rows written at trip completion; read path hits a single wide table.
- **Outcome:** Trip read queries dropped from 8 JOINs to 0; P99 latency reduced 20x.
- **Lesson:** For event-driven data (orders, trips, transactions) where the write path is well-defined, denormalization at write time pays for itself on the read path.

---

### Stack Overflow: Staying on SQL at Massive Scale

- **Notable:** Stack Overflow runs on a small number of highly optimized SQL Server instances serving millions of daily requests.
- **Techniques:** Aggressive indexing, careful query analysis via execution plans, result caching with Redis, query batching, and judicious schema design.
- **Lesson:** Well-tuned relational databases can scale much further than commonly assumed before requiring NoSQL or sharding.

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **SELECT \*** | Fetches unnecessary data, breaks covering indexes | Select only needed columns |
| **Implicit type conversion** | `WHERE user_id = '123'` (int vs. string) disables index | Match data types exactly |
| **OR on indexed columns** | Optimizer may not use index | Use UNION ALL instead |
| **Leading wildcard LIKE** | `LIKE '%term'` cannot use B-tree | Full-text search (GIN, Elasticsearch) |
| **OFFSET-based pagination at depth** | O(n) scan | Keyset pagination |
| **Unbounded queries** | `SELECT * FROM logs` with no LIMIT | Always add LIMIT |
| **Missing FK indexes** | JOIN on FK column does full scan | Index all FK columns |
| **Over-indexing** | Slows all writes; planner confusion | Profile and remove unused indexes |
| **Long-running transactions** | Holds locks, blocks VACUUM | Keep transactions short |
| **Using ORM without EXPLAIN** | ORM generates bad queries silently | Log and analyze slow queries |

---

## Monitoring & Metrics

### Key Metrics to Track

| Metric | Tool | Threshold / Signal |
|---|---|---|
| **Slow query log** | PostgreSQL (`log_min_duration_statement`), MySQL slow log | Any query > 100ms in OLTP |
| **Cache hit ratio** | `pg_stat_bgwriter`, `pg_statio_user_tables` | Should be > 95-99% |
| **Index hit ratio** | `pg_stat_user_indexes` | Identify unused indexes |
| **Sequential scan count** | `pg_stat_user_tables.seq_scan` | High count on large tables = missing index |
| **Lock wait time** | `pg_stat_activity`, `pg_locks` | Indicates contention |
| **Table bloat** | `pgstattuple` extension | > 20-30% = needs VACUUM |
| **Replication lag** | `pg_stat_replication` | Should be < 1s for OLTP |
| **Connection count** | `pg_stat_activity` | Should be < `max_connections * 0.8` |
| **Checkpoint frequency** | `pg_stat_bgwriter` | High checkpoint rate = increase `max_wal_size` |

### Slow Query Analysis Workflow

```
1. Enable slow query logging
   log_min_duration_statement = 100  # ms (PostgreSQL)

2. Identify top slow queries
   pg_stat_statements extension:
   SELECT query, mean_exec_time, calls, total_exec_time
   FROM pg_stat_statements
   ORDER BY mean_exec_time DESC
   LIMIT 20;

3. EXPLAIN ANALYZE each offender

4. Check for:
   - Missing indexes (Seq Scan on large table)
   - Stale statistics (row estimate divergence)
   - N+1 patterns
   - Poor join order

5. Apply fix → benchmark → compare EXPLAIN output

6. Monitor regression via dashboards (Datadog, Grafana + pg_exporter)
```

---

## Quick Reference

### SQL Tuning Decision Flowchart

```
Query is slow?
      │
      ▼
Run EXPLAIN ANALYZE
      │
      ├── Seq Scan on large table?
      │       └── Add index on filter/join columns
      │
      ├── rows estimate >> actual?
      │       └── Run ANALYZE; check statistics
      │
      ├── Hash Batches > 1?
      │       └── Increase work_mem
      │
      ├── Sort on disk?
      │       └── Add covering index with ORDER BY columns / increase work_mem
      │
      ├── Nested Loop with large outer set?
      │       └── Restructure query or hint Hash Join
      │
      ├── OFFSET-based pagination?
      │       └── Migrate to keyset pagination
      │
      └── Still slow? → Consider:
              - Read replica routing
              - Result caching (Redis)
              - Denormalization
              - Table partitioning
```

### Index Selection Cheat Sheet

```
Filter type                  →  Index strategy
─────────────────────────────────────────────────
Equality on high-cardinality →  B-tree on column
Range (dates, numbers)       →  B-tree on column
Equality + Range together    →  Composite (equality col first)
Subset of rows               →  Partial index (WHERE clause)
All cols in SELECT           →  Covering index (INCLUDE)
Full-text search             →  GIN / Full-text index
Expression / function        →  Function-based index
Low cardinality (status)     →  Partial + composite
Array / JSONB columns        →  GIN index (PostgreSQL)
Geospatial                   →  GiST / PostGIS index
```

### Essential Commands

```sql
-- Find unused indexes (PostgreSQL)
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY schemaname, tablename;

-- Find tables with high sequential scans
SELECT relname, seq_scan, idx_scan
FROM pg_stat_user_tables
WHERE seq_scan > 1000
ORDER BY seq_scan DESC;

-- Find slowest queries
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 10;

-- Identify table bloat
SELECT relname, n_dead_tup, n_live_tup,
       round(n_dead_tup::numeric/NULLIF(n_live_tup,0)*100, 2) AS dead_pct
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;

-- Force ANALYZE on specific table
ANALYZE VERBOSE orders;

-- Rebuild bloated index
REINDEX INDEX CONCURRENTLY idx_orders_user_id;
```