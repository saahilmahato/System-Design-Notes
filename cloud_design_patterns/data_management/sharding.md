# Cloud Design Patterns — Data Management: Sharding

---

## 1. What Is Sharding?

Sharding is the practice of **horizontally partitioning a dataset across multiple independent database nodes** (shards), where each shard holds a disjoint subset of the total data. Unlike replication (where every node holds the same data), sharding distributes *different* data across *different* nodes.

Each shard:
- Is a fully independent database instance.
- Owns a specific partition of the data.
- Can be replicated internally for fault tolerance.

```
                        ┌──────────────────┐
                        │   Application    │
                        └────────┬─────────┘
                                 │
                        ┌────────▼─────────┐
                        │   Shard Router   │  ← routing logic / proxy
                        └──┬───────┬───────┘
                           │       │       │
               ┌───────────▼┐  ┌───▼──────┐  ┌▼──────────┐
               │  Shard 0   │  │  Shard 1 │  │  Shard 2  │
               │ users A–H  │  │ users I–P│  │ users Q–Z │
               └────────────┘  └──────────┘  └───────────┘
```

---

## 2. Why Shard?

| Problem                        | Sharding Solution                              |
|-------------------------------|------------------------------------------------|
| Single node write bottleneck  | Distribute writes across N shards              |
| Dataset exceeds single disk   | Each shard holds 1/N of data                   |
| Query latency under heavy load| Parallel query execution across shards         |
| Vertical scaling ceiling      | Replace one big machine with many small ones   |

**Trigger signals for sharding:**
- Single-node throughput is saturated even after indexing and caching.
- Dataset size exceeds what can be stored or backed up on one machine.
- Write contention cannot be resolved by read replicas alone.
- Geo-distribution or data residency requirements exist.

> **Rule of thumb:** Exhaust vertical scaling, read replicas, caching, and query optimization *before* sharding. Sharding adds significant operational complexity.

---

## 3. Sharding Strategies

### 3.1 Range-Based Sharding

Data is partitioned by a continuous range of the shard key.

```
Shard 0: user_id  1     – 1,000,000
Shard 1: user_id  1,000,001 – 2,000,000
Shard 2: user_id  2,000,001 – 3,000,000
```

**Pros:**
- Simple to implement and reason about.
- Range queries (BETWEEN, >, <) are efficient — served by a single shard.
- Easy to add new ranges as data grows.

**Cons:**
- **Hotspot risk**: Sequential keys (timestamps, auto-increment IDs) concentrate writes on the latest shard.
- Uneven data distribution if values are skewed.

**Best for:** Time-series data (with careful key design), ordered datasets with infrequent writes to old ranges.

---

### 3.2 Hash-Based Sharding

Apply a hash function to the shard key; use the result modulo N to assign a shard.

```
shard = hash(user_id) % N

hash("user_9821") % 4 → Shard 2
hash("user_4430") % 4 → Shard 0
```

**Pros:**
- Uniform data distribution — eliminates hotspots.
- Deterministic routing — no lookup table required.

**Cons:**
- Range queries require scatter-gather across all shards.
- **Resharding is expensive**: changing N invalidates most mappings (mitigated by consistent hashing).

**Best for:** User data, session data, event logs where uniform distribution matters.

---

### 3.3 Consistent Hashing

A hash ring maps both keys and shards to positions. Each key is assigned to the nearest shard clockwise on the ring.

```
         0°
       K1↓
  270° ──●── 90°        S0 at 30°
         │              S1 at 120°
         ●S0            S2 at 240°
        /   \
      K4●   ●S1
        \   /
         ●S2
        180°
```

**Pros:**
- Adding/removing a shard remaps only ~1/N of keys (not all keys).
- Virtual nodes (vnodes) improve distribution balance.
- Standard in most production-grade distributed databases.

**Cons:**
- More complex to implement than simple modulo hashing.
- Hotspots can still occur without vnodes.

**Used by:** Amazon DynamoDB, Apache Cassandra, Redis Cluster, Chord DHT.

---

### 3.4 Directory-Based Sharding (Lookup Table)

A central lookup service maps each key (or key range) to a specific shard.

```
┌────────────────────────────────┐
│         Shard Directory        │
│  tenant_id=acme   → Shard 3    │
│  tenant_id=globex → Shard 1    │
│  tenant_id=initech→ Shard 7    │
└────────────────────────────────┘
```

