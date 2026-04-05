# Databases — System Design Notes

---

## 1. Core Concepts

### What is a Database?
A structured system for storing, retrieving, and managing data. In system design, the choice of database directly impacts **scalability**, **consistency**, **availability**, and **performance**.

### ACID Properties
| Property | Description |
|---|---|
| **Atomicity** | A transaction is all-or-nothing |
| **Consistency** | Data moves from one valid state to another |
| **Isolation** | Concurrent transactions don't interfere |
| **Durability** | Committed data survives failures |

### BASE Properties (NoSQL alternative)
| Property | Description |
|---|---|
| **Basically Available** | System guarantees availability |
| **Soft State** | State may change over time without input |
| **Eventually Consistent** | System will become consistent over time |

---

## 2. Types of Databases

### 2.1 Relational Databases (SQL)
- Data stored in **tables** with rows and columns
- Schema is **predefined and strict**
- Supports **JOINs**, foreign keys, complex queries
- Uses SQL as the query language
- **Examples:** PostgreSQL, MySQL, Oracle, Microsoft SQL Server

### 2.2 Document Databases (NoSQL)
- Data stored as **JSON/BSON documents**
- Schema is **flexible** — documents in the same collection can have different fields
- Good for **hierarchical or nested data**
- **Examples:** MongoDB, CouchDB, Firestore

### 2.3 Key-Value Stores
- Simplest NoSQL model: a **key maps to a value**
- Extremely fast lookups — O(1)
- Limited querying capability
- Best for **caching, sessions, leaderboards**
- **Examples:** Redis, DynamoDB, Memcached

### 2.4 Column-Family Stores (Wide-Column)
- Data stored in **columns rather than rows**
- Optimized for reading/writing **large datasets with sparse columns**
- Rows can have different columns
- **Examples:** Apache Cassandra, HBase, Google Bigtable

### 2.5 Graph Databases
- Data stored as **nodes (entities) and edges (relationships)**
- Optimized for **traversing relationships** (e.g., 6 degrees of separation)
- **Examples:** Neo4j, Amazon Neptune, ArangoDB

### 2.6 Time-Series Databases
- Optimized for **time-stamped sequential data**
- Efficient at ingesting high-frequency writes and range queries over time
- **Examples:** InfluxDB, TimescaleDB, Prometheus

### 2.7 Search Engines / Full-Text Search
- Optimized for **text search, ranking, and faceted filtering**
- Uses inverted indexes
- **Examples:** Elasticsearch, Apache Solr, Meilisearch

### 2.8 NewSQL
- Attempts to offer **ACID compliance** at **horizontal scale** of NoSQL
- **Examples:** Google Spanner, CockroachDB, TiDB

---

## 3. Indexing

### What is an Index?
A data structure that improves the speed of data retrieval at the cost of additional write overhead and storage.

### Types of Indexes
| Type | Description | Use Case |
|---|---|---|
| **B-Tree Index** | Balanced tree, default index type | Range queries, equality |
| **Hash Index** | Hash map, O(1) lookup | Exact equality only |
| **Composite Index** | Index on multiple columns | Multi-column WHERE clauses |
| **Partial Index** | Index on a subset of rows | Filtering sparse data |
| **Full-Text Index** | Inverted index for text | Text search |
| **Covering Index** | Includes all columns needed by a query | Avoid table lookups |

### Trade-offs of Indexing
- ✅ Dramatically speeds up **read** performance
- ❌ **Slows down writes** (INSERT, UPDATE, DELETE must update the index)
- ❌ Consumes **additional storage**
- Rule: Index columns used in `WHERE`, `JOIN`, `ORDER BY`, and `GROUP BY` clauses

---

## 4. Replication

### What is Replication?
Copying data across multiple nodes to achieve **high availability**, **fault tolerance**, and **read scalability**.

### Replication Models
| Model | Description |
|---|---|
| **Single-Leader (Master-Replica)** | All writes go to the leader; replicas handle reads |
| **Multi-Leader** | Multiple nodes accept writes; conflict resolution needed |
| **Leaderless (Quorum-based)** | Writes/reads go to multiple nodes; no single leader (e.g., Dynamo-style) |

### Replication Lag
- **Synchronous:** Leader waits for replica acknowledgment before confirming write. Strong consistency, higher latency.
- **Asynchronous:** Leader confirms write immediately; replicas sync later. Lower latency, risk of stale reads.
- **Semi-synchronous:** At least one replica must acknowledge.

### Trade-offs
- ✅ High availability — system survives node failures
- ✅ Read scalability — distribute read load across replicas
- ❌ **Replication lag** can cause stale reads
- ❌ **Write conflicts** in multi-leader setups

