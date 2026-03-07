# Consistency Patterns: Weak, Eventual, Strong

> **System Design Notes** | Distributed Systems Series

---

## Overview

In distributed systems, **consistency** defines the guarantee about what value a client reads after a write has occurred. Because distributed systems involve multiple nodes that must coordinate over a network (which is inherently unreliable), different consistency models represent different trade-offs between correctness, availability, and performance.

The **CAP Theorem** underpins this discussion: a distributed system can guarantee at most two of **Consistency**, **Availability**, and **Partition Tolerance** simultaneously. Consistency patterns are the practical manifestation of where a system lands on this spectrum.

```
Write ──► [Node A] ──── sync? ────► [Node B] ──► Read
                  └──── async? ───► [Node C] ──► Read
```

---

## 1. Weak Consistency

### Definition
After a write, there is **no guarantee** that subsequent reads will see the updated value — not immediately, not eventually. The system makes a best-effort attempt to propagate the value, but provides no timing or correctness guarantee.

### Core Characteristics
- No read-your-writes guarantee
- No monotonic read guarantee (you can read older data after reading newer data)
- Optimized entirely for performance and availability
- Data loss is acceptable in some failure scenarios

### How It Works
```
Client writes V=2 to Node A
                 │
                 ├── Node B may or may not receive the update
                 └── Node C may serve stale V=1 indefinitely (until cache expires, etc.)

Client reads from Node C → gets V=1 (no guarantee it reflects the write)
```

### Trade-offs

| Dimension | Weak Consistency |
|-----------|-----------------|
| **Latency** | ✅ Extremely low — no coordination overhead |
| **Availability** | ✅ Very high — nodes operate independently |
| **Throughput** | ✅ Very high — no blocking |
| **Data Accuracy** | ❌ Stale reads are expected and common |
| **Complexity** | ✅ Simple to implement |
| **Use Cases** | Narrow — only where staleness is acceptable |

### When to Use
- Data that is naturally time-bound (e.g., live video, gaming state, sensor telemetry)
- Counters or metrics where approximate values are acceptable
- Scenarios where the cost of missing an update is negligible

### Real-World Examples

| System | Usage |
|--------|-------|
| **Memcached** | Cache misses/invalidations are not guaranteed to be immediate. Reads can return stale data after a write |
| **Live Video Streaming (Twitch, YouTube Live)** | Frame/packet drops are acceptable; brief gaps in video don't require resync |
| **Multiplayer Games (FPS games like Call of Duty)** | Game state (player positions) uses weak consistency — a few frames of stale position is acceptable for performance |
| **VoIP / Real-time Audio** | Dropped packets are not retransmitted; stale audio is discarded |
| **CPU Cache (L1/L2)** | Processor caches exhibit weak consistency across cores before memory barriers are applied |

---

## 2. Eventual Consistency

### Definition
After a write, reads **will eventually** return the updated value — provided no new updates are made and sufficient time passes for propagation. The system guarantees convergence but not timing.

### Core Characteristics
- Given no new updates, all replicas will **converge** to the same value
- Reads may be stale in the short term
- Reads-your-writes is NOT guaranteed unless explicitly designed for
- Conflict resolution strategies are required (Last Write Wins, CRDTs, vector clocks, etc.)
- Favors **AP** in the CAP theorem (Available + Partition Tolerant)

### How It Works
```
Client writes V=2 to Node A (coordinator)
                 │
                 ├── Async replication ──► Node B (receives V=2 after 50ms)
                 └── Async replication ──► Node C (receives V=2 after 120ms)

t=10ms:  Client reads Node C → V=1  (stale, but valid under eventual consistency)
t=200ms: Client reads Node C → V=2  (converged)
```

### Conflict Resolution Strategies

**Last Write Wins (LWW)**
- Each write is timestamped; the latest timestamp wins
- Simple but can silently discard writes on clock skew

**Vector Clocks**
- Tracks causality across nodes to detect concurrent writes
- Used by Amazon DynamoDB and Riak

**CRDTs (Conflict-free Replicated Data Types)**
- Data structures designed to merge automatically without conflicts
- Examples: G-Counter, OR-Set, LWW-Register

**Application-level reconciliation**
- Application code defines merge logic (e.g., shopping cart union)