**Pros:**
- Maximum flexibility — shard assignment can be arbitrary.
- Easy to move individual tenants or datasets between shards.
- Natural fit for multi-tenant SaaS architectures.

**Cons:**
- Directory is a single point of failure and a potential bottleneck.
- Extra network hop per query unless the directory is cached aggressively.

**Best for:** Multi-tenant SaaS (one or more tenants per shard), enterprise applications with uneven tenant sizes.

---

### 3.5 Geo-Based Sharding

Data is partitioned by geographic region or data residency zone.

```
Shard US-East  → users in NA
Shard EU-West  → users in Europe   (GDPR compliance)
Shard AP-South → users in Asia
```

**Pros:**
- Reduces latency by co-locating data with users.
- Satisfies legal data residency requirements (GDPR, PDPA, CCPA).

**Cons:**
- Cross-region queries are slow and complex.
- Uneven user distribution creates imbalanced shards.

**Best for:** Global consumer products, regulated industries.

---

## 4. Shard Key Selection

The shard key is the single most important design decision. A poor choice is extremely expensive to fix later.

### Good Shard Key Criteria

| Criterion           | Description                                                       |
|---------------------|-------------------------------------------------------------------|
| High cardinality    | Many distinct values to spread data across shards                 |
| Even distribution   | No single value dominates (no celebrity/hot key problem)          |
| Query alignment     | Most queries should target a single shard                         |
| Immutability        | Changing shard key value requires moving the record               |
| Low cross-shard ops | Foreign keys / joins across shards are expensive                  |

### Anti-patterns

| Anti-pattern         | Problem                                                   |
|----------------------|-----------------------------------------------------------|
| `timestamp` as key   | All writes go to the latest shard (monotonic hotspot)     |
| `status` / `type`    | Low cardinality → very uneven distribution                |
| `country_code`       | Skewed; US alone could overwhelm one shard                |
| Mutable fields       | Moving records on key change is costly and error-prone    |

### Compound Shard Keys

Use a composite key to combine locality with distribution:
```
(tenant_id, created_at) → co-locates a tenant's data, while distributing tenants evenly
(region, user_id)       → geo-locality + within-region distribution
```

---

## 5. Routing Layer

The routing layer (shard router / proxy) translates a query into the correct shard target.

### Routing Models

```
1. CLIENT-SIDE ROUTING
   App holds shard map → directly connects to correct shard
   Used by: Cassandra driver, Redis Cluster client

2. PROXY ROUTING
   Dedicated proxy (e.g., ProxySQL, Vitess) routes transparently
   App sees a single logical database endpoint

3. COORDINATOR NODE
   A designated node receives all queries and fans out
   Used by: CockroachDB gateway, MongoDB mongos
```

### Scatter-Gather

When a query cannot be routed to a single shard (e.g., no shard key in WHERE clause):

```
Router → broadcasts query to all N shards
       → collects partial results
       → merges, sorts, and returns unified result
```

Scatter-gather is expensive. Design schemas and queries to avoid it on hot paths.

---

## 6. Cross-Shard Operations

### Cross-Shard Joins

SQL JOINs across shards are not natively supported. Solutions:

| Approach                | Description                                          |
|-------------------------|------------------------------------------------------|
| Denormalization         | Embed related data to avoid joins                    |
| Application-side join   | Fetch from each shard, join in application memory    |
| Broadcast dimension     | Replicate small lookup tables to every shard         |
| Co-location             | Shard related entities by the same key               |

### Cross-Shard Transactions

ACID transactions across shards require distributed protocols:

- **2-Phase Commit (2PC):** Coordinator + participants; blocking on failure.
- **Saga Pattern:** Sequence of local transactions with compensating rollbacks.
- **Avoid entirely:** Design data models to keep transactions within a single shard.

### Global Aggregations

`COUNT(*)`, `SUM()`, `AVG()` across all shards:

```python
# Pseudo-code
partial_results = [shard.execute(query) for shard in all_shards]
total = sum(r.count for r in partial_results)
```

This requires fan-out and merge — avoid in real-time paths; use pre-aggregated counters or background jobs.

---

## 7. Resharding

Resharding (changing the number of shards) is one of the most disruptive operations in a sharded system.

### Triggers for Resharding
- A shard is approaching storage or throughput capacity.
- Growth is uneven — some shards are hot, others idle.
- The initial shard count was underestimated.

### Resharding Strategies