---

## 5. Sharding (Horizontal Partitioning)

### What is Sharding?
Splitting a large dataset across multiple database nodes (**shards**), each holding a subset of the data.

### Sharding Strategies
| Strategy | Description | Trade-offs |
|---|---|---|
| **Range-based** | Shard by value range (e.g., user ID 1–1M on shard 1) | Simple, but risk of **hot spots** |
| **Hash-based** | Apply a hash function to the key | Even distribution, but range queries are expensive |
| **Directory-based** | A lookup service maps keys to shards | Flexible, but the directory itself is a bottleneck |
| **Geographic** | Shard by region/location | Low latency for users, complex cross-region queries |

### Consistent Hashing
- Used to minimize data redistribution when adding/removing shards
- Maps nodes and data keys to a ring; data is assigned to the nearest clockwise node
- **Used by:** Amazon DynamoDB, Cassandra

### Trade-offs
- ✅ Horizontal scalability — distribute data and load
- ✅ Enables massive datasets that exceed single-node capacity
- ❌ **Cross-shard queries** (JOINs) are complex and expensive
- ❌ **Rebalancing** is operationally challenging
- ❌ Loss of ACID guarantees across shards without distributed transactions

---

## 6. CAP Theorem

> A distributed system can only guarantee **two out of three** properties simultaneously.

| Property | Description |
|---|---|
| **Consistency (C)** | Every read receives the most recent write |
| **Availability (A)** | Every request receives a response (not necessarily up-to-date) |
| **Partition Tolerance (P)** | System continues operating despite network partitions |

Since **network partitions are inevitable**, the real choice is **CP vs AP**.

| System Type | Example Systems |
|---|---|
| **CP** (consistent, partition-tolerant) | HBase, Zookeeper, MongoDB (strong mode) |
| **AP** (available, partition-tolerant) | Cassandra, DynamoDB, CouchDB |
| **CA** (not partition-tolerant) | Traditional RDBMS on a single node |

---

## 7. PACELC Theorem (Extension of CAP)

Even when there's **no partition**, there is a trade-off between **latency (L)** and **consistency (C)**.

> **If Partition:** choose between Availability and Consistency.
> **Else (normal operation):** choose between Latency and Consistency.

| System | Partition Choice | Normal Choice |
|---|---|---|
| DynamoDB | A | L |
| Cassandra | A | L |
| Google Spanner | C | C |
| CockroachDB | C | C |

---

## 8. Normalization vs. Denormalization

### Normalization
- Organizing data to **reduce redundancy** by splitting into related tables
- Normal Forms: 1NF → 2NF → 3NF → BCNF
- **Pros:** Less storage, data integrity, easier updates
- **Cons:** More JOINs = slower reads

### Denormalization
- **Intentionally introducing redundancy** to optimize read performance
- Pre-joining or duplicating data to reduce query complexity
- **Pros:** Faster reads, simpler queries
- **Cons:** Higher storage, risk of data inconsistency, more complex writes

### When to Use What
| Scenario | Recommendation |
|---|---|
| Write-heavy OLTP | Normalized |
| Read-heavy analytics | Denormalized |
| Caching layer | Denormalized (e.g., pre-aggregated) |

---

## 9. OLTP vs OLAP

| Attribute | OLTP | OLAP |
|---|---|---|
| **Purpose** | Day-to-day transactions | Analytics & reporting |
| **Query Type** | Short, simple queries on rows | Long, complex queries on columns |
| **Data Volume** | Current/recent data | Historical data (years) |
| **Optimization** | Low latency, high throughput | High throughput reads |
| **Schema** | Normalized (3NF) | Denormalized (Star/Snowflake schema) |
| **Examples** | MySQL, PostgreSQL | Redshift, BigQuery, Snowflake |

---

## 10. Database Scaling Patterns

### Vertical Scaling (Scale Up)
- Add more CPU, RAM, or storage to existing server
- Simple but has a **hard upper limit** and creates a **single point of failure**

### Horizontal Scaling (Scale Out)
- Add more database nodes
- Requires **sharding** or a distributed database
- More complex to manage

### Read Replicas
- Route read traffic to replica nodes
- Reduces load on the primary
- Introduces **replication lag**

### Connection Pooling
- Reuse database connections instead of creating new ones per request
- **Tools:** PgBouncer (PostgreSQL), HikariCP (Java)
- Critical for high-concurrency applications

### Caching Layer
- Place an in-memory cache (Redis, Memcached) in front of the database
- **Cache-aside:** App checks cache first; on miss, reads DB and populates cache
- **Write-through:** Write to cache and DB simultaneously
- **Write-behind:** Write to cache first; async sync to DB

