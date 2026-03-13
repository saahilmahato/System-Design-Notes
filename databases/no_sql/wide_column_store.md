# NoSQL: Wide Column Store

## What Is It?

A **Wide Column Store** (also called a Column-Family Store) is a NoSQL database that organizes data into rows identified by a row key, where each row can have a **dynamic, variable set of columns**. Unlike relational tables with fixed schemas, wide column stores allow each row to have entirely different columns — and potentially millions of them.

The data model sits between a key-value store and a relational database:

```
Row Key        | Column Family: profile          | Column Family: activity
---------------|---------------------------------|-----------------------------
user:001       | name=Alice, age=30, city=NYC    | last_login=2024-01-01, views=42
user:002       | name=Bob, email=bob@x.com       | last_login=2024-01-03
user:003       | name=Carol, age=25              | (no activity data)
```

Each row can have a different number and set of columns. Columns are grouped into **Column Families**, which are stored together on disk.

---

## Core Concepts

### Row Key
- The **primary identifier** for a row — equivalent to a primary key.
- All lookups, range scans, and partitioning are based on the row key.
- Row key design is the single most critical design decision in wide column stores.
- Data is **sorted lexicographically by row key**, enabling efficient range scans.

### Column Family
- A logical and physical grouping of related columns.
- Defined at schema creation time (unlike individual columns).
- All data in a column family is stored together on disk (column-oriented storage within a family).
- Best practice: keep **2–5 column families per table** to avoid I/O amplification.

### Column Qualifier (Column Name)
- The actual column name within a column family.
- Can be **created dynamically at write time** — no ALTER TABLE needed.
- Often used as part of the data itself (e.g., `event:2024-01-01T10:00:00` where timestamp is embedded in the column name).

### Cell / Version
- The intersection of a row key + column family + column qualifier.
- Stores the value **with a timestamp**.
- Wide column stores natively support **multiple versions** of the same cell (configurable TTL and max versions).

---

## Data Model Deep Dive

### Sparse Storage
Null columns consume **no storage**. A row with 3 columns and a row with 3000 columns coexist in the same table without wasted space. This makes wide column stores ideal for sparse, heterogeneous datasets.

### Column-Oriented Storage Within a Family
Within a column family, data is stored **column by column**, not row by row. This enables:
- High compression ratios (similar values compressed together).
- Efficient reads of specific columns across many rows (analytical queries).

### Timestamp-Based Versioning
```
Row: user:001 | cf:name
  value="Alice"  @  t=1700000000
  value="Alicia" @  t=1710000000   ← latest
```
Reads return the **latest version** by default. Older versions can be queried or expire by TTL.

---

## Architecture

```
                    ┌──────────────────────────────────────────┐
                    │              Client Application           │
                    └────────────────────┬─────────────────────┘
                                         │
                    ┌────────────────────▼─────────────────────┐
                    │           Master / Coordinator Node        │
                    │  - Manages metadata & region assignments  │
                    │  - No data path (stateless routing)       │
                    └──────┬────────────────────────┬──────────┘
                           │                        │
              ┌────────────▼──────┐    ┌────────────▼──────────┐
              │   Region Server 1  │    │   Region Server 2      │
              │  ┌──────────────┐ │    │  ┌──────────────────┐  │
              │  │ MemStore     │ │    │  │ MemStore         │  │
              │  │ (Write buf)  │ │    │  │ (Write buf)      │  │
              │  └──────┬───────┘ │    │  └──────┬───────────┘  │
              │         │ flush   │    │          │ flush        │
              │  ┌──────▼───────┐ │    │  ┌──────▼───────────┐  │
              │  │  HFiles/     │ │    │  │  HFiles/         │  │
              │  │  SSTables    │ │    │  │  SSTables        │  │
              │  │  (Disk)      │ │    │  │  (Disk)          │  │
              │  └──────────────┘ │    │  └──────────────────┘  │
              └───────────────────┘    └───────────────────────┘
                                         │
                    ┌────────────────────▼─────────────────────┐
                    │       Distributed Storage (HDFS / GFS)    │
                    └──────────────────────────────────────────┘
```

### Write Path (LSM Tree)
1. Write goes to **Write-Ahead Log (WAL)** for durability.
2. Write is buffered in **MemStore** (in-memory sorted structure).
3. When MemStore fills, it **flushes to disk** as an immutable SSTable/HFile.
4. Background **compaction** merges SSTables to reduce read amplification.

### Read Path
1. Check **Block Cache** (in-memory read cache).
2. Check **MemStore** (recent unflushed writes).
3. Check **SSTables on disk** (newest to oldest), using Bloom Filters to skip irrelevant files.
4. Merge results and return latest version.

