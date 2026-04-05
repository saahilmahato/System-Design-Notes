# Performance Antipattern: Monolithic Persistence

---

## 1. What Is It?

**Monolithic persistence** is the antipattern where an application uses a **single database technology** (almost always a relational RDBMS) for **all of its data storage needs**, regardless of whether that technology is the right fit for each use case.

It stems from the default engineering instinct: *"We already have PostgreSQL — just put it in there."*

The database becomes a catch-all store for:
- Transactional business data (orders, users, payments)
- Session state and temporary tokens
- Search indices and full-text queries
- Time-series metrics and telemetry
- Document-style blobs (JSON configs, rich content)
- Graph relationships (friend networks, recommendations)
- Caches and computed aggregates

Each of these workloads has fundamentally different access patterns, consistency requirements, and performance characteristics — a relational database handles some well and others poorly.

---

## 2. Root Causes

| Cause | Description |
|---|---|
| **Familiarity bias** | Teams default to SQL because they know it |
| **Operational simplicity** | One database = one backup plan, one DBA, one monitoring stack |
| **Early-stage shortcuts** | "We'll fix it later" — and later never comes |
| **Organisational inertia** | Existing infrastructure, licensing, and tooling lock-in |
| **Premature normalization** | Trying to fit document or graph data into relational schemas |
| **Lack of ownership boundaries** | No service/team owns a data domain, so everything piles into the shared DB |

---

## 3. How It Manifests

### 3.1 Symptom: The Overloaded Schema

```
users            → relational (joins, ACID)
user_sessions    → should be Redis (TTL, fast reads)
audit_logs       → should be append-only log store / S3
product_search   → should be Elasticsearch
metrics          → should be InfluxDB / Prometheus
recommendations  → should be graph DB (Neo4j)
uploaded_files   → BLOBs in DB instead of object store (S3)
```

All living inside one PostgreSQL/MySQL instance.

### 3.2 Symptom: Performance Degradation Patterns

```
┌────────────────────────────────────────────────────────────┐
│                    Single RDBMS                            │
│                                                            │
│  OLTP Queries   ──► Row-level locks                        │
│  Analytical     ──► Full table scans, CPU spikes           │
│  Full-text      ──► LIKE '%..%' queries, no index benefit  │
│  Session reads  ──► High-frequency tiny reads, pool churn  │
│  Blob storage   ──► Disk I/O saturation                    │
│                                                            │
│  Result: everything slows down together                    │
└────────────────────────────────────────────────────────────┘
```

### 3.3 Symptom: Scaling Dead Ends

- Can't scale reads for one workload without scaling all
- Can't tune the database for one pattern (e.g., write-heavy logs) without hurting another (e.g., read-heavy OLTP)
- Vertical scaling hits hardware limits fast
- Sharding a monolithic schema is painful and error-prone

---

## 4. The Right Model — Polyglot Persistence

The solution is **polyglot persistence**: choosing the right storage technology for each data domain based on its access pattern, consistency requirements, and query shape.

```
┌──────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
└───────┬───────────┬──────────┬──────────┬─────────┬──────────┘
        │           │          │          │         │
        ▼           ▼          ▼          ▼         ▼
  ┌──────────┐ ┌────────┐ ┌────────┐ ┌───────┐ ┌────────┐
  │PostgreSQL│ │ Redis  │ │  ES    │ │  S3   │ │Influx  │
  │(OLTP,    │ │(session│ │(search │ │(blobs,│ │(metrics│
  │ orders,  │ │ cache, │ │ full   │ │ files,│ │ time-  │
  │ users)   │ │ queues)│ │ text)  │ │ media)│ │ series)│
  └──────────┘ └────────┘ └────────┘ └───────┘ └────────┘
```

### 4.1 Storage Technology Selection Matrix

| Data Type | Access Pattern | Recommended Store | Why |
|---|---|---|---|
| Transactional records | ACID, joins, constraints | PostgreSQL, MySQL | Strong consistency, relational integrity |
| Session / auth tokens | High-freq reads, TTL | Redis, Memcached | In-memory speed, native TTL |
| Full-text search | Keyword, fuzzy, faceted | Elasticsearch, Solr | Inverted index, relevance scoring |
| Time-series metrics | Append-only, time range | InfluxDB, TimescaleDB, Prometheus | Optimized for time-range scans |
| Documents / configs | Schema-flexible reads | MongoDB, DynamoDB, Couchbase | Native JSON, flexible schema |
| Graph relationships | Traversals, hops | Neo4j, Amazon Neptune | Graph-native traversals |
| Files / media / blobs | Large sequential reads | S3, GCS, Azure Blob | Cheap, durable, CDN-friendly |
| Event streams / logs | Append, replay, fan-out | Kafka, Kinesis, Pulsar | Log-structured, high throughput |
| Geospatial | Radius, bounding box | PostGIS, MongoDB Geo | Spatial indices (R-tree, Geohash) |
| Leaderboards / rankings | Sorted set ops | Redis Sorted Sets | O(log N) rank operations |

---

## 5. Trade-offs

### 5.1 Monolithic Persistence

