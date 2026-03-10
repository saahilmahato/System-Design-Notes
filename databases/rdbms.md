# RDBMS — System Design Notes

---

## What is an RDBMS?

A **Relational Database Management System (RDBMS)** stores data in structured tables (relations) with predefined schemas. Data is organized into rows and columns, and relationships between tables are enforced via **foreign keys**. SQL (Structured Query Language) is the standard interface for querying and manipulating data.

> Core idea: Data integrity and consistency are first-class citizens.

---

## Core Concepts

### ACID Properties
The foundation of relational databases. Every transaction guarantees:

| Property | Meaning |
|---|---|
| **Atomicity** | A transaction is all-or-nothing. If one step fails, everything rolls back. |
| **Consistency** | A transaction brings the database from one valid state to another, respecting all rules and constraints. |
| **Isolation** | Concurrent transactions don't interfere with each other. Results are as if they ran serially. |
| **Durability** | Once committed, a transaction persists even after a crash (written to disk/WAL). |

---

### Schema & Data Modeling

- **Normalization** — Organizing data to reduce redundancy. Common normal forms:
  - **1NF**: Atomic values, no repeating groups.
  - **2NF**: No partial dependencies on composite keys.
  - **3NF**: No transitive dependencies. Most production systems target 3NF.
  - **BCNF / 4NF / 5NF**: Stricter forms used in specific scenarios.
- **Denormalization** — Intentionally introducing redundancy for **read performance** (common in analytics or high-read systems).
- **Schema-on-write** — Schema must be defined before inserting data. Changes require migrations.

---

### Indexes

Indexes speed up reads at the cost of write overhead and storage.

| Index Type | Use Case |
|---|---|
| **B-Tree** (default) | Range queries, equality lookups. Used by most RDBMS by default. |
| **Hash Index** | Exact equality lookups only. Very fast, no range support. |
| **Composite Index** | Multiple columns; column order matters (leftmost prefix rule). |
| **Partial Index** | Index on a subset of rows (`WHERE` condition). |
| **Covering Index** | Includes all columns needed by a query, avoiding a table lookup. |
| **Full-Text Index** | Tokenized search within text columns. |

**Key rule:** Every index speeds up reads but slows down `INSERT`, `UPDATE`, `DELETE`. Over-indexing is a common mistake.

---

### Transactions & Isolation Levels

Isolation levels control the visibility of in-progress changes between concurrent transactions.

| Isolation Level | Dirty Read | Non-Repeatable Read | Phantom Read |
|---|---|---|---|
| **Read Uncommitted** | ✅ Possible | ✅ Possible | ✅ Possible |
| **Read Committed** | ❌ Prevented | ✅ Possible | ✅ Possible |
| **Repeatable Read** | ❌ Prevented | ❌ Prevented | ✅ Possible |
| **Serializable** | ❌ Prevented | ❌ Prevented | ❌ Prevented |

> Most production systems default to **Read Committed** (PostgreSQL, Oracle) or **Repeatable Read** (MySQL InnoDB). Serializable is the safest but has the highest contention.

---

### Locking & Concurrency

- **Pessimistic Locking** — Lock rows on read (`SELECT FOR UPDATE`). Safe but can cause bottlenecks.
- **Optimistic Locking** — No locks on read; check a version/timestamp at write time. If conflict, retry. Better throughput for low-conflict workloads.
- **MVCC (Multi-Version Concurrency Control)** — Readers don't block writers and vice versa. PostgreSQL and MySQL InnoDB use MVCC. Each transaction sees a snapshot of the database.
- **Deadlocks** — Two transactions waiting on each other's locks. RDBMS detect and resolve by killing one transaction. Applications must handle and retry.

---

### Query Planner & Optimization

- The **query planner/optimizer** decides how to execute a SQL query (which indexes to use, join order, etc.).
- Use `EXPLAIN` / `EXPLAIN ANALYZE` to inspect execution plans.
- **Sequential scan** vs **Index scan** — The planner chooses based on table statistics. Outdated statistics can cause bad plans; run `ANALYZE` regularly.
- **N+1 query problem** — A common anti-pattern. Fetching a list, then querying the DB once per item. Fix with `JOIN` or batch loading (`IN` clause).

---

### Joins

| Join Type | Behavior |
|---|---|
| `INNER JOIN` | Only matching rows from both tables. |
| `LEFT JOIN` | All rows from left table; NULLs for non-matching right rows. |
| `RIGHT JOIN` | All rows from right table; NULLs for non-matching left rows. |
| `FULL OUTER JOIN` | All rows from both tables; NULLs where no match. |
| `CROSS JOIN` | Cartesian product of both tables. Use carefully. |

