# SQL vs NoSQL — System Design Notes

---

## Overview

| | SQL (Relational) | NoSQL (Non-Relational) |
|---|---|---|
| **Data Model** | Tables with rows & columns | Document, Key-Value, Column-Family, Graph |
| **Schema** | Fixed, predefined | Dynamic / schema-less |
| **Query Language** | Structured Query Language (SQL) | Varies by database |
| **Scaling** | Vertical (scale-up) | Horizontal (scale-out) |
| **ACID** | Strongly guaranteed | Varies (BASE model often used) |
| **Joins** | Native, powerful | Limited or application-level |
| **Consistency** | Strong consistency | Eventual consistency (often) |

---

## SQL (Relational Databases)

### Core Properties

- **ACID Transactions**: Atomicity, Consistency, Isolation, Durability — guarantees data integrity.
- **Structured Schema**: Data is organized in tables with defined types per column.
- **Normalization**: Reduces data redundancy via foreign keys and relational joins.
- **Declarative Queries**: SQL is expressive and standardized across vendors.

### When to Use SQL

- Data has clear, stable relationships (e.g., users → orders → products).
- Application requires multi-row / multi-table transactions (e.g., banking, billing).
- Complex querying, filtering, aggregation, and reporting are needed.
- Strong consistency is non-negotiable.
- Team has strong SQL expertise.

### Limitations

- **Vertical scaling** is expensive and has a ceiling.
- Schema changes (migrations) are costly on large tables.
- Poor fit for hierarchical, graph, or unstructured data.
- Joins across huge datasets become performance bottlenecks.

### Popular Databases

| Database | Notable Use |
|---|---|
| **PostgreSQL** | General-purpose, supports JSON, extensions |
| **MySQL / MariaDB** | Web apps, widely deployed |
| **SQLite** | Embedded / mobile / local apps |
| **Amazon Aurora** | Cloud-native, MySQL/Postgres-compatible |
| **Google Spanner** | Globally distributed SQL with strong consistency |
| **CockroachDB** | Distributed SQL, geo-partitioning |

---

## NoSQL (Non-Relational Databases)

### Types of NoSQL

#### 1. Document Stores
- Store data as JSON/BSON documents.
- Flexible schema — each document can have different fields.
- Good for: Content management, catalogs, user profiles.
- **Examples**: MongoDB, Couchbase, Firestore.

#### 2. Key-Value Stores
- Simplest model: a key maps to a value (string, blob, JSON).
- Extremely fast reads/writes.
- Good for: Caching, sessions, leaderboards, rate limiting.
- **Examples**: Redis, DynamoDB (also supports docs), Memcached.

#### 3. Column-Family Stores (Wide-Column)
- Data is stored by columns grouped into "column families."
- Optimized for write-heavy workloads and time-series data.
- Good for: IoT telemetry, analytics, audit logs.
- **Examples**: Apache Cassandra, HBase, Google Bigtable.

#### 4. Graph Databases
- Nodes and edges represent entities and relationships.
- Optimal for traversing deep, interconnected relationships.
- Good for: Social networks, recommendation engines, fraud detection.
- **Examples**: Neo4j, Amazon Neptune, ArangoDB.

### When to Use NoSQL

- Data is unstructured, semi-structured, or rapidly evolving.
- System requires massive horizontal scalability (millions of writes/sec).
- High availability is prioritized over strong consistency.
- Use case fits a specific data model (graph, time-series, key-value).
- Geo-distributed writes with low latency are required.

### Limitations

- Lack of ACID transactions (though improving — MongoDB 4.0+, DynamoDB transactions).
- No standardized query language; steep learning curve per database.
- Complex relationships are hard to model and query efficiently.
- Eventual consistency can surface stale data if not handled carefully.

---

## Trade-offs

### 1. Consistency vs. Availability (CAP Theorem)
- SQL databases prioritize **CP** (Consistency + Partition Tolerance).
- Most NoSQL databases prioritize **AP** (Availability + Partition Tolerance).
- **Design decision**: Can your system tolerate stale reads? (e.g., a social media feed can; a bank account balance cannot.)

### 2. Schema Flexibility vs. Data Integrity
- NoSQL's schema-less nature speeds up development but risks data inconsistency.
- SQL enforces constraints at the database level (NOT NULL, FOREIGN KEY, CHECK).
- **Design decision**: Who owns data validation — the DB or the application?

### 3. Scaling Strategy
- SQL scales **vertically** (bigger machine) — simpler but costly and bounded.
- NoSQL scales **horizontally** (more machines via sharding) — complex but nearly unbounded.
- **Design decision**: What is your expected data volume and write throughput in 2–5 years?

### 4. Query Complexity
- SQL handles ad-hoc, complex queries natively via JOINs and aggregations.
- NoSQL often requires denormalization and duplication to avoid expensive lookups.
- **Design decision**: Is your access pattern known and narrow, or unknown and complex?

### 5. Operational Maturity
- SQL (PostgreSQL, MySQL) has decades of tooling, ORMs, monitoring, and DBA expertise.
- NoSQL ecosystems are younger with more variation in operational complexity.
- **Design decision**: What does your team know? What does your ops infrastructure support?

### 6. Cost
- Horizontal scaling (NoSQL) uses commodity hardware and is often cheaper at scale.
- Large SQL instances on cloud providers (RDS, Cloud SQL) can be expensive.
- **Design decision**: Are you optimizing for upfront simplicity or long-term scale cost?

