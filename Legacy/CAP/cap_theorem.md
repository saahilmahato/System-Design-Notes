# CAP Theorem

## What Is It?

The **CAP Theorem** (Brewer's Theorem, 2000) states that a distributed data store can guarantee **at most 2 out of 3** properties simultaneously:

- **C — Consistency**: Every read receives the most recent write or an error. All nodes see the same data at the same time.
- **A — Availability**: Every request receives a (non-error) response — but it may not contain the most recent data.
- **P — Partition Tolerance**: The system continues to operate even when network partitions (message loss or delays) occur between nodes.

> **Key Insight**: In any real distributed system, **network partitions are inevitable**. Therefore, the practical choice is always between **Consistency (CP)** and **Availability (AP)** — not whether to tolerate partitions.

---

## The Three Properties Explained

### Consistency (C)
- All nodes return the same, most-recent data at any point in time.
- A write must be seen by all nodes before any subsequent read reflects it.
- Requires coordination overhead (locks, consensus protocols).
- **Not** the same as ACID consistency — CAP consistency ≈ linearizability.

### Availability (A)
- Every request (read or write) gets a response — no timeouts, no errors.
- The response may be stale (not the latest write).
- Achieved by serving requests from any available node without waiting for sync.

### Partition Tolerance (P)
- The system keeps functioning when network partitions split nodes into isolated groups.
- Messages between nodes may be dropped or delayed indefinitely.
- **Cannot be sacrificed** in real-world distributed systems — networks fail.

---

## The Practical Choice: CP vs AP

Since P is non-negotiable, architects choose between:

| Property | CP Systems | AP Systems |
|---|---|---|
| **Priority** | Correctness over uptime | Uptime over correctness |
| **On Partition** | Reject/block requests | Serve potentially stale data |
| **Consistency** | Strong (linearizable) | Eventual |
| **Latency** | Higher (coordination needed) | Lower (serve local replica) |
| **Use Case** | Financial, inventory, auth | Social feeds, DNS, caching |

---

## Trade-offs

### CP Trade-offs
| Advantage | Disadvantage |
|---|---|
| Data is always accurate and safe | Reduced availability during partitions |
| Simpler application logic (no conflict resolution) | Higher latency due to consensus rounds |
| Easier to reason about correctness | Single point of bottleneck (leader node) |
| Required for financial/transactional systems | System may reject requests rather than serve stale data |

### AP Trade-offs
| Advantage | Disadvantage |
|---|---|
| Always responds, even during partitions | Data may be stale or inconsistent across nodes |
| Lower latency (no cross-node coordination) | Application must handle conflict resolution |
| Scales horizontally with ease | Complex reconciliation logic needed |
| Better user experience for non-critical reads | Risk of data anomalies (lost writes, dirty reads) |

### The Consistency Spectrum
CAP's "consistency" is binary, but real systems operate on a spectrum:

```
Strong                                                    Weak
Linearizability → Sequential → Causal → Read-your-writes → Eventual
     (CP)                                                   (AP)
```

Many systems offer **tunable consistency** — choosing per-operation.

---

## PACELC Extension

CAP only describes behavior **during partitions**. The **PACELC model** extends it:

> **If Partition → choose C or A. Else (normal operation) → choose Latency or Consistency.**

| System | Partition Behavior | Normal Behavior |
|---|---|---|
| DynamoDB (default) | AP | EL (Eventual, Low latency) |
| DynamoDB (strong read) | AP | HC (High latency, Consistent) |
| Zookeeper | CP | HC |
| Cassandra | AP | EL |
| PostgreSQL (single node) | CA | — |

---

## Real-World Systems and Applications

### CP Systems — Consistency + Partition Tolerance

#### **Apache ZooKeeper**
- Used for distributed coordination, leader election, config management.
- Uses **ZAB (ZooKeeper Atomic Broadcast)** protocol for consensus.
- Rejects writes if quorum is not met — sacrifices availability.
- Used internally by Kafka, Hadoop, HBase.

#### **HBase**
- Built on HDFS; strong consistency via single region server per row key.
- Used by Facebook for messaging, financial reporting systems.
- Trades availability for strict read-after-write consistency.

#### **etcd**
- Key-value store for Kubernetes cluster state.
- Uses **Raft consensus** — will not respond if leader is unavailable.
- Critical for correctness: wrong k8s state = wrong deployments.

#### **Google Spanner**
- Globally distributed relational database.
- Achieves external consistency using **TrueTime API** (GPS + atomic clocks).
- Provides strong consistency at global scale — close to CP but engineered around partition minimization.

---

### AP Systems — Availability + Partition Tolerance

#### **Amazon DynamoDB (default)**
- Eventually consistent reads by default; strongly consistent reads optional.
- Serves reads from any replica — always available.
- Used by Amazon shopping cart: availability > temporary inconsistency.

#### **Apache Cassandra**
- Tunable consistency: `ONE`, `QUORUM`, `ALL`.
- Masterless ring topology — no single point of failure.
- Used by Netflix, Instagram, Discord for high-write, high-availability workloads.

#### **DNS (Domain Name System)**
- The classic AP example.
- DNS records propagate eventually — cached, stale responses are served.
- Availability and partition tolerance are paramount; stale IP is acceptable briefly.

#### **CouchDB**
- "Offline-first" design — conflict resolution via MVCC and revision tracking.
- Syncs data when connectivity is restored.
- Used in mobile-first applications.

#### **Riak**
- Distributed key-value store optimized for high availability.
- Supports vector clocks for conflict detection.
- Used in systems where "always on" is the top priority.

---

### CA Systems — Consistency + Availability (No Partition Tolerance)
> Only viable on a **single node** or perfectly reliable private network.

| System | Notes |
|---|---|
| PostgreSQL (single node) | ACID compliant, no distribution |
| MySQL (single node) | Standard RDBMS without replication |
| SQLite | Embedded, local-only |

In practice, CA systems become CP or AP the moment you add replication.

---

## Designing Systems Using CAP

### Decision Framework

```
1. What happens if users see stale data?
   - Catastrophic (bank balance, inventory)?  → CP
   - Acceptable (social feed, profile views)?  → AP

2. What happens if the system is unavailable?
   - Catastrophic (checkout, auth service)?    → AP
   - Acceptable (admin dashboard, reporting)?  → CP

3. Do you need global distribution?
   - Yes → Consider PACELC, not just CAP
   - No  → Consider a single-region CA solution
```

### Common Patterns

| Pattern | CAP Alignment | Example |
|---|---|---|
| **Leader-Follower Replication** | CP (sync) / AP (async) | PostgreSQL streaming replication |
| **Multi-Master Replication** | AP with conflict resolution | CouchDB, DynamoDB Global Tables |
| **Quorum Reads/Writes** | Tunable C/A | Cassandra, Dynamo |
| **Two-Phase Commit (2PC)** | CP | Distributed SQL transactions |
| **Saga Pattern** | AP | Microservice eventual consistency |
| **CRDT (Conflict-Free Replicated Data Types)** | AP, automatic merge | Redis, Riak |

---

## Common Misconceptions

| Misconception | Reality |
|---|---|
| "You can choose all three" | You cannot — partitions happen in real networks |
| "CAP consistency = ACID consistency" | CAP = linearizability; ACID = transaction isolation |
| "CA systems exist in distributed systems" | No — any distributed system must tolerate partitions |
| "AP means no consistency at all" | AP means eventual consistency — not chaos |
| "CAP is the full picture" | CAP ignores latency — use PACELC for complete analysis |

---

## Key Protocols & Algorithms

| Protocol | Used For | CP/AP |
|---|---|---|
| **Raft** | Leader election, log replication | CP |
| **Paxos** | Consensus | CP |
| **ZAB** | ZooKeeper atomic broadcast | CP |
| **Gossip Protocol** | Node discovery, failure detection | AP |
| **Vector Clocks** | Conflict detection in AP systems | AP |
| **CRDT** | Automatic conflict-free merging | AP |
| **2PC / 3PC** | Distributed transactions | CP |

---

## Quick Reference Summary

```
CAP Theorem
│
├── C (Consistency)   → All nodes see same data at same time
├── A (Availability)  → Every request gets a response
└── P (Partition Tol) → Works despite network failures [ALWAYS REQUIRED]
          │
          ├── CP: Consistent + Partition Tolerant
          │     → Block/reject on partition
          │     → ZooKeeper, HBase, etcd, Spanner
          │
          └── AP: Available + Partition Tolerant
                → Serve stale data on partition
                → Cassandra, DynamoDB, DNS, CouchDB
```