### LSM Tree vs B-Tree
| Property | LSM Tree (Wide Column) | B-Tree (RDBMS) |
|---|---|---|
| Write throughput | Very high (sequential writes) | Moderate (random I/O) |
| Read throughput | Moderate (multi-file merge) | High (single structure) |
| Space amplification | Higher (until compaction) | Lower |
| Write amplification | Lower initially, then compaction | Higher (in-place updates) |
| Range scans | Efficient (sorted keys) | Efficient |

---

## Row Key Design (Most Critical Decision)

### Rules
- **Avoid monotonically increasing keys** (timestamps, auto-increment IDs) — causes write hotspots on the last region/node.
- **Design keys for your primary access pattern** — wide column stores don't support secondary indexes well natively.
- **Prefix with a salt/hash** to distribute writes evenly when timestamp ordering is needed.

### Common Patterns

| Pattern | Key Design | Use Case |
|---|---|---|
| Salted Key | `hash(userId) + userId` | Evenly distribute high-write users |
| Reversed Timestamp | `userId + (MAXLONG - timestamp)` | Retrieve most recent events first |
| Composite Key | `tenantId + userId + eventType` | Multi-tenant, scoped range scans |
| Field Promotion | Embed filter fields in key | Avoid full table scans |

### Hotspot Example
```
❌ Bad:  row key = timestamp → all writes go to one region
✓ Good: row key = md5(userId)[0:2] + userId + timestamp
```

---

## Trade-offs

| Dimension | Wide Column Store | Notes |
|---|---|---|
| **Write throughput** | ✅ Excellent | LSM tree = sequential writes; great for append-heavy workloads |
| **Read throughput** | ✅ Good (with row key) | Single row reads are fast; full scans are expensive |
| **Read (secondary index)** | ❌ Poor natively | Must denormalize or use external index (Elasticsearch) |
| **Consistency** | ⚠️ Tunable | Quorum reads/writes for strong consistency; single-node for eventual |
| **Schema flexibility** | ✅ High | Columns added dynamically at write time, no migrations |
| **Joins** | ❌ Not supported | Must be handled at application layer |
| **Ad-hoc queries** | ❌ Poor | Requires full table scan without careful key design |
| **Compression** | ✅ Excellent | Column-oriented layout enables high compression ratios |
| **Horizontal scaling** | ✅ Excellent | Auto-sharding by row key range; linear scaling |
| **Operational complexity** | ❌ High | Region splits, compaction tuning, hotspot detection |
| **ACID transactions** | ⚠️ Limited | Row-level atomicity only; no cross-row transactions (HBase) |
| **Time series / versioning** | ✅ Native | Built-in cell versioning and TTL |

---

## When to Use / When Not to Use

### ✅ Use Wide Column Stores When:
- Write throughput is very high (millions of writes/sec).
- Data is **sparse and heterogeneous** (different attributes per entity).
- Access patterns are known and query-by-row-key dominates.
- Time-series, event logs, or audit trails with high ingest rate.
- Scale is very large (TBs to PBs).
- You need native multi-version / TTL support.

### ❌ Avoid Wide Column Stores When:
- You need complex ad-hoc queries or analytics (use columnar OLAP: Redshift, BigQuery).
- Relationships and joins are central to the data model.
- Access patterns are unpredictable or highly varied.
- Team is small and operational overhead is a concern.
- Data volume doesn't justify the complexity (PostgreSQL is fine under ~1 TB with indexing).

---

## Comparison: Wide Column vs Other NoSQL Types

| Feature | Wide Column | Document | Key-Value | Graph |
|---|---|---|---|---|
| Data model | Row + dynamic columns | JSON documents | Flat key → value | Nodes + edges |
| Query model | Row key / range scan | Field-based query | Exact key lookup | Traversal |
| Schema | Column families fixed; columns dynamic | Flexible | None | Node/edge types |
| Relationships | Not supported | Embedded or reference | Not supported | First-class |
| Scale | PB-scale | TB–PB scale | Very high | Medium |
| Examples | Cassandra, HBase, Bigtable | MongoDB, Couchbase | Redis, DynamoDB | Neo4j, Neptune |

---

## Real-World Systems & Applications

### Google Bigtable
- **The origin**: Bigtable (2006 paper) defined the wide column model.
- Stores **petabytes** of structured data across Google Search, Maps, Analytics, Gmail.
- Powers **Google Analytics** real-time reporting: row key = `reversed_domain + timestamp`, allowing fast range scans of a site's recent pageviews.
- Underpins **Google Maps** for geospatial tile data.

