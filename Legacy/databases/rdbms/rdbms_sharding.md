# RDBMS: Sharding

## Table of Contents
1. [What is Sharding?](#what-is-sharding)
2. [Why Shard?](#why-shard)
3. [Core Concepts](#core-concepts)
4. [Sharding Strategies](#sharding-strategies)
5. [Shard Key Selection](#shard-key-selection)
6. [Architecture Patterns](#architecture-patterns)
7. [Trade-offs](#trade-offs)
8. [Challenges & Pitfalls](#challenges--pitfalls)
9. [Cross-Shard Operations](#cross-shard-operations)
10. [Rebalancing](#rebalancing)
11. [Real-World Systems](#real-world-systems)
12. [Decision Framework](#decision-framework)
13. [Quick Reference](#quick-reference)

---

## What is Sharding?

**Sharding** (also called *horizontal partitioning*) is the practice of splitting a single large database into smaller, faster, more manageable pieces called **shards**, each of which is a separate database instance holding a subset of the total data.

```
                        ┌─────────────────────────────────┐
                        │         Application Layer        │
                        └───────────────┬─────────────────┘
                                        │
                        ┌───────────────▼─────────────────┐
                        │         Shard Router /           │
                        │       Query Coordinator          │
                        └──────┬──────────┬───────┬───────┘
                               │          │       │
                    ┌──────────▼──┐  ┌────▼────┐  ┌▼────────┐
                    │  Shard 0    │  │ Shard 1 │  │ Shard 2 │
                    │ users 0-33M │  │34M-67M  │  │68M-100M │
                    │ (Primary +  │  │(Primary │  │(Primary │
                    │  Replicas)  │  │+Replicas│  │+Replicas│
                    └─────────────┘  └─────────┘  └─────────┘
```

### Sharding vs. Other Scaling Techniques

| Technique | What scales | How |
|---|---|---|
| **Vertical Scaling** | Single node | Bigger hardware (CPU, RAM, SSD) |
| **Read Replicas** | Read throughput | Copy data to multiple nodes |
| **Caching** | Read throughput | Serve data from memory |
| **Sharding** | Write throughput + storage | Partition data across nodes |

> **Rule of thumb**: Reach for caching and read replicas first. Shard only when writes or storage are the bottleneck.

---

## Why Shard?

### Problems Sharding Solves
- **Write bottleneck**: A single primary can handle ~10K–50K writes/sec; sharding multiplies this linearly.
- **Storage limits**: A single machine's disk is finite; shards distribute data across many machines.
- **Memory pressure**: Working sets too large to fit in RAM; each shard's working set is smaller.
- **Lock contention**: High-concurrency workloads cause table/row lock contention on one node.
- **Query latency**: Smaller datasets per shard mean faster full-table scans and index operations.

### When to Shard
- Dataset exceeds the capacity of the largest feasible single machine (multi-TB+).
- Write throughput consistently saturates the primary.
- Index sizes grow so large they no longer fit in RAM.
- Regulatory requirements mandate geographic data isolation.

---

## Core Concepts

### Shard
An independent database instance responsible for a distinct subset of data. Each shard is fully self-contained and can (should) have its own replica set.

### Shard Key
The column (or composite columns) used to determine which shard a given row lives on. The most critical design decision in any sharded system.

### Shard Router / Coordinator
A middleware component that intercepts queries, resolves the target shard(s) based on the shard key, and routes or fans out accordingly.

### Shard Map / Catalog
A metadata store (often a dedicated database or ZooKeeper/etcd) that maps shard key ranges or hash buckets to physical shard locations.

```
Shard Map Example (Range-based):
┌───────────────┬─────────────┐
│  Key Range    │  Shard Node │
├───────────────┼─────────────┤
│ 0 – 999,999   │  shard-01   │
│ 1M – 1,999,999│  shard-02   │
│ 2M – 2,999,999│  shard-03   │
│ ...           │  ...        │
└───────────────┴─────────────┘
```

### Virtual Shards (VNodes)
A technique where many logical shards (e.g., 1024) are mapped to fewer physical nodes. Makes rebalancing easier — reassigning a VNode means moving a subset of logical shards, not all data.

---

## Sharding Strategies

### 1. Range-Based Sharding

Data is partitioned by contiguous ranges of the shard key (often numeric or timestamp).

```
user_id:
  Shard A → [0,       10,000,000)
  Shard B → [10M,     20,000,000)
  Shard C → [20M,     30,000,000)
```

**Pros:**
- Simple to understand and implement.
- Efficient range scans (e.g., "get all orders between Jan and Feb").
- Easy to direct time-series queries to recent shards.

**Cons:**
- **Hotspot risk**: New users always go to the last shard; recent timestamps create write hotspots.
- Uneven distribution if data isn't uniformly spread.

**Best for:** Time-series data (logs, events, IoT), archival systems, reporting databases.

---

### 2. Hash-Based Sharding

Apply a hash function to the shard key, then modulo by the number of shards.

```
shard_id = hash(user_id) % N

hash(user_1001) % 4 → Shard 2
hash(user_1002) % 4 → Shard 0
hash(user_1003) % 4 → Shard 3
```

**Pros:**
- Uniform, even data distribution.
- Eliminates write hotspots on insertion.

**Cons:**
- Range queries require scatter-gather across all shards.
- Resizing the number of shards (N) causes massive data reshuffling.
  - Mitigated with **consistent hashing**.

**Best for:** User data, product catalogs, session stores — high-write, key-based lookups.

---

### 3. Consistent Hashing

A variant of hash sharding where shards and keys are mapped onto a ring. Adding or removing a shard only affects its immediate neighbors on the ring.

```
         hash ring (0 → 2^32)

              key K1 →  Shard A
         ┌────────────────────────┐
    Shard D                   Shard A
         │          Ring          │
    Shard C                   Shard B
         └────────────────────────┘
              Shard C ← key K2

Adding Shard E between A and B:
  Only keys between A and E are moved from B → E.
  All other data stays in place.
```

**Pros:**
- Rebalancing affects only ~K/N keys (K = total keys, N = number of shards).
- Smooth horizontal scaling.

**Cons:**
- More complex to implement correctly.
- Uneven distribution without virtual nodes.

**Best for:** Distributed caches (Cassandra, DynamoDB), large-scale distributed databases.

---

### 4. Directory-Based Sharding (Lookup Table)

A central lookup service maps each entity's shard key to an explicit shard.

```
┌──────────┬──────────┐
│ tenant_id│  shard   │
├──────────┼──────────┤
│  acme    │ shard-05 │
│  globex  │ shard-02 │
│  initech │ shard-05 │
└──────────┴──────────┘
```

**Pros:**
- Maximum flexibility — any mapping is possible.
- Individual tenants/entities can be moved without changing the algorithm.
- Can co-locate related data explicitly.

**Cons:**
- Lookup service becomes a **single point of failure** and a **latency bottleneck**.
- Extra network hop on every query.
- Catalog must itself be highly available and consistent.

**Best for:** Multi-tenant SaaS, scenarios requiring manual shard assignment, compliance-driven geographic routing.

---

### 5. Geographic / Zone Sharding

Shards are assigned by region or geography. All data for users in EU lives on EU shards, US data on US shards.

**Pros:**
- Latency reduction (data close to users).
- Data sovereignty / GDPR compliance.

**Cons:**
- Uneven load if traffic is geographically imbalanced.
- Cross-region queries are expensive.

**Best for:** Global applications with legal data residency requirements (GDPR, CCPA, HIPAA).

---

## Shard Key Selection

The shard key is the most consequential design decision. A poor choice leads to **hotspots**, **cross-shard joins**, or **rebalancing nightmares**.

### Properties of a Good Shard Key

| Property | Why It Matters |
|---|---|
| **High cardinality** | Enough distinct values to spread data evenly |
| **Even distribution** | Avoids hotspots; no single value dominates |
| **Query alignment** | Most queries filter by this key → single-shard lookup |
| **Immutability** | Changing a shard key value requires moving the row |
| **Write spread** | New writes are distributed, not concentrated |

### Common Shard Key Choices

| Entity | Good Key | Why |
|---|---|---|
| Users | `user_id` (hash) | High cardinality, even distribution |
| Orders | `customer_id` (hash) | Co-locates a customer's orders |
| Messages | `conversation_id` | Co-locates a thread |
| Events/Logs | `(tenant_id, timestamp)` | Partition by tenant, range by time |
| Multi-tenant SaaS | `tenant_id` | Isolates tenant data |

### Anti-Patterns

```
❌ status (e.g., "active"/"inactive") → only 2 values, massive skew
❌ created_at alone → all new writes hit the latest shard
❌ country_code → 200 values, huge US/China skew
❌ boolean flags → catastrophic cardinality
```

---

## Architecture Patterns

### Pattern 1: Application-Level Sharding
The application contains sharding logic directly. Simple but creates tight coupling.

```
// Application resolves shard before querying
ShardId shard = hash(userId) % NUM_SHARDS;
DataSource ds = shardPool.get(shard);
ds.query("SELECT * FROM users WHERE id = ?", userId);
```

### Pattern 2: Middleware / Proxy Sharding
A proxy layer (e.g., Vitess, ProxySQL, Citus) handles routing transparently. The application talks to one logical database.

```
App → [Vitess / ProxySQL / pgBouncer + custom router] → Shard 0..N
```

### Pattern 3: Native Database Sharding
Some databases have built-in sharding:
- **Citus** (PostgreSQL extension): Distributes rows across worker nodes.
- **MySQL Cluster (NDB)**: Auto-shards data transparently.
- **CockroachDB / YugabyteDB**: NewSQL systems with built-in range sharding + Raft replication.

---

## Trade-offs

### Sharding Advantages

| Advantage | Detail |
|---|---|
| **Write scalability** | Each shard handles a fraction of total writes independently |
| **Storage scalability** | Add shards to expand total capacity linearly |
| **Fault isolation** | A shard failure affects only its fraction of data |
| **Smaller indexes** | Per-shard index fits in RAM → faster queries |
| **Geographic isolation** | Place shards close to users for latency and compliance |

### Sharding Disadvantages

| Disadvantage | Detail |
|---|---|
| **Operational complexity** | N databases to back up, monitor, upgrade, and maintain |
| **Cross-shard queries** | JOINs, aggregations require scatter-gather; high latency |
| **No cross-shard transactions** | ACID across shards requires distributed transactions (2PC) — slow and complex |
| **Hotspots** | Poor shard key choice concentrates load |
| **Rebalancing pain** | Repartitioning requires large data migrations |
| **Schema changes** | DDL must be applied to every shard |
| **Application complexity** | Routing logic, shard-aware queries add development overhead |
| **Data skew** | Uneven data size or access patterns cause imbalance |

### Sharding vs. Alternatives

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Scaling Decision Tree                           │
│                                                                     │
│   Is read throughput the bottleneck?                                │
│      └─ YES → Add read replicas / caching layer                    │
│                                                                     │
│   Is a single table too large for one machine?                      │
│      └─ YES → Consider partitioning (same node) first              │
│                                                                     │
│   Are writes saturating the primary?                                │
│      └─ YES → Are you sure you can't vertically scale?             │
│                   └─ YES → Evaluate sharding                       │
│                                                                     │
│   Do you need ACID across all entities?                             │
│      └─ YES → Consider NewSQL (CockroachDB, Spanner) over sharding │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Challenges & Pitfalls

### 1. Cross-Shard Joins
SQL JOINs across shards don't work natively. Solutions:
- **Denormalization**: Embed related data to avoid joins.
- **Application-side joins**: Fetch from each shard and merge in application code.
- **Reference tables**: Replicate small lookup tables to every shard.
- **Co-location**: Ensure related rows (e.g., user + orders) share the same shard key.

```
// Co-location: store order with customer_id as shard key
// → user and their orders always on the same shard
INSERT INTO orders (order_id, customer_id, ...) VALUES (...)
-- shard = hash(customer_id) % N
```

### 2. Distributed Transactions
ACID across shards requires **Two-Phase Commit (2PC)**:
- Phase 1: Coordinator sends "prepare" to all shards.
- Phase 2: If all ACK, coordinator sends "commit".

**Problems**: Slow, blocking, coordinator is a SPOF. Prefer:
- Sagas (compensating transactions).
- Event-driven eventual consistency.
- Re-designing to avoid cross-shard writes.

### 3. Hotspot / Hot Shard
One shard receives disproportionate traffic. Detection: monitor per-shard QPS, latency, CPU.

**Mitigation**:
- Better shard key (add randomness: `hash(user_id + random_suffix)`).
- Split the hot shard.
- Move hot rows to a dedicated shard.

### 4. Rebalancing
When adding/removing shards, data must be moved. During migration:
- Dual-write to old and new shard.
- Gradually migrate reads.
- Verify consistency.
- Cut over cleanly.

---

## Cross-Shard Operations

### Scatter-Gather (Fan-Out)
For queries that span shards (e.g., global aggregations):

```
Query: "Total orders in the last 24 hours"

Coordinator broadcasts query to all N shards in parallel
Shard 0 → count = 14,201
Shard 1 → count = 15,887
Shard 2 → count = 13,944
...
Coordinator aggregates: SUM = ...
```

**Latency** = max(individual shard latency), not sum.

### Global Secondary Indexes
Querying on a non-shard-key column (e.g., `email` when sharded by `user_id`) requires either:
- Scatter-gather across all shards.
- Maintaining a separate **global index shard** mapping email → user_id → shard.
- Using a complementary index store (Elasticsearch, Redis).

---

## Rebalancing

### When to Rebalance
- Shard data size grows beyond target threshold.
- Hot shard detected.
- Adding new shards to scale out.
- Removing underutilized shards.

### Rebalancing Strategies

| Strategy | Description | Risk |
|---|---|---|
| **Static partitioning** | Fixed N shards at design time, never change | Low risk but inflexible |
| **Virtual shards** | Many logical shards → fewer physical; remap VNodes | Moderate complexity |
| **Consistent hashing** | Only adjacent data moves when adding nodes | Low data movement |
| **Manual migration** | Ops team moves data with scripts | High risk, slow |
| **Online migration** | Dual-write, background copy, atomic cut-over | Safest, most complex |

### Online Rebalancing Process

```
Step 1: Identify target (new shard or existing shard for split)
Step 2: Begin dual-writing new data to both old and new shard
Step 3: Background job copies existing data from old → new shard
Step 4: Track replication lag; wait for convergence
Step 5: Flip reads to new shard for migrated range
Step 6: Stop dual-writing; remove data from old shard
Step 7: Update shard map
```

---

## Real-World Systems

### Instagram (2012)
- Sharded PostgreSQL by `user_id` using a **logical shard** approach.
- 512 logical shards mapped to physical machines; added machines by moving logical shards.
- Each shard was a PostgreSQL schema within a larger PostgreSQL instance.
- Relied on co-location: photos, follows, and user data shared the same `user_id` shard key.

### Pinterest
- Sharded MySQL by `user_id`.
- Early system: every entity (pin, board) had a globally unique ID encoding the `shard_id`.
- Custom shard-aware ID generator: `shard_id + type_id + local_id`.

### Uber (Schemaless / MySQL)
- Uses cell-based architecture: each city is a "cell" containing its own MySQL shard cluster.
- Trip data is sharded by `trip_uuid` within cells.
- Avoids cross-cell (cross-shard) queries by routing trips to the originating cell.

### Discord
- Sharded Cassandra (consistent hashing) for message storage.
- Shards messages by `(channel_id, bucket)` where `bucket = message_id / bucket_size`.
- This enables efficient range queries within a channel while distributing load.

### Shopify
- Multi-tenant sharding: each shop is a shard unit.
- MySQL pods host multiple shops; shops can be migrated between pods.
- Uses directory-based routing: a shard map database maps `shop_id → pod`.
- Enables seamless rebalancing by updating the shard map and migrating data.

### Vitess (YouTube / PlanetScale)
- Open-source MySQL sharding middleware used by YouTube.
- Transparently handles sharding, rebalancing, and routing.
- Supports online schema changes across shards.
- VSchema defines shard key and routing rules; application uses standard MySQL protocol.

### Facebook (MySQL + TAO)
- Thousands of MySQL shards per data center.
- TAO (The Associations and Objects) is a graph database layer on top that handles cross-shard association queries.
- Shards replicated across data centers; writes go to primary data center.

---

## Decision Framework

### Should You Shard?

```
1. Can you vertically scale (more RAM/CPU)?           YES → Do that first
2. Have you optimized indexes and queries?            NO  → Do that first
3. Have you added caching?                            NO  → Do that first
4. Have you added read replicas?                      NO  → Do that first
5. Is storage the bottleneck?                         YES → Shard (or archive old data)
6. Are writes saturating the primary?                 YES → Shard
7. Is working set too large for RAM?                  YES → Shard
8. Do you have geographic compliance requirements?    YES → Shard by region
```

### Choosing a Sharding Strategy

```
Need range queries on shard key?
  YES → Range-based sharding

Need even write distribution (high insert rate)?
  YES → Hash-based sharding
        └─ Need seamless scaling?
             YES → Consistent hashing

Multi-tenant SaaS with per-tenant isolation?
  YES → Directory-based sharding (tenant_id → shard map)

Geographic data residency requirements?
  YES → Geographic sharding
```

### Choosing a Shard Key

```
1. Identify your most common query pattern.
2. What field does it filter by? → Candidate shard key.
3. Does this field have high cardinality? → Good.
4. Is this field write-skewed (e.g., timestamp)? → Add hash or bucket.
5. Does this key co-locate related entities? → Great.
6. Is this field ever updated? → Avoid mutable keys.
```

---

## Quick Reference

### Sharding Strategies Summary

| Strategy | Distribution | Range Queries | Rebalancing | Best For |
|---|---|---|---|---|
| Range-based | Uneven risk | Excellent | Hard | Time-series, ordered data |
| Hash-based | Even | Poor (scatter) | Hard | High write, key lookups |
| Consistent hashing | Even | Poor | Easy | Large-scale distributed |
| Directory-based | Flexible | Depends | Easy | Multi-tenant, compliance |
| Geographic | Uneven risk | Regional | Medium | Data residency |

### Operational Checklist

- [ ] Shard key chosen with high cardinality and write distribution
- [ ] Each shard has its own replica set (HA within shard)
- [ ] Monitoring per-shard: QPS, latency, storage, replication lag
- [ ] Schema migrations tested on all shards
- [ ] Cross-shard query paths identified and load-tested
- [ ] Backup and restore procedure for individual shards
- [ ] Runbook for shard failure and rebalancing

### Key Metrics to Monitor

| Metric | Alert Threshold |
|---|---|
| Shard storage utilization | > 70% |
| Per-shard write QPS | > 80% of capacity |
| Replication lag | > 5 seconds |
| Cross-shard query P99 latency | > SLA × 3 |
| Hot shard QPS ratio | > 2× average shard QPS |

---

> **Design Principle**: Design your shard key around your most frequent access pattern. Every cross-shard operation is a tax — minimize it by co-locating data that is read and written together.