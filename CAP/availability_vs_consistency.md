# Availability vs Consistency — AP vs CP

> In any distributed system, when a network partition occurs, you must choose between **Availability** and **Consistency**. This is the core of the CAP Theorem.

---

## 1. Core Concepts

### CAP Theorem
Formulated by Eric Brewer (2000), formally proved by Gilbert & Lynch (2002).

> A distributed system can guarantee **at most two** of the following three properties simultaneously:
> - **C**onsistency
> - **A**vailability
> - **P**artition Tolerance

Since **network partitions are unavoidable** in real distributed systems, the practical choice is always between **CP** or **AP**.

---

### Consistency (C)
Every read receives the **most recent write** or an error. All nodes see the same data at the same time. Equivalent to having a single, up-to-date copy of the data.

- Strong consistency = linearizability
- If a write hasn't propagated to all nodes, a read returns an error rather than stale data

### Availability (A)
Every request receives a **non-error response** — but it may not contain the most recent write. The system remains operational even if some nodes are down.

- Does not guarantee the data is up-to-date
- Prioritizes uptime and responsiveness over correctness

### Partition Tolerance (P)
The system continues operating even when **network messages are dropped or delayed** between nodes.

- In real-world systems, partitions *will* happen (hardware failure, network outage, etc.)
- Partition tolerance is **non-negotiable** in distributed systems

---

## 2. AP vs CP

### CP Systems (Consistency + Partition Tolerance)
- **Sacrifice**: Availability
- **Behavior on partition**: Returns an error or timeout instead of stale data
- **Guarantee**: Data is always correct and consistent
- **Use when**: Correctness is critical; stale data is unacceptable

### AP Systems (Availability + Partition Tolerance)
- **Sacrifice**: Consistency
- **Behavior on partition**: Returns the best available (possibly stale) data
- **Guarantee**: System always responds, eventual consistency over time
- **Use when**: Uptime is critical; temporary inconsistency is acceptable

---

## 3. Trade-offs

| Dimension             | CP                                      | AP                                          |
|-----------------------|-----------------------------------------|---------------------------------------------|
| **Data correctness**  | Always consistent                       | Eventually consistent (may be stale)        |
| **Availability**      | May reject requests during partition    | Always responds                             |
| **Latency**           | Higher (coordination overhead)          | Lower (no need to sync before responding)   |
| **Fault tolerance**   | Lower (node failure = potential outage) | Higher (degrades gracefully)                |
| **Complexity**        | Simpler data model, complex consensus   | Simpler operations, complex conflict resolution |
| **User experience**   | Errors under network issues             | Potentially stale/conflicting data          |
| **Throughput**        | Lower (synchronous coordination)        | Higher (async writes)                       |
| **Conflict handling** | Avoided by design                       | Must be resolved (last-write-wins, CRDTs, etc.) |

### Key Trade-off Questions
- **How bad is stale data?** (Financial transaction vs. social media like count)
- **How bad is an error response?** (Shopping cart vs. bank balance)
- **How often do partitions occur?** (Internal datacenter vs. geo-distributed)
- **Can conflicts be merged?** (Counter increments vs. seat reservations)

---

## 4. Consistency Models (Spectrum)

Strong → Weak consistency is a spectrum, not binary:

```
Strong Consistency
        ↓
  Linearizability    — reads reflect all prior writes globally
        ↓
  Sequential         — operations appear in some sequential order
        ↓
  Causal             — causally related operations ordered correctly
        ↓
  Read-your-writes   — you always see your own writes
        ↓
  Eventual           — all replicas converge eventually
        ↓
Weak Consistency
```

Most real systems operate somewhere between **causal** and **eventual** consistency.

---

## 5. Real-World Systems & Applications

### CP Systems