```
1. DOUBLE-WRITE / DUAL-READ (live migration)
   - New shard scheme is deployed alongside old.
   - Writes go to both old and new scheme.
   - Background job backfills historical data.
   - Reads switch to new scheme once consistent.
   - Zero downtime; high complexity.

2. CONSISTENT HASHING WITH VNODES
   - Redistribute only the affected key ranges.
   - Add new shards gradually; vnodes absorb incremental growth.

3. PRE-SHARDING
   - Provision more logical shards than physical nodes upfront.
   - Assign multiple logical shards per physical node.
   - Scale-out by moving logical shards — no key remapping needed.
   - Used by: Redis Cluster (16384 slots), DynamoDB partitions.
```

---

## 8. Hotspot Mitigation

| Technique                 | Description                                                        |
|---------------------------|--------------------------------------------------------------------|
| Key salting               | Append random suffix: `user_id + "_" + rand(0,4)` → 4 sub-keys    |
| Write buffering           | Batch writes in a queue; flush to shard in bulk                    |
| Cell-based architecture   | Isolate popular entities (celebrities) in dedicated shards         |
| Adaptive splitting        | Auto-detect hot ranges and split them further                      |
| Caching layer             | Redis in front of hot shards absorbs read pressure                 |

**Celebrity / Hot Key Problem (social networks):**
```
Beyoncé follows 200M users.
All writes/reads for her account hit one shard.

Solutions:
- Shard her follower list independently (list sharding).
- Cache reads aggressively at CDN or Redis level.
- Fan out writes asynchronously to reduce shard pressure.
```

---

## 9. Replication Within Shards

Each shard is typically replicated for fault tolerance:

```
Shard 1
  ├── Primary   (read + write)
  ├── Replica 1 (read)
  └── Replica 2 (read, standby failover)
```

- Combines sharding (write scalability) with replication (read scalability + HA).
- Standard in Cassandra, MongoDB, MySQL + Vitess, CockroachDB.

---

## 10. Trade-offs

| Dimension             | Without Sharding              | With Sharding                          |
|-----------------------|-------------------------------|----------------------------------------|
| Write throughput      | Bounded by single node        | Scales linearly with shard count       |
| Read throughput       | Bounded (even with replicas)  | Parallel reads across shards           |
| Storage capacity      | Single machine limit          | Virtually unlimited                    |
| Operational complexity| Low                           | High (routing, resharding, monitoring) |
| Cross-shard queries   | Native SQL                    | Expensive scatter-gather or denied     |
| ACID transactions     | Native                        | Requires 2PC or saga; often avoided    |
| Schema changes        | Single DDL                    | Must be applied to all shards          |
| Latency (single key)  | Low                           | Same or slightly higher (routing hop)  |
| Consistency           | Strong (single node)          | Eventual or tunable                    |

### When Sharding Pays Off
- Write throughput is the bottleneck (not read throughput, which replicas solve).
- Dataset size genuinely cannot fit on the largest available single node.
- Queries are predominantly key-based (shard key known at query time).
- Team has the operational maturity to manage a distributed data layer.

### When Sharding Hurts
- The application issues many cross-shard joins or multi-entity transactions.
- The data model requires frequent global aggregations.
- Team/infrastructure is not ready for the operational overhead.
- Data size is moderate — vertical scaling or read replicas would suffice.

---

## 11. Real-World Systems & Applications

### 11.1 Discord — Message Storage (Cassandra)

Discord stores billions of messages sharded by `(channel_id, message_id)` (a compound time-based UUID). Each channel's messages are co-located on the same Cassandra partition, ensuring fast retrieval of a channel's history without cross-shard operations. Cassandra uses consistent hashing with vnodes internally.

**Key insight:** Shard key design ensures the most common access pattern (get messages for channel X) always hits a single shard.

---

### 11.2 Uber — Trip and Driver Data

Uber shards geospatial and trip data by `city_id` + consistent hashing within the city. Driver location updates (high write volume) are distributed across shards per city cluster. The routing service maintains a directory mapping cities to shard groups.

**Key insight:** Geo-based coarse sharding (city) combined with hash-based fine sharding within the city provides both locality and even distribution.

---

### 11.3 Shopify — Multi-Tenant Sharding (MySQL + Vitess)

Shopify uses a **directory-based sharding** model: each shop (tenant) is assigned to one shard at creation time. The shard directory maps `shop_id → shard_id`. Vitess acts as the transparent MySQL proxy. Large shops may get a dedicated shard; small shops are packed together.

**Key insight:** Directory-based sharding enables flexible rebalancing — a large tenant can be migrated to a dedicated shard without changing application code.