### Apache HBase (Open-source Bigtable)
- Built on top of **HDFS**, tightly integrated with Hadoop ecosystem.
- Used by **Meta (Facebook)** for the Messages backend: stores billions of messages with row key `= userId + threadId`.
- Used by **Yahoo** for serving real-time data from Hadoop batch pipelines.
- **Flipkart** (India's Amazon) uses HBase for product catalog and user activity at massive scale.

### Apache Cassandra
- Originally built at **Meta** for the Facebook Inbox, now open-source.
- Leaderless architecture (no master node) — **AP system** by default, tunable consistency.
- **Netflix**: Uses Cassandra as the backbone for viewing history, subscriber state, and billing. Runs thousands of Cassandra nodes globally. Row key = `customerId`, columns = episodes watched with timestamps.
- **Apple**: Operates one of the largest Cassandra deployments — 75,000+ nodes storing iCloud data.
- **Instagram**: Stores social graph data (followers/following) and direct messages.
- **Discord**: Uses Cassandra (migrated to ScyllaDB) for storing 100s of billions of messages. Row key = `channelId + bucketId` (time-bucketed).
- **Uber**: Stores geolocation history and trip event data in Cassandra.

### ScyllaDB
- Drop-in Cassandra-compatible replacement, rewritten in C++ for lower latency.
- **Discord** migrated from Cassandra to ScyllaDB to reduce tail latency and operational cost.
- **Zillow** uses ScyllaDB for real-time property data serving.

### AWS DynamoDB
- Managed wide column / key-value store. Column families → attributes.
- Used by **Amazon's own e-commerce platform** for shopping carts and session data.
- **Snapchat**: Stores ephemeral message metadata.
- **Lyft**: Manages ride state and driver location history.

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Monotonic row keys** (auto-increment, timestamps) | Writes hotspot to one region | Salt the key or use hash prefix |
| **Too many column families** | Causes excessive I/O during flushes/compaction | Keep to 2–5 per table |
| **Using as a general-purpose query engine** | Full scans are expensive; no join support | Design for specific access patterns; use Spark/Presto for analytics |
| **Very wide rows (millions of columns)** | Row splits become expensive; memory pressure | Limit columns per row; use time-bucketed rows |
| **Ignoring TTL/compaction** | Disk bloat, stale versions accumulate | Set TTL and max versions on column families |
| **Cross-row transactions** | Not natively supported (most implementations) | Redesign to be row-local, or use CAS (Compare-and-Swap) |
| **Treating it like a relational DB** | Trying to normalize data; forces bad access patterns | Embrace denormalization; model around queries |

---

## Decision Framework

```
Is write throughput > 100K writes/sec  OR  data volume > 1 TB?
         │
         ├─ No  →  Consider PostgreSQL + proper indexing first
         │
         └─ Yes
              │
              Is the primary access pattern key-based (no ad-hoc queries)?
                       │
                       ├─ No  →  Consider Elasticsearch (search) or BigQuery (analytics)
                       │
                       └─ Yes
                                │
                                Do you need strong consistency + multi-row transactions?
                                         │
                                         ├─ Yes  →  HBase (CP, strong consistency)
                                         │
                                         └─ No   →  Cassandra / Bigtable
                                                    (high availability, tunable consistency)
```

---

## Key Metrics to Monitor

| Metric | Why It Matters |
|---|---|
| **Read/Write latency (p99)** | Detect compaction spikes, hotspots |
| **Compaction queue depth** | Large queue = read latency will rise |
| **MemStore size** | Approaching flush threshold → write stalls |
| **Region/Partition skew** | Identifies hotspot row keys |
| **Bloom filter hit rate** | Low hit rate = unnecessary SSTable reads |
| **GC pause time** (JVM-based) | HBase/Cassandra; long GC = latency spikes |
| **SSTable count per partition** | High count = read amplification; trigger compaction |
| **Disk read/write IOPS** | Compaction is I/O intensive |

---

## Summary

| Property | Value |
|---|---|
| **CAP classification** | CP (HBase, Bigtable) or AP (Cassandra) |
| **Consistency model** | Tunable: strong, eventual, quorum |
| **Storage engine** | LSM Tree (write-optimized) |
| **Primary index** | Row key (sorted, range-scannable) |
| **Scaling axis** | Horizontal (auto-sharding by key range) |
| **Best for** | High-ingest time series, event logs, user activity, sparse entities |
| **Not for** | Complex queries, joins, ad-hoc analytics, small datasets |