| System | Notes |
|--------|-------|
| **ZooKeeper** | Distributed coordination; used for leader election, config management. Returns error on partition. |
| **HBase** | Built on HDFS; strong consistency for row-level operations. |
| **etcd** | Key-value store for Kubernetes config; uses Raft consensus. |
| **MongoDB (w: majority)** | With majority write concern, guarantees consistency at cost of availability. |
| **Google Spanner** | Globally distributed CP database using TrueTime API for external consistency. |
| **Consul** | Service discovery + config; CP by design using Raft. |

**Typical use cases for CP:**
- Financial ledgers / banking
- Inventory reservation systems (hotel rooms, airline seats)
- Distributed locks / leader election
- User authentication systems

---

### AP Systems

| System | Notes |
|--------|-------|
| **Cassandra** | Masterless ring topology; tunable consistency. Default AP. |
| **DynamoDB** | Amazon's key-value store; eventual consistency by default, strong consistency optional. |
| **CouchDB** | Multi-master replication; conflict resolution via revision tree. |
| **Riak** | AP database inspired by Amazon Dynamo paper. |
| **DNS** | Classic AP system — cached/stale records propagate over time. |
| **Voldemort** | LinkedIn's distributed key-value store; AP with vector clocks. |

**Typical use cases for AP:**
- Social media feeds & timelines
- Shopping cart contents
- Product catalog / recommendation systems
- Metrics, analytics, and counters
- Session storage

---

### Hybrid / Tunable Systems

| System | Notes |
|--------|-------|
| **Cassandra** | Tunable via quorum reads/writes (`ONE`, `QUORUM`, `ALL`) |
| **DynamoDB** | Optional strongly consistent reads |
| **MongoDB** | Configurable write concern and read preference |
| **CockroachDB** | CP by default; geo-partitioning for lower latency |

---

## 6. Conflict Resolution in AP Systems

When AP systems receive conflicting writes, they need strategies to reconcile:

- **Last Write Wins (LWW)**: Most recent timestamp wins — simple but loses data
- **Vector Clocks**: Track causality per node; detect concurrent writes
- **CRDTs** (Conflict-free Replicated Data Types): Data structures that auto-merge (counters, sets)
- **Application-level resolution**: Expose conflict to the application layer (CouchDB)
- **Quorum reads/writes**: `R + W > N` to achieve tunable consistency

---

## 7. PACELC — Beyond CAP

CAP only addresses behavior **during partitions**. PACELC extends it:

> **If Partition (P)**: choose Availability (A) or Consistency (C)
> **Else (E)**: choose Latency (L) or Consistency (C)

Even without a partition, replicating data introduces a **latency vs. consistency** trade-off.

| System      | P behavior | E behavior |
|-------------|------------|------------|
| DynamoDB    | AP         | EL         |
| Cassandra   | AP         | EL         |
| Spanner     | CP         | EC         |
| ZooKeeper   | CP         | EC         |
| MongoDB     | CP         | EC         |

---

## 8. Design Guidelines

### Choose CP when:
- Data correctness has financial or legal consequences
- Double-spending, double-booking, or race conditions are unacceptable
- The system manages critical shared state (distributed locks, config)

### Choose AP when:
- High availability SLAs (99.99%+) are required
- Temporary inconsistency is tolerable and reconcilable
- Write throughput at scale is a priority
- The system spans multiple geographic regions

### Practical tips:
- **Design for eventual consistency** even in CP systems — network delays mean brief staleness is common
- **Use idempotency** to safely retry operations in AP systems
- **Separate read/write models** (CQRS) to apply different consistency guarantees per path
- **Quorum tuning** (`R + W > N`) gives fine-grained control in systems like Cassandra
- **Saga pattern** for distributed transactions in AP microservices instead of 2PC

---

## 9. Quick Reference

```
Partition happens → Must choose:

CP: "I'd rather fail than lie"       AP: "I'd rather guess than fail"
    → Return error / timeout             → Return possibly stale data
    → ZooKeeper, etcd, HBase             → Cassandra, DynamoDB, DNS
    → Banking, locks, reservations       → Social feeds, carts, counters
```