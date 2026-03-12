# RDBMS: Replication

---

## What Is Replication?

Replication is the process of copying and maintaining the same data across multiple database nodes. Changes made to one node (the **primary/leader**) are propagated to one or more other nodes (**replicas/followers**), keeping them in sync.

The core goals are: **high availability**, **fault tolerance**, **read scalability**, and **geographic distribution**.

---

## Types of Replication

### 1. Single-Leader (Primary–Replica)
One node accepts all writes. Replicas receive changes and serve reads.

- **Synchronous**: Primary waits for replica acknowledgment before confirming write to client.
- **Asynchronous**: Primary confirms write immediately; replica catches up eventually.
- **Semi-synchronous**: At least one replica must acknowledge; others are async.

```
Client → [Primary] → WAL/Binlog → [Replica 1]
                                 → [Replica 2]
                                 → [Replica 3]
```

### 2. Multi-Leader (Active–Active)
Multiple nodes accept writes. Conflicts must be detected and resolved.

- Used across data centers (one leader per DC).
- Conflict resolution strategies: last-write-wins (LWW), custom merge logic, CRDTs.

```
DC-1: [Leader A] ←→ [Leader B] :DC-2
       ↓                  ↓
   Replicas A         Replicas B
```

### 3. Leaderless (Quorum-Based)
Any node can accept writes. Reads/writes use quorum (W + R > N) to ensure consistency.

- Common in NoSQL (Dynamo-style), but some RDBMS extensions use this.
- Requires anti-entropy (read repair, background syncs) to fix diverged nodes.

---

## Replication Methods

| Method | Description | DB Examples |
|---|---|---|
| **Statement-based** | Replicate SQL statements | MySQL (legacy) |
| **WAL Shipping** | Ship raw write-ahead log bytes | PostgreSQL (streaming replication) |
| **Row-based (Logical)** | Replicate row-level change events | MySQL binlog, PostgreSQL logical decoding |
| **Trigger-based** | Custom triggers write changes to a replication table | Bucardo, Slony |

**WAL/Row-based is generally preferred** — it's deterministic and handles non-deterministic functions (e.g., `NOW()`, `RAND()`) correctly.

---

## Replication Lag

Even with async replication, replicas fall behind. This creates **eventual consistency** windows.

Key lag-related anomalies:
- **Read-your-own-writes**: User writes, then reads from a replica that hasn't caught up — appears as if their write was lost.
- **Monotonic reads**: Reading stale data after already reading fresh data — time appears to go backward.
- **Consistent prefix reads**: Seeing effects of events before the events themselves (causal violations).

**Mitigations:**
- Route reads of recently written data to the primary.
- Track replication position per session and route reads only to replicas that have caught up.
- Use synchronous replication for critical paths.

---

## Failover

When the primary fails, a replica must be promoted.

### Steps
1. Detect primary failure (heartbeat timeout).
2. Elect a new primary (most up-to-date replica preferred).
3. Reconfigure clients and remaining replicas to follow the new primary.
4. Handle the old primary if it comes back (prevent "split-brain").

### Failover Risks
- **Split-brain**: Two nodes both believe they are the primary. Can lead to data divergence or double writes. Mitigated with fencing tokens or STONITH (Shoot The Other Node In The Head).
- **Data loss**: Async replicas may not have received the latest writes. Tuning `synchronous_commit` (PostgreSQL) or `semi-sync` (MySQL) reduces this risk.
- **Incorrect lag threshold**: Promoting a lagging replica can roll back committed transactions.

---

## Trade-offs

### Synchronous vs. Asynchronous

| Dimension | Synchronous | Asynchronous |
|---|---|---|
| **Durability** | High — replica confirmed before ack | Lower — writes may be lost on failover |
| **Write Latency** | Higher — waits for replica round-trip | Lower — fire and forget |
| **Availability** | Lower — blocked if replica is slow/down | Higher — primary unaffected by replica lag |
| **Use case** | Financial transactions, audit logs | Analytics replicas, read scaling |

### Single-Leader vs. Multi-Leader

| Dimension | Single-Leader | Multi-Leader |
|---|---|---|
| **Conflict handling** | Simple — no conflicts | Complex — must resolve write conflicts |
| **Write throughput** | Bottlenecked at one node | Scales horizontally |
| **Cross-DC writes** | High latency (all go to one DC) | Low latency (local DC accepts writes) |
| **Consistency** | Easier to reason about | Harder — requires conflict resolution logic |

### Read Scaling via Replicas

- **Pro**: Offloads read-heavy workloads from primary; enables analytics without impacting OLTP.
- **Con**: Replica lag means reads may be stale. Not suitable for strongly consistent reads.

### Operational Complexity

- More replicas → more network, storage, monitoring overhead.
- Schema migrations must be backward compatible to avoid breaking replicas mid-migration.
- Circular replication in multi-leader setups must be detected and prevented.

---

## Consistency Models in Replication