---

## 11. Transactions & Concurrency Control

### Isolation Levels (SQL Standard)
| Level | Dirty Read | Non-Repeatable Read | Phantom Read |
|---|---|---|---|
| **Read Uncommitted** | ✅ Possible | ✅ Possible | ✅ Possible |
| **Read Committed** | ❌ Prevented | ✅ Possible | ✅ Possible |
| **Repeatable Read** | ❌ Prevented | ❌ Prevented | ✅ Possible |
| **Serializable** | ❌ Prevented | ❌ Prevented | ❌ Prevented |

### Concurrency Control Methods
- **Pessimistic Locking:** Acquire a lock before reading/writing; blocks other transactions
- **Optimistic Locking:** Allow concurrent access; detect conflicts at commit time using a version number
- **MVCC (Multi-Version Concurrency Control):** Maintain multiple versions of data; readers don't block writers (used by PostgreSQL, MySQL InnoDB)

---

## 12. Storage Engines

### Row-Oriented Storage
- Stores entire rows together on disk
- Optimized for **OLTP** — reading or writing full records
- **Examples:** InnoDB (MySQL), PostgreSQL heap

### Column-Oriented Storage
- Stores each column's values together
- Optimized for **OLAP** — aggregating specific columns across many rows
- Better compression ratios
- **Examples:** Apache Parquet, Redshift, Snowflake

### LSM-Tree (Log-Structured Merge-Tree)
- Writes go to an in-memory buffer (MemTable), then flushed to sorted immutable files (SSTables)
- Excellent **write throughput** with sequential I/O
- **Used by:** Cassandra, RocksDB, LevelDB

### B-Tree
- Standard for most RDBMS
- Optimized for **reads** with in-place updates
- Higher write amplification than LSM

---

## 13. Trade-off Summary Table

| Decision | Option A | Option B | Key Consideration |
|---|---|---|---|
| SQL vs NoSQL | Strong consistency, complex queries | High scalability, flexible schema | Data model & consistency requirements |
| Normalization vs Denormalization | Data integrity | Read performance | Read-to-write ratio |
| Replication sync vs async | Strong consistency | Lower latency | Tolerance for stale reads |
| Range vs Hash sharding | Range queries | Even distribution | Query patterns |
| OLTP vs OLAP | Transactional workloads | Analytics workloads | Use case |
| Pessimistic vs Optimistic locking | No conflicts, but slower | Faster, but retry on conflict | Contention level |

---

## 14. Real-World Systems & How They Use Databases

| Company / System | Database(s) Used | Reason |
|---|---|---|
| **Instagram** | PostgreSQL + Cassandra | PostgreSQL for social graph, Cassandra for activity feeds at scale |
| **Netflix** | Cassandra + MySQL + EVCache | Cassandra for viewing history (AP, massive writes); MySQL for billing |
| **Uber** | MySQL → Schemaless (Cassandra-backed) | Needed geo-partitioned, highly available storage for trip data |
| **Twitter/X** | MySQL + Manhattan (Cassandra-based) | Manhattan for tweets/timelines; MySQL for user metadata |
| **WhatsApp** | Erlang + Mnesia + SCYLLADB | Low-latency message delivery with high write throughput |
| **Airbnb** | MySQL + Elasticsearch | MySQL for transactional data; Elasticsearch for search/listings |
| **LinkedIn** | Voldemort (key-value) + Espresso (document) | Custom stores for profile and activity feed data at scale |
| **Google** | Bigtable + Spanner | Bigtable for large-scale NoSQL (Search index); Spanner for globally consistent SQL |
| **Amazon** | DynamoDB | Built from Dynamo paper; AP key-value for cart, sessions, catalog |
| **Pinterest** | MySQL + HBase + S3 | MySQL for graph; HBase for wide-column pin data; S3 for media |
| **Slack** | MySQL + Vitess | MySQL for messages; Vitess for horizontal sharding of MySQL |

---

## 15. Choosing a Database — Decision Guide

```
Is data relational with complex queries?
  └── YES → SQL (PostgreSQL, MySQL)
  └── NO  → What is the access pattern?
              ├── Simple key lookups / caching     → Key-Value (Redis, DynamoDB)
              ├── Flexible nested/hierarchical docs → Document DB (MongoDB, Firestore)
              ├── Write-heavy, time-series data     → Column-Family (Cassandra) / TimeSeries (InfluxDB)
              ├── Complex relationship traversal    → Graph DB (Neo4j)
              └── Full-text search                  → Search Engine (Elasticsearch)
```

---

*These notes are intended for system design interviews and architectural decision-making.*