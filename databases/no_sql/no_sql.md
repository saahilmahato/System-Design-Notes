# NoSQL Databases

## What is NoSQL?

NoSQL ("Not Only SQL") refers to a broad class of database management systems that diverge from the traditional relational model. They are designed for:

- **Horizontal scalability** over vertical scaling
- **Flexible schemas** over rigid table structures
- **High availability** and partition tolerance (AP systems)
- **Massive scale** — billions of records, petabytes of data

NoSQL databases sacrifice strict ACID guarantees (in most cases) in exchange for performance, scale, and flexibility.

---

## Core Types of NoSQL Databases

### 1. Key-Value Stores
- Data stored as simple key → value pairs
- Extremely fast reads/writes (O(1) lookups)
- No query language; access by key only
- **Best for**: Sessions, caches, leaderboards, feature flags
- **Examples**: Redis, DynamoDB, Memcached, Riak

```
Key:   user:session:abc123
Value: {"userId": 42, "role": "admin", "expires": 1712345678}
```

---

### 2. Document Stores
- Data stored as semi-structured documents (JSON/BSON/XML)
- Documents can have nested structures and arrays
- Rich query language over document fields
- **Best for**: Catalogs, user profiles, CMS, event logs
- **Examples**: MongoDB, CouchDB, Firestore, RavenDB

```json
{
  "_id": "order_891",
  "userId": 42,
  "items": [
    { "sku": "ABC", "qty": 2, "price": 9.99 },
    { "sku": "XYZ", "qty": 1, "price": 24.99 }
  ],
  "status": "shipped",
  "address": { "city": "NYC", "zip": "10001" }
}
```

---

### 3. Column-Family (Wide-Column) Stores
- Data stored in rows with dynamic, sparse columns grouped into column families
- Each row can have a different set of columns
- Optimized for writes and time-series/analytical reads
- **Best for**: Time-series, analytics, IoT telemetry, audit logs
- **Examples**: Apache Cassandra, HBase, ScyllaDB, Google Bigtable

```
Row Key: sensor:temperature:zone_A
  cf:data -> { ts:1700000001: 22.3, ts:1700000002: 22.5, ts:1700000003: 22.1 }
  cf:meta -> { location: "Building A", unit: "celsius" }
```

---

### 4. Graph Databases
- Data stored as nodes (entities) and edges (relationships)
- Optimized for traversing complex, deeply connected relationships
- **Best for**: Social networks, recommendation engines, fraud detection, knowledge graphs
- **Examples**: Neo4j, Amazon Neptune, TigerGraph, JanusGraph

```
(User:Alice)-[:FOLLOWS]->(User:Bob)
(User:Bob)-[:LIKES]->(Post:p123)
(Post:p123)-[:TAGGED]->(Topic:GraphDB)
```

---

### 5. Search Databases (Specialized)
- Built for full-text search, fuzzy matching, faceting, and ranking
- Index-centric; documents are optimized for search retrieval
- **Best for**: E-commerce search, log analysis, autocomplete
- **Examples**: Elasticsearch, OpenSearch, Solr, Meilisearch

---

## Architecture Deep Dive

### Data Model
- No enforced schema (schema-on-read vs. schema-on-write in SQL)
- Denormalization is the norm — embed related data to avoid joins
- Each NoSQL type has its own query paradigm (no universal standard like SQL)

### Scaling Model

```
                    SQL (Vertical)          NoSQL (Horizontal)
                  ┌─────────────┐         ┌──────┬──────┬──────┐
                  │  Big Server │         │ Node │ Node │ Node │
                  │  CPU + RAM  │   vs.   │  A   │  B   │  C   │
                  │   + SSD     │         └──────┴──────┴──────┘
                  └─────────────┘         Sharded / Partitioned
```

NoSQL databases partition (shard) data across many commodity nodes. Each node is responsible for a subset of the keyspace (consistent hashing is commonly used).

### Replication Strategies

| Strategy         | Description                             | Used By        |
|------------------|-----------------------------------------|----------------|
| Leaderless       | Any node accepts writes; peer sync      | Cassandra, Riak |
| Single Leader    | One primary, replicas follow            | MongoDB         |
| Multi-Leader     | Multiple primaries; conflict resolution | CouchDB         |

### Consistency Models

| Model             | Description                                              | Example            |
|-------------------|----------------------------------------------------------|--------------------|
| Eventual          | Replicas converge over time; reads may be stale          | DynamoDB (default) |
| Strong            | All reads reflect latest write; lower availability       | Redis (single node)|
| Read-your-writes  | After a write, that client always sees it                | MongoDB primary     |
| Causal            | Causally related operations are seen in order            | MongoDB sessions   |

