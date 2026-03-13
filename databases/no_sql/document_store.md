# NoSQL: Document Store

## 1. What Is a Document Store?

A **document store** is a type of NoSQL database that stores, retrieves, and manages semi-structured data as **documents** — typically JSON, BSON, or XML. Each document is a self-contained unit of data with its own structure, and documents within the same collection do not need to share a schema.

```json
// Example: User document in a document store
{
  "_id": "usr_7a9c3f",
  "name": "Alice Chen",
  "email": "alice@example.com",
  "address": {
    "city": "San Francisco",
    "zip": "94107"
  },
  "tags": ["premium", "verified"],
  "preferences": {
    "notifications": true,
    "theme": "dark"
  },
  "created_at": "2024-01-15T09:23:00Z"
}
```

Key characteristic: the document is the **unit of storage and retrieval** — related data is embedded together rather than spread across normalized tables.

---

## 2. Core Concepts

### Document
A self-describing data record, usually JSON/BSON. Can contain nested objects, arrays, and mixed data types. No schema enforcement by default.

### Collection
A grouping of documents (analogous to a table in RDBMS). Documents in a collection can have different fields.

### Embedded Documents vs. References
| Strategy | When to Use |
|---|---|
| **Embed** nested data | Data always accessed together; one-to-few relationships; child data doesn't grow unboundedly |
| **Reference** via ID | Data accessed independently; one-to-many or many-to-many; large or growing sub-documents |

### Indexing
Document stores support rich indexing: single-field, compound, multi-key (array), text, geospatial, and TTL indexes. Queries not backed by an index result in a full collection scan — a critical design concern at scale.

### Flexible Schema (Schema-on-Read)
Schema is enforced at the application layer, not the database layer. The database accepts any valid document structure. Optional schema validation can be added.

---

## 3. Architecture Patterns

### Data Modeling: Embed vs. Reference

```
EMBEDDED (Denormalized)               REFERENCED (Normalized)
────────────────────────              ──────────────────────────
Order Document                        Order Document
{                                     {
  _id: "ord_123",                       _id: "ord_123",
  customer: {          ← embedded       customer_id: "usr_456",  ← ref
    name: "Bob",                        items: ["itm_1", "itm_2"] ← refs
    email: "bob@x.com"                }
  },
  items: [
    { sku: "A1", qty: 2, price: 10 },
    { sku: "B3", qty: 1, price: 25 }
  ]
}

✅ Single read for full order          ✅ Data consistency — one source of truth
❌ Customer data duplicated            ❌ Multiple reads (application-side joins)
```

### Sharding (Horizontal Partitioning)
Data is split across multiple nodes by a **shard key**. Choosing the shard key is one of the most consequential schema decisions:
- **High cardinality** — many distinct values to distribute load evenly
- **Even write distribution** — avoid hotspots (e.g., monotonically increasing IDs are poor shard keys)
- **Query alignment** — queries that include the shard key are routed to one shard; those without fan out to all shards

### Replication
Document stores typically use a **replica set**: one primary node handles writes; secondary nodes replicate asynchronously. On primary failure, secondaries elect a new primary automatically.

```
        Write / Read            Read (if configured)
Client ────────────► Primary ──────────► Secondary 1
                        │
                        └──────────────► Secondary 2
```

### Read / Write Concern Levels
| Concern | Description | Use Case |
|---|---|---|
| `w:1` | Acknowledged by primary only | High throughput, tolerate some data loss |
| `w:majority` | Acknowledged by majority of replica set | Financial records, critical data |
| `r:local` | Read from local node | Low latency, possibly stale |
| `r:majority` | Read only committed data | Consistent reads after failover |

---

## 4. Trade-offs

### Advantages

| Advantage | Description |
|---|---|
| **Flexible schema** | Add or remove fields without migrations; ideal for evolving data models |
| **Locality of reference** | Related data embedded in one document = single read for full entity |
| **Horizontal scalability** | Native sharding; scale out cheaply with commodity hardware |
| **Developer ergonomics** | JSON documents map directly to application objects; no ORM impedance mismatch |
| **Rich query API** | Filter on nested fields, arrays, geospatial queries — without joins |
| **High write throughput** | No join overhead; writes go to one shard |

### Disadvantages

| Disadvantage | Description |
|---|---|
| **No native joins** | Cross-collection lookups are expensive (`$lookup`); application-side joins add complexity |
| **Data duplication** | Denormalized embedding duplicates data; updates to shared data require multiple writes |
| **No ACID transactions (historically)** | MongoDB 4.0+ added multi-doc ACID, but it carries significant performance overhead |
| **Query unpredictability** | Missing indexes causes full collection scans; query performance is less predictable than SQL |
| **Schema discipline required** | Flexible schema is a double-edged sword — without discipline, collections become inconsistent |
| **Document size limits** | MongoDB caps documents at 16 MB; deeply nested or array-heavy documents hit limits |
| **Poor for relational data** | Many-to-many relationships or heavily relational workloads are awkward to model |