### Trade-offs

| Dimension | Eventual Consistency |
|-----------|---------------------|
| **Latency** | ✅ Low — writes return quickly |
| **Availability** | ✅ High — system stays available during partitions |
| **Throughput** | ✅ High — no write coordination |
| **Data Accuracy** | ⚠️ Stale reads possible; converges over time |
| **Conflict Handling** | ❌ Requires explicit strategy |
| **Developer Complexity** | ⚠️ Moderate — must reason about stale state |
| **Consistency Window** | Seconds to minutes depending on replication lag |

### When to Use
- High-scale systems where availability > immediate correctness
- Social feeds, DNS, product catalogs, recommendation engines
- Systems where occasional stale reads are tolerable and user-invisible

### Real-World Examples

| System | Usage |
|--------|-------|
| **Amazon DynamoDB** | Default read model is eventually consistent. Supports optional strongly consistent reads at higher cost |
| **Apache Cassandra** | Uses tunable consistency (`ONE`, `QUORUM`, `ALL`). Default favors eventual consistency |
| **Amazon S3** | Provides eventual consistency for overwrite PUTs and DELETEs (strong consistency added in 2020 for new objects) |
| **DNS (Domain Name System)** | TTL-based propagation — updated records take time to propagate globally |
| **Facebook / Meta Social Graph** | Your feed, likes, and follower counts use eventual consistency. A like may not appear instantly to all users |
| **Twitter/X Timeline** | Tweet delivery and counts (retweets, likes) are eventually consistent across data centers |
| **Apache CouchDB** | Built on eventual consistency with MVCC and multi-master replication |
| **Voldemort (LinkedIn)** | Key-value store with eventual consistency for profile data and social graph |

---

## 3. Strong Consistency

### Definition
After a write completes, **all subsequent reads from any node** will return the updated value. The system behaves as if there is a single, authoritative copy of the data.