### Quorum Reads/Writes (Cassandra / DynamoDB)

```
N = total replicas
W = nodes that must acknowledge a write
R = nodes that must respond to a read

For strong consistency: W + R > N
Example: N=3, W=2, R=2 → 2+2 > 3 ✓

Tunable consistency lets you trade latency for consistency per-query.
```

---

## CAP Theorem Positioning

```
          Consistency
               |
        CP     |     ──  (impossible: CA is only achievable without partitions)
   (HBase,    |
   Zookeeper) |
               |
               ├─────────────────── AP
               |         (Cassandra, DynamoDB, CouchDB)
         Partition Tolerance (always required in distributed systems)
```

- **CP stores** (HBase, Redis Cluster): Refuse writes when nodes disagree
- **AP stores** (Cassandra, DynamoDB): Accept writes on all available nodes; reconcile later

---

## Trade-offs

### NoSQL vs. SQL

| Dimension           | NoSQL                               | SQL (RDBMS)                         |
|---------------------|--------------------------------------|--------------------------------------|
| Schema              | Flexible / schemaless               | Rigid, enforced schema               |
| Scaling             | Horizontal (sharding native)        | Vertical (sharding is hard)          |
| Consistency         | Eventual (usually)                  | ACID transactions                    |
| Query power         | Limited (no joins, no ad-hoc SQL)   | Full relational algebra, joins, CTEs |
| Write throughput    | Very high                           | Moderate                             |
| Read patterns       | Optimized for known access patterns | Flexible ad-hoc queries              |
| Operational cost    | Higher complexity at scale          | Mature tooling, simpler ops          |

### Internal NoSQL Trade-offs

| Type         | Strengths                              | Weaknesses                          |
|--------------|----------------------------------------|--------------------------------------|
| Key-Value    | Fastest reads/writes, simple to scale  | No query on value; key-only access   |
| Document     | Flexible model, nested data            | No cross-document joins              |
| Wide-Column  | Excellent write throughput, time-series| Complex data modeling, no ad-hoc queries |
| Graph        | Relationship traversal                 | Poor at aggregate analytics, scaling is hard |

### Denormalization Trade-off
- **Pro**: No joins → low latency reads
- **Con**: Data duplication → inconsistent updates require multiple writes

### Eventual Consistency Trade-off
- **Pro**: High availability, low write latency
- **Con**: Clients may read stale data → requires application-level conflict handling

---

## When to Use NoSQL

**Use NoSQL when:**
- Data is unstructured or semi-structured (varying fields per record)
- You need massive write throughput (millions of writes/sec)
- The data access pattern is well-known and query flexibility is not needed
- You need to store time-series, events, or append-heavy data
- Geographic distribution or multi-region replication is required

**Avoid NoSQL when:**
- You need complex transactions across multiple entities (use SQL or NewSQL)
- Your data is highly relational and requires ad-hoc joins
- Your team is not experienced with NoSQL operational complexity
- Consistency is more important than availability (financial records, inventory)

### Decision Framework

```
                       Start Here
                           │
              Is your schema fixed & relational?
              ┌────────────┴─────────────────┐
             YES                            NO
              │                              │
           Use SQL                  What is your access pattern?
                             ┌────────────────┼──────────────────┐
                         Key lookup     Document/nested    Time-series/events
                             │                │                    │
                          Redis/           MongoDB/             Cassandra/
                         DynamoDB         Firestore              HBase
                                                   │
                                         Deep relationships?
                                                   │
                                                Neo4j
```

---

## Real-World Systems & Applications

### Twitter / X — Apache Cassandra
- Stores hundreds of billions of tweets and timelines
- Cassandra's leaderless, AP architecture handles multi-region writes with no single point of failure
- Timeline fanout: home timeline is pre-computed and stored as a wide row per user

### Netflix — Apache Cassandra + DynamoDB
- Cassandra powers viewing history, user state, and billing data
- Handles millions of concurrent requests at peak load (evenings globally)
- DynamoDB used for low-latency metadata lookups across microservices

### Uber — Schemaless (built on MySQL + Cassandra)
- Trip data and driver location history stored in Cassandra for append-heavy writes
- Driver geolocation uses a custom geospatial document store

### Instagram — Cassandra + Redis
- Cassandra stores the social graph (follows, followers) and activity feeds
- Redis caches hot timelines and counters (likes, follower counts)
- Moved off PostgreSQL for feed data when row counts exceeded billions

### LinkedIn — Espresso (built on MySQL) + Voldemort (Key-Value)
- Voldemort (inspired by Amazon Dynamo) stores member profiles at scale
- Graph data (connections) stored in a custom distributed graph store