---

## Consistency Models

| Model | Description | Used In |
|---|---|---|
| **Strong Consistency** | All reads reflect the latest write | PostgreSQL, Spanner |
| **Eventual Consistency** | Reads may be stale; converges over time | Cassandra, DynamoDB (default) |
| **Read-Your-Writes** | User always sees their own writes | Many configs of MongoDB, DynamoDB |
| **Monotonic Reads** | User never reads older data after newer | Configurable in many systems |
| **Causal Consistency** | Operations that are causally related appear in order | MongoDB, some distributed SQL |

---

## Scaling Patterns

### SQL Scaling Techniques
- **Read Replicas**: Route read traffic to replicas; writes go to primary.
- **Connection Pooling**: Use PgBouncer, ProxySQL to reduce connection overhead.
- **Sharding**: Partition data by user_id, region, etc. (complex, often avoided until necessary).
- **Caching Layer**: Add Redis/Memcached in front of SQL for hot data.
- **Vertical Scaling**: Increase CPU, RAM, faster SSDs on the primary instance.

### NoSQL Scaling Techniques
- **Consistent Hashing**: Distribute keys across nodes with minimal reshuffling on node changes.
- **Replication Factor**: Control how many copies of data exist across nodes (Cassandra default: 3).
- **Partitioning / Sharding**: Built-in for most NoSQL databases.
- **Multi-Region Writes**: Cassandra, DynamoDB Global Tables, CockroachDB support geo-distributed writes natively.

---

## Real-World Systems and Applications

### SQL in Production

| Company | Database | Use Case |
|---|---|---|
| **GitHub** | MySQL (Vitess) | Core user/repo/PR data with relational integrity |
| **Shopify** | MySQL | Orders, inventory, payments — ACID critical |
| **Instagram** | PostgreSQL | User data, posts, social graph (early stages) |
| **Airbnb** | MySQL + Amazon RDS | Bookings, payments, hosts, listings |
| **Stripe** | PostgreSQL | Financial transactions — strong consistency required |
| **LinkedIn** | MySQL | Member profiles, connections (with custom sharding) |

### NoSQL in Production

| Company | Database | Use Case |
|---|---|---|
| **Netflix** | Cassandra | Viewing history, user activity logs — write-heavy, high availability |
| **Uber** | Cassandra + Schemaless (MySQL-backed) | Trips, driver location events, geospatial data |
| **Discord** | Cassandra → ScyllaDB | Message storage — billions of messages, time-ordered access |
| **Amazon** | DynamoDB | Shopping cart, sessions, product catalog |
| **Twitter/X** | Manhattan (Cassandra-based) | Tweets, timelines, social graph |
| **Facebook** | TAO (MySQL-backed graph store) | Social graph traversal at massive scale |
| **Spotify** | Cassandra | User playlists, listening history |
| **MongoDB Atlas** | MongoDB | Content platforms, e-commerce catalogs |

---

## Hybrid Approaches (Polyglot Persistence)

Most large-scale systems use **both** SQL and NoSQL for different parts of the system.

```
Example: E-Commerce Platform

┌─────────────────────────────────────────────┐
│              E-Commerce System               │
├────────────┬──────────────┬─────────────────┤
│ PostgreSQL │    Redis     │    Cassandra    │
│            │              │                 │
│ - Users    │ - Sessions   │ - User activity │
│ - Orders   │ - Cart cache │ - Product views │
│ - Payments │ - Rate limit │ - Search logs   │
│ - Products │ - Hot items  │ - Recommendations│
└────────────┴──────────────┴─────────────────┘
```

**Pattern**: Use SQL for transactional core, NoSQL for high-throughput peripheral data.

---

## Decision Framework

```
Start Here
    │
    ▼
Is your data highly relational
with complex joins needed?
    │
   YES ──────────────────────────► Use SQL (PostgreSQL / MySQL)
    │
    NO
    │
    ▼
Do you need ACID transactions
across multiple entities?
    │
   YES ──────────────────────────► Use SQL or NewSQL (Spanner, CockroachDB)
    │
    NO
    │
    ▼
What is your primary access pattern?
    │
    ├─ Simple key lookups / caching ──────────► Key-Value (Redis, DynamoDB)
    ├─ Flexible document queries ─────────────► Document (MongoDB, Firestore)
    ├─ Time-series / append-heavy writes ─────► Wide-Column (Cassandra, Bigtable)
    └─ Graph traversal / relationships ───────► Graph DB (Neo4j, Neptune)
```

---

## Key Interview / Design Points

- **Default to SQL** unless you have a specific, justified reason not to. It's easier to operate and reason about.
- **Premature NoSQL adoption** is a common mistake. Start with PostgreSQL; migrate when proven necessary.
- **Denormalization** is the primary NoSQL design strategy — model data around query patterns, not around entities.
- **CAP Theorem** is a useful mental model but real systems involve nuanced trade-offs (PACELC is more precise).
- **NewSQL** (Spanner, CockroachDB) blurs the line — distributed, horizontally scalable SQL with ACID guarantees.
- **Caching** (Redis) is often the first scaling lever before switching database paradigms.
- Always ask: **"What are my read/write ratios?" and "What are my consistency requirements?"** These two questions drive most database decisions.