### Core Characteristics
- Every read reflects the most recent write
- Reads-your-writes is guaranteed
- Monotonic reads guaranteed (you won't read older data after reading newer data)
- Requires coordination across nodes before acknowledging a write
- Favors **CP** in the CAP theorem (Consistent + Partition Tolerant)

### How It Works
```
Client writes V=2 to Node A (coordinator)
                 │
                 ├── Sync replication ──► Node B (must ACK before write is committed)
                 └── Sync replication ──► Node C (must ACK before write is committed)

Write is acknowledged to client ONLY after all nodes confirm

t=10ms:  Client reads Node C → V=2  (guaranteed — write already propagated)
t=10ms:  Client reads Node B → V=2  (guaranteed)
```

### Consensus Protocols

**Two-Phase Commit (2PC)**
- Phase 1: Coordinator asks all nodes to prepare
- Phase 2: If all ACK, coordinator sends commit
- Problem: Coordinator failure can leave system in blocked state

**Paxos**
- Consensus algorithm for agreeing on a single value
- Foundation of many strongly consistent databases
- Complex to implement correctly

**Raft**
- Simpler alternative to Paxos; uses leader election + log replication
- Used by etcd, CockroachDB, TiKV

**Zab (ZooKeeper Atomic Broadcast)**
- ZooKeeper's consensus protocol
- Guarantees total ordering of writes

### Consistency Levels (within Strong)

```
Linearizability (strongest)
   └── Operations appear instantaneous and globally ordered
       Used by: Google Spanner, etcd

Sequential Consistency
   └── Operations are globally ordered but may not reflect real-time
       Used by: Some lock implementations

Serializability
   └── Transactions execute as if run serially
       Used by: Traditional RDBMS (PostgreSQL, MySQL with SERIALIZABLE isolation)
```

### Trade-offs

| Dimension | Strong Consistency |
|-----------|-------------------|
| **Latency** | ❌ Higher — must wait for quorum/all-node ACK |
| **Availability** | ❌ Lower — system may reject writes during partition |
| **Throughput** | ❌ Lower — coordination overhead |
| **Data Accuracy** | ✅ Perfect — reads always reflect latest write |
| **Conflict Handling** | ✅ No conflicts by design |
| **Developer Complexity** | ✅ Simpler to reason about correctness |
| **Failure Handling** | ❌ Network partitions can cause unavailability |

### When to Use
- Financial transactions (bank transfers, payments)
- Inventory management (prevent overselling)
- Distributed locks and leader election
- Any domain where stale reads have real-world consequences

### Real-World Examples

| System | Usage |
|--------|-------|
| **Google Spanner** | Globally distributed SQL database with external consistency (stronger than linearizability). Uses TrueTime API for synchronized timestamps |
| **etcd** | Distributed key-value store for Kubernetes config. Uses Raft consensus for strong consistency |
| **Apache ZooKeeper** | Coordination service for distributed systems. Linearizable writes, sequential reads |
| **CockroachDB** | Distributed SQL with serializable isolation via Raft |
| **PostgreSQL / MySQL** | ACID-compliant relational databases with serializable transaction isolation |
| **Google Bigtable (single-row transactions)** | Offers strong consistency within a single row |
| **Microsoft Azure Cosmos DB** | Offers strong consistency as one of its five tunable consistency levels |
| **Chubby (Google)** | Distributed lock service used internally at Google; linearizable |

---

## Comparison Summary

| Property | Weak | Eventual | Strong |
|----------|------|----------|--------|
| Read-your-writes | ❌ | ❌ (unless designed for) | ✅ |
| Monotonic reads | ❌ | ❌ | ✅ |
| Convergence guarantee | ❌ | ✅ (over time) | ✅ (immediate) |
| Write latency | 🟢 Lowest | 🟡 Low | 🔴 Highest |
| Read latency | 🟢 Lowest | 🟡 Low | 🔴 Higher |
| Availability | 🟢 Highest | 🟢 High | 🔴 Lower |
| Partition tolerance | 🟢 Best | 🟢 Good | ⚠️ Trade-off required |
| Implementation complexity | 🟢 Simple | 🟡 Moderate | 🔴 Complex |

---

## Tunable Consistency

Some databases allow choosing consistency level **per operation**, trading off performance for correctness on a case-by-case basis.

### Cassandra Consistency Levels
```
Write quorum: W + R > N  (guarantees strong consistency)

N = total replicas
W = nodes that must ACK a write
R = nodes consulted on a read

Examples:
  N=3, W=1, R=1  → Eventual consistency (fastest)
  N=3, W=2, R=2  → Strong consistency (W+R=4 > N=3)
  N=3, W=3, R=1  → Strong consistency, write-heavy trade-off
```

### DynamoDB Consistency Options
- **Eventually consistent reads** — default, lower cost, higher performance
- **Strongly consistent reads** — opt-in, higher latency, 2x the read capacity cost

### Azure Cosmos DB Levels (weakest → strongest)
1. Eventual
2. Consistent Prefix
3. Session
4. Bounded Staleness
5. Strong

---

## Key Design Considerations

**1. Identify the consistency requirement per data type**
Not all data needs the same consistency. A user's profile photo can tolerate eventual consistency; their bank balance cannot.

**2. Understand your failure modes**
Strong consistency can cause write failures during network partitions. Eventual consistency can cause stale reads. Design your system to handle both gracefully.

**3. Session consistency as a pragmatic middle ground**
Guarantee reads-your-writes within a session (your own writes are visible to you) while allowing staleness for other clients. Used widely in social applications.

**4. CRDT-based designs for collaborative applications**
For systems like collaborative editing (Google Docs), CRDTs enable eventual consistency without conflicts.

**5. Idempotency with eventual consistency**
In eventually consistent systems, retried operations can cause duplicate writes. Design operations to be idempotent (safe to apply multiple times).

---

## Interview Quick Reference

| Question | Answer |
|----------|--------|
| What is consistency in distributed systems? | The guarantee about whether a read reflects the latest write across all nodes |
| What does "eventually consistent" mean? | All replicas will converge to the same value given no new updates and enough time |
| How does strong consistency affect availability? | It can reduce availability; the system may reject reads/writes during a network partition rather than return stale data |
| What is linearizability? | The strongest form of consistency — operations appear instantaneous and globally ordered in real time |
| When would you choose eventual over strong consistency? | When availability and low latency are more critical than guaranteed up-to-date reads (e.g., social feeds, DNS) |
| What is quorum in the context of consistency? | Requiring W + R > N ensures that at least one node participating in a read has seen the latest write |