### Discord — Cassandra → ScyllaDB
- Stores trillions of messages in Cassandra, partitioned by channel and time bucket
- Migrated to ScyllaDB (Cassandra-compatible, built in C++) for lower tail latency
- Message ID is a Snowflake (timestamp + worker ID) — enables time-ordered range scans

### Amazon — DynamoDB
- DynamoDB was born out of Amazon's internal need (original Dynamo paper, 2007)
- Used for shopping cart, product catalog, order management at massive scale
- Single-digit millisecond latency at any scale; supports global tables for multi-region

### MongoDB — Airbnb, Forbes, Bosch
- Airbnb uses MongoDB for listing metadata (variable fields per property type)
- Well-suited for content management, user-generated content with evolving schemas

---

## Data Modeling Patterns

### Pattern 1: Embed vs. Reference (Document Stores)

```
// Embedded (good for 1:few, read-heavy)
{
  "orderId": "ORD-001",
  "items": [{ "sku": "A", "qty": 2 }],   ← embedded
  "shippingAddress": { "city": "NYC" }    ← embedded
}

// Referenced (good for 1:many, write-heavy, shared data)
{
  "orderId": "ORD-001",
  "customerId": "CUST-42"   ← reference, fetch separately
}
```

### Pattern 2: Composite Partition Keys (Cassandra)

```sql
CREATE TABLE messages (
  channel_id UUID,
  bucket     INT,        -- time bucket (e.g. month) to cap partition size
  message_id TIMEUUID,
  content    TEXT,
  PRIMARY KEY ((channel_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
```

### Pattern 3: Time-to-Live (TTL)
- Redis and Cassandra support per-record TTL
- Automatically evicts stale data (sessions, rate-limit counters, OTP codes)

```
SET session:abc123 "{...}" EX 3600   ← Redis: expires in 1 hour
```

---

## Operational Considerations

### Hotspot / Hot Partition Problem
- If partition key is poorly chosen (e.g., `user_id` for a celebrity), one node gets all traffic
- Mitigation: Salting keys, synthetic sharding, write sharding

### Anti-Patterns

| Anti-Pattern                     | Problem                                              | Fix                                      |
|----------------------------------|------------------------------------------------------|------------------------------------------|
| Using MongoDB like a relational DB | Joins via application code become N+1 queries       | Embed related data; redesign access path |
| Unbounded partition growth       | Cassandra partition grows to GBs → slow compaction  | Add time bucket to partition key         |
| Storing everything in Redis      | Data loss on restart (without persistence config)   | Enable AOF/RDB; use Redis only for cache |
| Schemaless as an excuse          | Inconsistent data shapes cause bugs at read time    | Enforce schema at application layer      |
| Global secondary indexes at high scale | Expensive fan-out writes to all nodes          | Use local indexes; filter at app layer   |

---

## Monitoring & Metrics

| Metric                         | Target / Alert Threshold           | Tool                  |
|-------------------------------|-------------------------------------|-----------------------|
| Read/Write latency (p99)       | < 5ms (Cassandra), < 1ms (Redis)   | Prometheus, Grafana   |
| Tombstone count (Cassandra)    | < 100K per query or warn           | nodetool tablestats   |
| Compaction pending tasks       | < 10                               | Cassandra JMX         |
| Cache hit rate (Redis)         | > 95%                              | Redis INFO stats      |
| Replication lag                | < 1s for AP systems                | Per-DB metrics        |
| Partition size (Cassandra)     | < 100MB per partition              | nodetool cfstats      |
| Evicted keys (Redis)           | Should be 0 (or expected if LRU)   | Redis INFO memory     |

---

## Summary

```
┌────────────────────────────────────────────────────────────────────┐
│                    NoSQL at a Glance                               │
├──────────────┬─────────────────┬───────────────┬───────────────────┤
│   Type       │  Best Use Case  │  Top Product  │  Consistency      │
├──────────────┼─────────────────┼───────────────┼───────────────────┤
│ Key-Value    │ Cache, sessions │ Redis         │ Strong (local)    │
│ Document     │ Profiles, CMS   │ MongoDB       │ Tunable           │
│ Wide-Column  │ Time-series,    │ Cassandra     │ Eventual (AP)     │
│              │ activity feeds  │               │                   │
│ Graph        │ Social, fraud   │ Neo4j         │ Strong (ACID)     │
│ Search       │ Full-text, logs │ Elasticsearch │ Near real-time    │
└──────────────┴─────────────────┴───────────────┴───────────────────┘
```

**Default recommendation**: Start with PostgreSQL. Move to NoSQL only when you have a clear, specific bottleneck that NoSQL solves — high write throughput, flexible schema at scale, or deep relationship traversal.