| Model | Guarantee | Cost |
|---|---|---|
| **Strong Consistency** | All reads see latest write | High latency, reduced availability |
| **Read-your-writes** | User always sees their own writes | Route writes and reads intelligently |
| **Monotonic Reads** | No going backward in time | Sticky sessions or version tracking |
| **Eventual Consistency** | Replicas converge over time | Lowest latency, stale reads possible |

---

## Key Configuration Parameters

### PostgreSQL
```ini
# Enable WAL-level replication
wal_level = replica

# Number of sync standbys required
synchronous_standby_names = 'replica1'

# Max replication slots
max_replication_slots = 5

# Streaming replication timeout
wal_sender_timeout = 60s
```

### MySQL
```ini
# Enable binary logging
log_bin = mysql-bin
binlog_format = ROW

# Semi-sync plugin
plugin-load = rpl_semi_sync_master=semisync_master.so
rpl_semi_sync_master_enabled = 1
rpl_semi_sync_master_timeout = 1000  # ms
```

---

## Real-World Systems and Applications

### GitHub — MySQL with Orchestrator
- Uses **single-leader replication** with MySQL.
- Runs **Orchestrator** for automated failover and topology management.
- Horizontal read scaling via replicas for non-critical reads (PR diffs, activity feeds).
- Challenge: Ensuring schema migrations don't break running replicas — solved via **gh-ost** (online schema migrations that work through the binlog).

### Airbnb — MySQL Semi-Synchronous Replication
- **Semi-sync** ensures at least one replica has acknowledged a write before the primary confirms — balances durability with write performance.
- Uses replicas for reporting and analytics pipelines without touching the primary.
- Geo-distributed deployments use multi-region setups with dedicated local read replicas.

### Instagram — PostgreSQL Streaming Replication
- **Streaming replication (WAL-based)** for read replicas serving hundreds of millions of reads/sec.
- Promoted replicas during failover with custom tooling to minimize downtime.
- Migrated shard-by-shard at scale, with replicas playing a central role during live migrations.

### Booking.com — MySQL with Complex Topology
- Multi-tier replication: primary → regional replicas → local replicas.
- Uses replicas to fan out reads geographically, keeping latency low for European and Asian traffic.
- Invests heavily in **replication lag monitoring** — SLA violations on lag directly affect booking consistency.

### Shopify — Vitess on MySQL
- Uses **Vitess** (MySQL sharding/proxy layer) which manages replication topology at scale.
- Each shard has its own primary + replicas.
- Vitess's **VTOrc** handles automated failover without human intervention.

### LinkedIn — Espresso + Databus
- Built **Databus**, a change-data-capture (CDC) system on top of Oracle replication, later open-sourced.
- Consumers subscribe to a replication stream to keep caches, search indexes, and derived stores in sync — decoupling replication from application logic.

---

## Common Patterns Built on Replication

### Read Replica Offloading
```
App (writes) → Primary
App (reads)  → Load Balancer → [Replica 1, Replica 2, Replica 3]
```
Best for: reporting, dashboards, full-text search, analytics.

### CDC (Change Data Capture)
Tap into the replication stream (WAL / binlog) to feed downstream systems:
```
Primary DB → Debezium/Maxwell → Kafka → Elasticsearch / Redis / Data Warehouse
```
Tools: **Debezium** (Kafka-native CDC), **Maxwell** (MySQL → JSON stream), **pglogical** (PostgreSQL logical replication).

### Geo-Distributed Reads
```
Users (US)  → US Replica
Users (EU)  → EU Replica
Users (APAC)→ APAC Replica
All writes  → Single Primary (US or closest DC)
```

### Blue/Green or Shadow Deployments
Route a copy of production traffic to a replica for testing new schema versions or query plans before promoting.

---

## Monitoring Replication

| Metric | Tool/Query | Alert Threshold |
|---|---|---|
| **Replication lag** | `pg_stat_replication.write_lag`, `Seconds_Behind_Master` (MySQL) | > 30s (tune per use case) |
| **Replication slot bloat** | `pg_replication_slots.pg_current_wal_lsn - confirmed_flush_lsn` | Growing unboundedly |
| **Replica availability** | Heartbeat table writes / checks | Missed heartbeat |
| **Binlog position drift** | Compare `GTID_EXECUTED` across nodes | Any inconsistency |

**Critical**: Unused replication slots in PostgreSQL prevent WAL cleanup and can fill up disk entirely.

---

## Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    REPLICATION CHEATSHEET                   │
├─────────────────┬───────────────────────────────────────────┤
│ Goal            │ Mechanism                                 │
├─────────────────┼───────────────────────────────────────────┤
│ Read scaling    │ Async replicas + load balancer            │
│ HA / Failover   │ Sync/semi-sync + orchestrator             │
│ Geo-distrib.    │ Multi-leader or regional read replicas    │
│ Derived data    │ CDC via WAL/binlog → Kafka                │
│ Zero-downtime   │ Logical replication + slot management     │
│ migration       │                                           │
└─────────────────┴───────────────────────────────────────────┘
```