---

### 11.4 Instagram — User and Media Sharding (PostgreSQL)

Instagram sharded PostgreSQL by `user_id`. A logical sharding layer (developed in-house) routes queries to the correct physical Postgres instance. Media metadata is co-located with the owning user. This made per-user queries fast but required careful design for feed generation (which is cross-user).

**Key insight:** Shard by the primary entity (`user_id`) to co-locate all of a user's data; accept that cross-user operations (feeds, recommendations) require fan-out or pre-computation.

---

### 11.5 Amazon DynamoDB — Adaptive Partitioning

DynamoDB automatically shards tables by partition key using consistent hashing. Each partition has a throughput capacity. DynamoDB monitors hot partitions and adaptively splits them. Pre-sharding via high-cardinality partition keys is the recommended design pattern.

**Key insight:** Managed sharding abstracts operational complexity but still requires the developer to choose a high-cardinality, evenly distributed partition key.

---

### 11.6 Stripe — Financial Ledger Sharding

Stripe shards its ledger and transaction data by `account_id`. All entries for a given account land on the same shard, enabling strongly consistent balance calculations per account without cross-shard transactions. Cross-account operations (e.g., transfers) are modeled as two separate account-scoped operations with eventual reconciliation.

**Key insight:** Shard by the consistency boundary. A user's balance must be strongly consistent, so all balance-affecting writes for one account are confined to one shard.

---

### 11.7 YouTube / Google Bigtable — Row Key Sharding

Bigtable shards by row key ranges (tablets). YouTube stores video metadata with keys like `video_id` + reverse timestamp to avoid write hotspots on the latest videos. Tablets are automatically split and rebalanced by the Bigtable master.

**Key insight:** Key design must proactively prevent monotonic hotspots. Reversing or hashing timestamp prefixes distributes sequential writes.

---

## 12. Decision Framework

```
START
  │
  ▼
Is write throughput or storage the bottleneck?
  │ No → Use read replicas / caching / indexing. Stop.
  │ Yes
  ▼
Can vertical scaling extend the runway 12–18 months?
  │ Yes → Scale up. Revisit sharding later.
  │ No
  ▼
Are most queries key-based (shard key known)?
  │ No → Reconsider data model or use a purpose-built
  │       distributed DB (BigQuery, Snowflake, Spark).
  │ Yes
  ▼
Choose sharding strategy:
  ├── Sequential/ordered queries required?  → Range-based
  ├── Uniform distribution, no range queries? → Hash-based
  ├── Multi-tenant SaaS, per-tenant isolation? → Directory-based
  └── Global user base, data residency needs? → Geo-based
  │
  ▼
Design shard key:
  - High cardinality ✓
  - Immutable ✓
  - Query-aligned ✓
  - Even distribution ✓
  │
  ▼
Plan for resharding:
  - Pre-shard with extra logical shards
  - Use consistent hashing with vnodes
  - Build dual-write migration tooling
```

---

## 13. Interview Cheat Sheet

| Question                                      | Answer                                                                         |
|-----------------------------------------------|--------------------------------------------------------------------------------|
| What is sharding?                             | Horizontal partitioning of data across independent DB nodes                    |
| Sharding vs. replication?                     | Sharding splits data; replication duplicates data                              |
| Best sharding strategy for uniform writes?    | Hash-based or consistent hashing                                               |
| Best for range queries?                       | Range-based sharding                                                           |
| How to avoid resharding pain?                 | Pre-shard with logical shards; use consistent hashing                          |
| How to handle cross-shard transactions?       | 2PC (blocking), Saga (eventual), or redesign to avoid cross-shard writes       |
| What is a hotspot?                            | A shard receiving disproportionate traffic due to key skew                     |
| How to mitigate hotspots?                     | Key salting, cell-based isolation, write buffering, caching                    |
| What is scatter-gather?                       | Broadcast query to all shards, merge results; expensive, avoid on hot paths    |
| When NOT to shard?                            | When replicas, caching, or vertical scaling can solve the problem              |
| What does Cassandra use for sharding?         | Consistent hashing with configurable vnodes                                    |
| What does DynamoDB use?                       | Consistent hashing on partition key; auto-splits hot partitions                |

---

*References: Martin Fowler — Patterns of Enterprise Application Architecture; AWS Well-Architected Framework; Google Bigtable Paper; Discord Engineering Blog; Shopify Engineering Blog; Instagram Engineering Blog.*