> In system design interviews: large joins on unindexed foreign keys are a **major performance risk** at scale.

---

### Replication

Replication copies data to multiple nodes for **availability** and **read scalability**.

- **Primary-Replica (Master-Slave)** — Writes go to primary. Replicas serve reads. Replica lag is a key concern.
- **Synchronous Replication** — Primary waits for replica to confirm write. Strong consistency, higher latency.
- **Asynchronous Replication** — Primary doesn't wait. Lower latency, but replica may lag; risk of data loss on failover.
- **Multi-Primary (Multi-Master)** — Multiple nodes accept writes. Complex conflict resolution. Used in geo-distributed setups.

---

### Sharding (Horizontal Partitioning)

Splitting data across multiple database instances (shards) to scale writes beyond a single node.

- **Range-based sharding** — e.g., users A–M on shard 1, N–Z on shard 2. Simple but can cause **hot spots**.
- **Hash-based sharding** — Hash of shard key determines shard. Even distribution but hard to do range queries.
- **Directory-based sharding** — A lookup table maps keys to shards. Flexible but adds a lookup overhead.

**Challenges:**
- Cross-shard queries and joins become complex.
- Transactions across shards require distributed protocols (2PC).
- Resharding is expensive and operationally painful.

---

### Vertical vs Horizontal Scaling

| Strategy | Description | Limitation |
|---|---|---|
| **Vertical Scaling** | Bigger server (more CPU, RAM, faster disk) | Hard ceiling; single point of failure |
| **Horizontal Scaling (Read)** | Add read replicas | Only helps read-heavy workloads |
| **Horizontal Scaling (Write)** | Sharding | Complexity; no cross-shard ACID |

---

### Connection Pooling

Databases have a finite number of connections. Each connection is expensive (memory, file descriptors).

- Use a **connection pooler** (e.g., PgBouncer for PostgreSQL) to reuse connections across application threads.
- Without pooling, a spike in traffic can exhaust connections and crash the DB.
- Key config: **pool size** = (number of CPU cores × 2) + effective spindle count (PgBouncer heuristic).

---

### CAP Theorem Context

RDBMS traditionally prioritizes **Consistency** and **Partition Tolerance** when deployed as distributed systems — but in practice, single-node RDBMS sacrifice partition tolerance for **CA** (Consistency + Availability on a single node, within a data center).

When network partitions occur in replicated setups, most RDBMS choose **CP** — they stop accepting writes rather than risk inconsistency.

---

## Trade-offs

### ✅ Strengths

- **Strong consistency** — ACID guarantees make it the right choice for financial, medical, and legal systems.
- **Powerful querying** — SQL is expressive. Complex joins, aggregations, subqueries, and window functions are easy to express.
- **Data integrity** — Foreign keys, constraints, and triggers enforce rules at the database level.
- **Mature ecosystem** — Decades of tooling, ORMs, monitoring, backup, and migration tools.
- **Transactions** — Multi-row, multi-table atomic operations are straightforward.
- **Schema enforcement** — Prevents bad data from entering the system.

### ❌ Weaknesses

- **Vertical scaling limit** — A single node has a hard ceiling. Horizontal write scaling (sharding) is complex.
- **Schema rigidity** — Changing schema at scale requires migrations, which can lock tables or require careful multi-step rollouts.
- **Object-relational impedance mismatch** — Mapping objects/entities in code to relational tables adds friction (mitigated by ORMs, but not eliminated).
- **Write bottleneck** — All writes go to the primary in standard setups. Under extreme write load, this becomes a bottleneck.
- **Not ideal for unstructured/hierarchical data** — JSON/XML/tree structures feel unnatural in tables (though modern RDBMS like PostgreSQL support JSON columns).
- **Joins at scale** — Large joins on huge tables can be slow and costly, especially without careful indexing.

---

## When to Choose RDBMS

Use RDBMS when:

- Data has **clear relationships** and needs **referential integrity**.
- You need **multi-row transactional guarantees** (e.g., transferring money between accounts).
- Your **query patterns are varied and unpredictable** — SQL is flexible enough to answer ad hoc questions.
- **Data correctness > raw throughput** (banking, e-commerce orders, healthcare records).
- Your write load is manageable on a single primary (with read replicas for scale).

Avoid or supplement RDBMS when:

- You need to store **massive unstructured or semi-structured data** (use document DB).
- You need **extreme write throughput** across many nodes (use NoSQL or NewSQL).
- Your data model is **graph-shaped** (use a graph DB).
- You need **time-series** data at scale (use a time-series DB).

---

## Real-World Systems & Applications

### 1. **PostgreSQL** — Most advanced open-source RDBMS
- Used by: **Instagram, Shopify, Notion, GitHub, Twitch, Discord (partially)**
- Notable: MVCC, JSONB support, full-text search, PostGIS for geospatial data, logical replication.
- Instagram used PostgreSQL for its core data store and scaled it heavily with sharding (later moved some workloads to Cassandra for feed data).

### 2. **MySQL / InnoDB** — Most popular open-source RDBMS
- Used by: **Airbnb, Uber (historically), Facebook, Twitter (historically), Booking.com, YouTube**
- Facebook runs one of the largest MySQL deployments in the world with a custom replication and sharding layer.
- Uber migrated from PostgreSQL to MySQL due to replication behavior differences for their write-heavy, replication-sensitive workload.

### 3. **Amazon RDS / Aurora** — Managed RDBMS on AWS
- Aurora is a cloud-native RDBMS compatible with MySQL/PostgreSQL with 5× MySQL performance.
- Used by: **Netflix, Airbnb, Samsung, Dow Jones**
- Aurora separates compute from storage and replicates storage 6 ways across 3 AZs.

### 4. **Google Spanner** — Globally distributed RDBMS
- Used by: **Google (Ads, F1 database), Snap, Mercado Libre**
- Achieves external consistency (stronger than serializable) globally using TrueTime (GPS + atomic clocks).
- The paper "F1: A Distributed SQL Database That Scales" (Google, 2013) is a landmark in this space.

### 5. **CockroachDB / YugabyteDB** — NewSQL (distributed RDBMS)
- Target: Global, horizontally scalable, ACID-compliant SQL databases.
- Used when teams want RDBMS semantics without the manual sharding of Postgres/MySQL.

### 6. **Financial Systems** — Core banking, payment processors
- Visa, Mastercard, and virtually all core banking systems run on RDBMS (Oracle, DB2, SQL Server).
- Multi-row ACID transactions are non-negotiable for financial ledgers.

### 7. **E-Commerce** — Orders, inventory, payments
- **Amazon's original store**, Shopify, and most e-commerce platforms use RDBMS for order management, inventory, and payment records.
- These systems require consistency: you cannot oversell inventory or double-charge a customer.

---

## Common System Design Patterns with RDBMS

### Read Replicas + Caching Layer
```
Client → Cache (Redis) → Read Replica (Postgres)
                   ↘ Primary (Postgres) ← Write path
```
- Offload reads to replicas and cache.
- Cache frequently read, rarely changed data (product listings, user profiles).

### CQRS (Command Query Responsibility Segregation)
- **Write model** → Normalized RDBMS (for consistency).
- **Read model** → Denormalized read replicas or separate read stores (for performance).
- Useful when read and write patterns differ significantly.

### Event Sourcing + RDBMS
- Store all state changes as an **event log** in the DB.
- Current state is derived by replaying events.
- The RDBMS acts as the source of truth for the event log.

### Outbox Pattern
- Avoid dual-write problems (writing to DB + publishing to a message queue atomically).
- Write the event to an **outbox table** in the same DB transaction as the business data.
- A separate process reads the outbox and publishes to the queue.
- Guarantees at-least-once delivery without distributed transactions.

---

## Key Metrics to Monitor in Production

| Metric | Why It Matters |
|---|---|
| **Query latency (p50, p95, p99)** | Detect slow queries before users notice |
| **Connections used / max connections** | Prevent connection exhaustion |
| **Replication lag** | Stale reads on replicas; risk of data loss on failover |
| **Cache hit ratio** | Low ratio = more DB load |
| **Lock wait time / deadlock rate** | Concurrency bottlenecks |
| **Disk I/O & WAL write throughput** | Write bottlenecks |
| **Table bloat (dead tuples in Postgres)** | Needs `VACUUM` to reclaim space |
| **Index usage ratio** | Identify unused indexes (write overhead) |

---

## Summary

| Aspect | RDBMS Stance |
|---|---|
| **Data model** | Structured tables with fixed schema |
| **Query language** | SQL |
| **Consistency** | Strong (ACID) |
| **Scalability** | Vertically; read horizontally via replicas; write horizontally via sharding (complex) |
| **Best for** | Transactional, relational, correctness-critical workloads |
| **Avoid for** | Massive unstructured data, extreme write fan-out, flexible schema needs |