### Comparison with Relational Databases

| Dimension | Document Store | RDBMS |
|---|---|---|
| Schema | Flexible (schema-on-read) | Strict (schema-on-write) |
| Joins | Limited / expensive | Native, optimized |
| Transactions | Limited (improving) | Full ACID |
| Horizontal scale | Native sharding | Complex (Vitess, Citus) |
| Query language | JSON-based DSL / MQL | Standardized SQL |
| Aggregations | Pipeline-based | SQL GROUP BY / window functions |
| Best fit | Hierarchical, document-like data | Relational, normalized data |

---

## 5. When to Use Document Stores

### ✅ Strong Use Cases
- **Catalogs and content**: Product catalogs, blog posts, CMS — each item is a self-contained document with variable attributes
- **User profiles and settings**: Heterogeneous, nested, user-specific configuration
- **Event logs and activity feeds**: Write-heavy, append-mostly, variable event shapes
- **Real-time analytics**: Pre-aggregated reporting structures
- **Mobile backends**: Schema changes are frequent during rapid iteration; no migrations needed
- **Hierarchical data**: Nested data (org trees, nested comments) maps naturally to documents

### ❌ Avoid When
- Strong relational integrity is required (foreign keys, cascades)
- Complex multi-table joins are the dominant query pattern
- Multi-row ACID transactions are frequently needed
- Data model is highly normalized with many-to-many relationships

---

## 6. Query Patterns & Indexes

### Key Index Types (MongoDB as reference)

```javascript
// Single-field index
db.orders.createIndex({ customer_id: 1 })

// Compound index — order matters; supports prefix queries
db.orders.createIndex({ status: 1, created_at: -1 })

// Multi-key index — automatically indexes each element of an array
db.products.createIndex({ tags: 1 })

// Text index — full-text search on string fields
db.articles.createIndex({ content: "text", title: "text" })

// TTL index — auto-expire documents after N seconds
db.sessions.createIndex({ created_at: 1 }, { expireAfterSeconds: 86400 })

// Partial index — index only documents matching a filter (saves space)
db.orders.createIndex(
  { customer_id: 1 },
  { partialFilterExpression: { status: "active" } }
)
```

### Aggregation Pipeline

```javascript
// Example: Revenue by product category, last 30 days
db.orders.aggregate([
  { $match: { created_at: { $gte: thirtyDaysAgo } } },
  { $unwind: "$items" },
  { $group: {
      _id: "$items.category",
      total_revenue: { $sum: { $multiply: ["$items.price", "$items.qty"] } },
      order_count: { $sum: 1 }
  }},
  { $sort: { total_revenue: -1 } },
  { $limit: 10 }
])
```

---

## 7. Scaling Strategies