| Dimension | Pro | Con |
|---|---|---|
| **Operational complexity** | ✅ One system to operate, monitor, back up | ❌ Single point of failure and saturation |
| **Developer experience** | ✅ Familiar SQL, one connection string | ❌ Forces unnatural schema for non-relational data |
| **Consistency** | ✅ Cross-entity ACID transactions trivially | ❌ Can't use eventually-consistent stores where appropriate |
| **Scalability** | ✅ Simple at small scale | ❌ Vertical scaling ceiling; hard to shard selectively |
| **Performance** | ✅ Good for relational workloads | ❌ Wrong engine for many patterns (search, time-series, graph) |
| **Cost** | ✅ Low licensing/infra cost initially | ❌ Expensive over-provisioning as scale grows |

### 5.2 Polyglot Persistence

| Dimension | Pro | Con |
|---|---|---|
| **Performance** | ✅ Each store optimized for its workload | ❌ N systems to tune and monitor |
| **Scalability** | ✅ Scale each store independently | ❌ Distributed transactions become hard |
| **Flexibility** | ✅ Right tool for the right job | ❌ Schema/data sync across stores is complex |
| **Consistency** | ✅ Tune per domain (strong vs. eventual) | ❌ Cross-store consistency requires Saga / Outbox patterns |
| **Operational overhead** | ❌ Multiple databases, backup policies, expertise | ✅ Teams own their data domains |
| **Data duplication** | ❌ Same data in multiple stores (e.g., user in PG and ES) | ✅ Denormalized reads are fast |

### 5.3 Key Tension

> **Simplicity vs. Fitness-for-purpose.** Monolithic persistence wins early. Polyglot persistence wins at scale. The inflection point depends on traffic, team size, and query diversity — but it typically arrives sooner than teams expect.

---

## 6. Specific Anti-patterns Within Monolithic Persistence

### 6.1 BLOB Storage in the Database
Storing images, PDFs, or large JSON payloads in `BYTEA` / `LONGBLOB` columns.

**Problem:** Saturates I/O, balloons backup size, prevents CDN delivery.  
**Fix:** Store in S3/GCS; store only the URL/key in the DB.

### 6.2 Full-text Search with LIKE
```sql
SELECT * FROM products WHERE description LIKE '%wireless headphones%';
```
**Problem:** Sequential scan; no relevance scoring; can't handle typos or synonyms.  
**Fix:** Elasticsearch / OpenSearch with inverted index.

### 6.3 Time-series in Relational Tables
```sql
INSERT INTO metrics (host, metric, value, ts) VALUES (...);
SELECT * FROM metrics WHERE ts BETWEEN ... AND ...;
```
**Problem:** Row-per-event creates billions of rows; range scans are slow without specialized storage.  
**Fix:** InfluxDB, TimescaleDB (hypertables), or Prometheus.

### 6.4 Session State in the DB
```sql
SELECT * FROM sessions WHERE token = ? AND expires_at > NOW();
```
**Problem:** High-frequency reads on a persistent store; connection pool pressure.  
**Fix:** Redis with `SETEX` (TTL-native, sub-millisecond reads).

### 6.5 Graph Traversals via Recursive CTEs
```sql
WITH RECURSIVE friends AS (
  SELECT user_id FROM connections WHERE source = ?
  UNION ALL
  SELECT c.user_id FROM connections c JOIN friends f ON c.source = f.user_id
)
SELECT * FROM friends;
```
**Problem:** Exponential query cost for deeper traversals.  
**Fix:** Neo4j or Amazon Neptune for relationship-heavy workloads.

### 6.6 Using the Database as a Message Queue
```sql
SELECT * FROM jobs WHERE status = 'pending' LIMIT 1 FOR UPDATE SKIP LOCKED;
```
**Problem:** Polling creates constant load; hard to fan-out; no replay semantics.  
**Fix:** RabbitMQ, Kafka, or SQS for async work dispatch.

---

## 7. Migration Strategy: Moving Away from Monolithic Persistence

### Step 1 — Identify Workload Profiles
Categorize all tables/queries by:
- Read/write ratio
- Latency requirements
- Query shape (point lookup vs. range vs. search vs. graph)
- Consistency requirements

### Step 2 — Strangle the Monolith
Apply the **Strangler Fig** pattern: introduce new stores incrementally, without a big-bang rewrite.

```
Phase 1: Sessions → Redis (no schema change needed, transparent swap)
Phase 2: Search → Elasticsearch (sync via CDC from PG)
Phase 3: Files → S3 (migrate BLOBs, update references)
Phase 4: Metrics → InfluxDB (new pipeline; old data archived)
```

### Step 3 — Dual-Write / CDC During Transition
Use **Change Data Capture (CDC)** (e.g., Debezium) to stream changes from the existing RDBMS into new stores without changing application code first.

```
PostgreSQL → Debezium → Kafka → Elasticsearch Consumer
                              → Redis Consumer
                              → Analytics Consumer
```

### Step 4 — Validate and Cut Over
- Shadow reads from the new store; compare results with the old store
- Gradually shift read traffic (1% → 10% → 100%)
- Remove the old code paths

### Step 5 — Handle Cross-Store Consistency
Adopt **Saga** or **Outbox** patterns to coordinate writes across multiple stores without distributed transactions.

```
Outbox Pattern:
  Write to PostgreSQL + outbox table (atomic, single transaction)
  Relay reads outbox → publishes events → downstream stores update
```

---

## 8. Real-World Examples

### 8.1 Twitter / X
**Problem:** Storing timelines and social graph in MySQL.  
**Solution:** Moved social graph to **FlockDB** (graph DB), timelines to **Redis** (in-memory fan-out), media to **Blobstore** (object store), search to **Earlybird** (custom Lucene).  
**Result:** Sub-100ms timeline loads at billion-tweet scale.

### 8.2 Airbnb
**Problem:** All data in MySQL, including search (location, dates, price filters).  
**Solution:** Introduced **Elasticsearch** for property search with geospatial and faceted filtering; kept booking/payments in MySQL (ACID required).  
**Result:** Relevance-ranked search with geospatial queries that MySQL couldn't serve efficiently.

### 8.3 Netflix
**Problem:** Storing viewing history, recommendations, and session state in a single relational DB.  
**Solution:**
- **Cassandra** for viewing history (high write throughput, time-ordered)
- **EVCache (Redis)** for session state and API response caching
- **Elasticsearch** for content search
- **S3** for media assets
- **Druid** for real-time analytics

### 08.4 Uber
**Problem:** Single PostgreSQL for geospatial, trip, and driver data.  
**Solution:**
- **Riak** (later **Cassandra**) for high-availability driver location
- **MySQL** retained for transactional trip/payment data
- **Kafka** for event streaming between services
- **Schemaless** (custom key-value on MySQL) for flexible document storage

### 8.5 GitHub
**Problem:** All repository metadata and activity in MySQL.  
**Solution:** Added **Elasticsearch** for code search, **Redis** for caching and rate limiting, **S3 + CDN** for file/asset delivery. MySQL retained for core relational entities.

### 8.6 Discord
**Problem:** Messages stored in Cassandra at scale — fine for time-ordered access but reads of old messages across servers degraded.  
**Solution:** Migrated to **ScyllaDB** (Cassandra-compatible, better performance); retained the polyglot model with Redis for presence/sessions and separate stores for media.

### 8.7 Shopify
**Problem:** Monolithic MySQL for all tenant data as merchant count scaled.  
**Solution:** Sharded MySQL by shop ID, introduced **Redis** for cart/session, **Elasticsearch** for storefront search, **Kafka** for event-driven order pipelines, **S3** for merchant assets.

---

## 9. Decision Framework: When to Introduce a New Store

```
Is the workload purely relational (joins, ACID, constraints)?
  └─ YES → Stay with RDBMS

Does it need sub-millisecond reads with TTL semantics (sessions, cache)?
  └─ YES → Redis / Memcached

Is it full-text / faceted / fuzzy search?
  └─ YES → Elasticsearch / OpenSearch

Is it time-series (metrics, IoT, logs)?
  └─ YES → InfluxDB / TimescaleDB / Prometheus

Is it large files / media / binary blobs?
  └─ YES → Object store (S3 / GCS / Azure Blob)

Is it highly connected data with traversal queries?
  └─ YES → Neo4j / Amazon Neptune

Is it a high-throughput event log needing replay / fan-out?
  └─ YES → Kafka / Kinesis / Pulsar

Is it flexible-schema / document-centric?
  └─ YES → MongoDB / DynamoDB / Couchbase

None of the above?
  └─ Evaluate and design from access pattern first
```

---

## 10. Monitoring Signals That You've Hit the Wall

| Signal | What It Means |
|---|---|
| DB CPU > 80% consistently | Queries doing work the DB shouldn't do (search, aggregations) |
| Slow query log dominated by `LIKE '%...%'` | Full-text via SQL — move to search engine |
| Connection pool exhaustion | Too many tiny/frequent queries — session reads should be in cache |
| Table size > 100GB with frequent range scans | Time-series or log data that should be in a purpose-built store |
| `pg_stat_bgwriter` showing high buffers_clean | I/O pressure from BLOBs in DB |
| Replication lag spiking under write load | Write-heavy workloads (metrics, logs) overwhelming the primary |
| Recursive CTEs with > 5 hops timing out | Graph workload in a relational DB |

---

## 11. Summary

| | Monolithic Persistence | Polyglot Persistence |
|---|---|---|
| **Best for** | Early-stage, simple domains, small teams | Scale, diverse query patterns, multiple domains |
| **Scaling model** | Vertical + read replicas | Horizontal, per-store |
| **Operational cost** | Low initially | Higher, but offset by performance |
| **Consistency** | Strong everywhere | Tunable per domain |
| **Migration cost** | N/A (already there) | Incremental via CDC + Strangler Fig |
| **Risk** | Performance ceiling, architectural debt | Distributed consistency complexity |

> **The core insight:** Data storage is not one-size-fits-all. Every access pattern is a contract — and forcing every contract through a single engine eventually breaks the system. Recognize the wall early, migrate incrementally, and choose stores by workload, not by familiarity.