### Vertical Scaling (Scale Up)
Add more RAM and CPU to a single node. Fast reads benefit significantly from fitting the working set in RAM (MongoDB's WiredTiger cache). Viable up to a point.

### Horizontal Scaling (Scale Out via Sharding)

```
               ┌─────────────┐
  Client ───►  │   mongos    │  ← Query router
               │  (router)   │
               └──────┬──────┘
                      │ routes based on shard key
          ┌───────────┼───────────┐
          ▼           ▼           ▼
     Shard 1       Shard 2     Shard 3
  [usr_a–usr_f]  [usr_g–usr_n] [usr_o–usr_z]
   Replica Set    Replica Set   Replica Set
```

### Caching Layer
Place Redis or Memcached in front of the document store for hot data:
- Cache full document by `_id` for profile/product reads
- Cache aggregation results with TTL
- Invalidate cache on document write

### Read Scaling
Route read traffic to secondary replica set members. Trade-off: potentially stale reads (`readPreference: secondary`).

---

## 8. Real-World Systems & Applications

### MongoDB — Uber (driver/trip profiles)
Uber uses MongoDB for storing driver profiles, trip metadata, and geospatial data. Trip records embed origin/destination coordinates enabling `$geoNear` queries to find nearby drivers without joins. Schema flexibility allows regional differences in driver document structure.

### MongoDB — Airbnb (listing catalog)
Airbnb's listing catalog contains wildly varied attributes (a villa in Tuscany has different fields than an apartment in NYC). Document stores handle this polymorphism naturally — each listing is a self-contained document with arbitrary nested amenities, house rules, and availability blocks.

### Couchbase — LinkedIn (member activity)
LinkedIn uses Couchbase for member profiles and activity feeds. The document model maps directly to a member's profile object, reducing serialization overhead. Sub-millisecond reads at hundreds of millions of profile fetches per day.

### Firestore (Firebase) — Mobile apps at scale
Google's Firestore is a document store designed for real-time sync. Mobile apps (games, chat, collaboration tools) use it for live document updates streamed to clients. Collections map to entity types; documents to individual records; sub-collections to nested entities.

### Amazon DocumentDB — Enterprise migrations
AWS DocumentDB provides MongoDB-compatible API on top of Aurora's storage engine. Used by enterprises migrating from MongoDB who want managed infrastructure and Aurora's durability guarantees.

### Elasticsearch — Content search and logging
Elasticsearch is built on a document store (Apache Lucene) with full-text search capabilities. Used by GitHub (code search), Netflix (content discovery), and Shopify (product search). Documents are JSON; queries combine full-text search with structured filters.

### CouchDB — Offline-first applications
CouchDB's multi-master replication makes it ideal for offline-capable mobile and edge applications. Documents sync when connectivity is restored; conflicts are surfaced to the application for resolution. Used in medical field apps and field-data collection.

---

## 9. Decision Framework

```
Start Here
    │
    ▼
Is your data naturally document-shaped
(nested, variable attributes, self-contained)?
    │
    ├── No ──► Consider RDBMS (PostgreSQL) or
    │          Column Store (Cassandra)
    │
    ├── Yes
    │    │
    │    ▼
    │  Will you frequently join across entity types?
    │    │
    │    ├── Frequently ──► RDBMS may be better;
    │    │                  or accept application-side joins
    │    │
    │    └── Rarely / Never
    │         │
    │         ▼
    │       Is write throughput the primary concern?
    │         │
    │         ├── Yes ──► Document store with
    │         │           embedded model + sharding
    │         │
    │         └── No
    │              │
    │              ▼
    │            Do you need full-text search?
    │              │
    │              ├── Yes ──► Elasticsearch / Opensearch
    │              │
    │              └── No ──► MongoDB / Couchbase / Firestore
    │
    ▼
Choose shard key and embedding strategy carefully — these are
the hardest decisions to change post-launch.
```

---

## 10. Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Unbounded array growth** | Document grows to 16 MB limit; index degradation | Use a separate collection with references; bucket pattern |
| **Using `_id` as a sequential counter** | Hotspots on the highest shard; poor write distribution | Use UUID / BSON ObjectId or hash-based IDs |
| **Query without index on large collection** | Full collection scan; latency spikes under load | Profile all queries; ensure indexes cover access patterns |
| **Polymorphism without a `type` field** | Cannot distinguish document variants; query overhead | Always include a discriminator field (`type`, `entity_type`) |
| **Deeply nested documents (5+ levels)** | Hard to query, update, and index inner fields | Flatten structure; move deep nesting to sub-collections |
| **Storing binary blobs in documents** | Bloats document storage; performance degradation | Store files in object storage (S3); store only URL reference |
| **Over-embedding** | Parent document grows large; entire doc loaded for small field | Separate into collection if sub-doc is large or independently accessed |
| **Ignoring write concern for critical data** | Acknowledged writes may be lost on primary failure | Use `w:majority` for financial or critical operations |

---

## 11. Monitoring & Operational Metrics

| Metric | Why It Matters | Alert Threshold |
|---|---|---|
| **Working set vs. RAM** | If working set exceeds RAM, reads go to disk → latency spikes | Working set > 70% of available RAM |
| **Index cache hit rate** | Low hit rate = queries reading from disk | < 95% |
| **Replication lag** | High lag = stale reads; risk of data loss on failover | > 10 seconds |
| **Operation latency (p99)** | Tail latencies signal index misses or slow queries | > 100ms for OLTP |
| **Connections in use** | Connection pool exhaustion causes queued / failed requests | > 80% of pool size |
| **Oplog window** | Determines how long a secondary can be down before needing resync | < 24 hours is risky |
| **Document scan ratio** | High ratio of scanned-to-returned docs = missing index | Scanned/returned > 10x |

---

## 12. Popular Document Store Databases

| Database | Key Strengths | Best For |
|---|---|---|
| **MongoDB** | Rich query API, aggregation pipeline, native sharding | General-purpose; complex queries on document data |
| **Couchbase** | Sub-ms latency, built-in caching layer, N1QL SQL++ | High-performance mobile/edge backends |
| **Firestore** | Real-time sync, managed, strong consistency | Mobile/web apps needing live updates |
| **CouchDB** | Multi-master replication, offline-first sync | Distributed/offline applications |
| **Elasticsearch** | Full-text search + document storage, aggregations | Search-heavy workloads, log analytics |
| **Amazon DocumentDB** | MongoDB-compatible, fully managed on Aurora | Enterprise teams on AWS needing managed infra |
| **RavenDB** | ACID transactions, LINQ queries, auto-indexing | .NET ecosystems, transactional document workloads |