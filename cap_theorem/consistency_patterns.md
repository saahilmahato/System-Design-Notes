# Consistency Patterns in Distributed Systems

---

## What is Consistency?

In distributed systems, **consistency** defines the rules about when and how updates to data become visible across all nodes. It answers the question: *"After a write, what will a subsequent read return?"*

Consistency sits at the heart of the **CAP Theorem** and the **PACELC model**, which state that in the presence of network partitions, a distributed system must trade off between consistency and availability.

---

## Why Consistency Matters

- Multiple nodes can hold copies (replicas) of the same data.
- Network delays, failures, and partitions can cause nodes to diverge.
- Without a clear consistency model, clients can read stale, conflicting, or corrupt data.
- Choosing the right model directly impacts correctness, latency, and availability.

---

## Consistency Spectrum

Consistency models exist on a spectrum from strongest to weakest:

```
Strongest ◄────────────────────────────────────────► Weakest
   │                                                    │
   Linearizability → Sequential → Causal → Eventual → Weak
```

Stronger = higher data correctness, higher latency, lower availability
Weaker = higher availability, lower latency, risk of stale reads

---

## Consistency Patterns — Overview Table

| Pattern | Guarantee | Latency | Availability | Use Case |
|---|---|---|---|---|
| Strong (Linearizability) | All reads see the latest write | High | Lower | Banking, inventory |
| Sequential Consistency | All nodes see writes in the same order | Medium-High | Medium | Collaborative tools |
| Causal Consistency | Causally related operations are ordered | Medium | Medium-High | Social feeds, comments |
| Read-Your-Writes | A client always sees its own writes | Low-Medium | High | User profile updates |
| Monotonic Read | Reads never go backward in time | Low-Medium | High | News feeds |
| Monotonic Write | Writes from one client appear in order | Low-Medium | High | Log writes |
| Eventual Consistency | All replicas converge eventually | Low | Very High | DNS, caching, CDN |
| Weak Consistency | No guarantee on when/if updates propagate | Lowest | Highest | Gaming, VoIP, metrics |

---

## 1. Strong Consistency (Linearizability)

**Definition:** After a write completes, all subsequent reads — from any node, any client — immediately return the updated value. The system behaves as if there is a single copy of the data.

**Key Properties:**
- Every operation appears to take effect instantaneously at a single point in time.
- Operations are ordered globally — no two operations overlap in time.
- The strongest and most intuitive consistency guarantee.

**How it works:**
- Writes are synchronously replicated to all nodes (or a quorum) before acknowledging success.
- Reads are served only after confirming the latest write is applied.
- Typically implemented via consensus protocols: **Paxos**, **Raft**, **Zab**.

**Trade-offs:**

| Pro | Con |
|---|---|
| Clients always see correct, up-to-date data | Higher write latency (must wait for quorum) |
| Easiest to reason about correctness | Reduced availability during network partitions |
| No stale reads | Does not scale as easily across geographies |

**When to use:**
- Financial transactions (bank balances, transfers)
- Inventory management (prevent overselling)
- Leader election systems
- Distributed locks and coordination

**Examples:** Google Spanner, ZooKeeper, etcd, CockroachDB (serializable mode)

---

## 2. Sequential Consistency

**Definition:** All operations appear to execute in some sequential order that is consistent with the order observed by each individual process. Every node sees the same sequence of operations, but that sequence does not need to match real-time wall clock order.

**Key Properties:**
- Weaker than linearizability — there is no wall-clock ordering requirement.
- All nodes agree on the same order of events.
- Each client's operations appear in program order.

**Analogy:** Imagine two people posting to a bulletin board in different rooms. Everyone reads the posts in the same order, but not necessarily the order they were physically written.

**Trade-offs:**

| Pro | Con |
|---|---|
| All nodes see a consistent history | Not necessarily real-time; stale reads possible |
| Easier to reason about than weaker models | Harder to implement than eventual consistency |

**When to use:**
- Shared memory systems
- Multi-player games where order matters but clock precision does not
- Distributed file systems

---

## 3. Causal Consistency

**Definition:** Operations that are causally related (i.e., one operation "happened before" another) are seen by all nodes in that causal order. Concurrent (unrelated) operations may be seen in different orders by different nodes.

**Key Properties:**
- Based on Lamport's "happens-before" relationship.
- If operation A causally precedes B, then every node that sees B must have already seen A.
- Concurrent writes with no causal relation can be seen in any order.

**Example:**
- User A posts a question. User B reads the question and replies.
- Every other user must see the question *before* they see the reply.
- Two unrelated posts happening simultaneously can appear in any order.

**How it works:**
- Uses **vector clocks** or **version vectors** to track causal dependencies.
- Each write carries metadata about what it depends on.

**Trade-offs:**

| Pro | Con |
|---|---|
| Preserves logical ordering without full sync | More complex to implement than eventual |
| Higher availability than strong consistency | Concurrent writes can still cause conflicts |
| Natural fit for human communication patterns | Metadata overhead from tracking causality |

**When to use:**
- Comment threads and social media timelines
- Collaborative document editing
- Shopping cart updates
- Chat applications

**Examples:** MongoDB (causal sessions), DynamoDB (conditional writes), Cassandra (lightweight transactions)

---

## 4. Read-Your-Writes Consistency

**Definition:** A client is guaranteed to always read the effects of its own previous writes. Other clients may still see older values.

**Key Properties:**
- Session-scoped guarantee — only applies to the same client/session.
- A client never reads a value older than what it last wrote.
- Different clients may still read stale data from other clients' writes.

**Implementation:**
- Route reads and writes for the same session to the same node.
- Use session tokens with version numbers; the server waits until the relevant version is visible.
- Client can cache its own last-written value locally.

**Trade-offs:**

| Pro | Con |
|---|---|
| Intuitive UX — users see their changes immediately | Does not guarantee freshness for other clients' writes |
| Low overhead compared to strong consistency | Requires session affinity or version tracking |

**When to use:**
- User profile settings (user updates, immediately sees change)
- Shopping cart (items added are immediately visible to the same session)
- Form submissions and confirmations

---

## 5. Monotonic Read Consistency

**Definition:** If a client reads a value at time T, any subsequent read by the same client will return either the same value or a more recent one. Reads never go backward.

**Key Properties:**
- Prevents a client from seeing progressively older data.
- Does not guarantee the data is current — just that it does not regress.
- Typically session-scoped.

**Counter-example (what this prevents):**
- Client reads "100 items in stock"
- Client reads again and sees "95 items in stock" (newer)
- Client reads again and sees "100 items in stock" (older — violates this property!)

**Implementation:**
- Track the highest version number a client has seen; only serve reads at that version or later.
- Pin client to a replica that is at least as up-to-date.

**When to use:**
- News feeds and notification systems
- Analytics dashboards
- Any UI displaying real-time metrics

---

## 6. Monotonic Write Consistency

**Definition:** Writes from a single client are applied in the order that client issued them. The system ensures a client's writes are serialized and not reordered.

**Key Properties:**
- Only guarantees ordering of writes from the *same client*.
- Prevents a later write from being applied before an earlier one from the same source.

**Example:** A client appends log entries 1, 2, 3. The system guarantees entry 1 is applied before 2, and 2 before 3 — even across replicas.

**When to use:**
- Append-only logs
- Sequential event streams
- Any workflow where steps must execute in order

---

## 7. Eventual Consistency

**Definition:** Given no new updates, all replicas of a data item will *eventually* converge to the same value. Reads may temporarily return stale data, but the system will catch up.

**Key Properties:**
- A specific form of weak consistency.
- Data is replicated **asynchronously**.
- No upper bound is typically guaranteed on how long "eventually" takes.
- High availability and low latency are prioritized.

**BASE Properties (contrast with ACID):**

| Property | Meaning |
|---|---|
| **B**asically Available | The system guarantees availability |
| **S**oft state | State may change over time even without new input (due to propagation) |
| **E**ventually consistent | Data will converge given no new updates |

**Conflict Resolution Strategies:**

| Strategy | Description | Example |
|---|---|---|
| Last Write Wins (LWW) | The write with the latest timestamp wins | Cassandra default |
| Multi-Version Concurrency Control (MVCC) | Multiple versions kept; application resolves | CouchDB |
| CRDTs | Data structures that merge without conflicts by design | Shopping carts, counters |
| Application-level resolution | Application defines merge logic | Custom business rules |

**Trade-offs:**

| Pro | Con |
|---|---|
| Very high availability | Temporary inconsistencies visible to users |
| Very low latency | Requires conflict resolution strategy |
| Scales horizontally across geographies | Harder to reason about correctness |
| Tolerates network partitions well | Not suitable for financial or critical data |

**When to use:**
- DNS record propagation
- CDN cache invalidation
- Social media posts and likes/reactions
- Product catalog and search indexes
- Shopping carts (with CRDT-based merge)

**Examples:** Amazon DynamoDB, Apache Cassandra, Riak, CouchDB, Amazon S3

---

## 8. Weak Consistency

**Definition:** After a write, there is no guarantee that subsequent reads will see the update — ever, or within any time bound. The system makes no promises about when (or if) updates propagate.

**Key Properties:**
- The loosest possible model.
- Optimized entirely for availability and performance.
- The application must tolerate missing or stale data.

**Examples in practice:**
- **VoIP calls:** Dropped packets are not retransmitted; the call continues without them.
- **Online multiplayer games:** A lag spike means some players temporarily see an outdated game state. The game continues anyway.
- **Real-time telemetry/metrics:** A missed data point is acceptable; the stream continues.
- **Live video streaming:** Frames can be dropped without pausing the stream.

**Trade-offs:**

| Pro | Con |
|---|---|
| Maximum throughput and availability | Stale or missing reads are expected |
| Near-zero coordination overhead | Cannot be used for any data requiring correctness |
| Tolerates failures and partitions completely | Hard to build reliable application logic on top |

**When to use:**
- Real-time gaming state
- VoIP and video conferencing
- Sensor data and IoT telemetry
- Approximate counters and analytics

---

## Consistency vs. Availability: The CAP Theorem

A distributed system can guarantee at most **two** of the following three properties simultaneously.

| Property | Meaning |
|---|---|
| **C**onsistency | Every read receives the most recent write or an error |
| **A**vailability | Every request receives a response (not necessarily the latest data) |
| **P**artition Tolerance | The system continues operating despite network partitions |

Since network partitions are a reality, the practical trade-off is **CP vs AP**:

- **CP systems** (e.g., HBase, ZooKeeper, etcd): Sacrifice availability during partitions to maintain consistency.
- **AP systems** (e.g., Cassandra, DynamoDB, CouchDB): Remain available during partitions but may serve stale data.

---

## Tunable Consistency

Some databases allow you to configure the consistency level per operation using **quorum reads and writes**.

In a cluster of **N** nodes:
- **W** = number of nodes that must acknowledge a write
- **R** = number of nodes that must respond to a read
- **Consistency condition:** `W + R > N`

| Configuration | W | R | N | Effect |
|---|---|---|---|---|
| Strong read | 1 | N | N | All nodes confirm read |
| Strong write | N | 1 | N | All nodes confirm write |
| Quorum (balanced) | N/2+1 | N/2+1 | N | Balance of read/write performance |
| Fast write | 1 | N | N | Write fast, read slow |
| Fast read | N | 1 | N | Write slow, read fast |

**Examples:** Apache Cassandra (`QUORUM`, `ONE`, `ALL`), Amazon DynamoDB (eventually consistent vs. strongly consistent reads)

---

## Consistency in Practice: How to Choose

**Decision framework:**

1. **Can the application tolerate stale reads?**
   - No → Use strong or linearizable consistency
   - Yes → Eventual or causal consistency may suffice

2. **Is the data financial or safety-critical?**
   - Yes → Strong consistency required
   - No → Weaker models acceptable

3. **Is the system geographically distributed?**
   - Yes → Strong consistency across regions is very costly in latency; consider causal or eventual
   - No → Strong consistency is more practical

4. **How should conflicts be resolved?**
   - Clear rules (e.g., "last write wins") → Eventual with LWW
   - Domain-specific logic → Application-level resolution or CRDTs
   - Cannot be resolved automatically → Strong consistency preferred

5. **What are the latency requirements?**
   - Sub-10ms p99 → Eventual or weak consistency
   - Tolerant of 50–200ms → Causal or strong may be viable

---

## Real-World System Choices

| System | Consistency Model | Rationale |
|---|---|---|
| Google Spanner | Linearizable (TrueTime) | Global financial and transactional data |
| Amazon DynamoDB | Tunable (eventual by default) | High-scale, low-latency applications |
| Apache Cassandra | Tunable (eventual by default) | Time-series, write-heavy workloads |
| Apache ZooKeeper | Sequential consistency | Distributed coordination, leader election |
| Redis (Cluster) | Eventual | Speed-first caching |
| CockroachDB | Serializable (strong) | SQL ACID transactions at scale |
| MongoDB | Causal (sessions) | Flexible document workloads |
| Amazon S3 | Strong (since 2020) | Object storage with read-after-write |
| DNS | Eventual | Global propagation; correctness not time-critical |
| Git (distributed VCS) | Eventual + manual merge | Developer collaboration |

---

## Key Takeaways

- **No model is universally best.** Each is an engineering trade-off between correctness, latency, and availability.
- **Stronger consistency = higher cost** in latency, infrastructure, and availability during failures.
- **Eventual consistency requires conflict resolution** — designing merge strategies is as important as choosing the model.
- **Session-level guarantees** (read-your-writes, monotonic reads) are a practical middle ground for many user-facing applications.
- **CRDTs** are a powerful tool to achieve eventual consistency without conflicts in specific data structures (counters, sets, registers).
- **Tunable consistency** (Cassandra, DynamoDB) gives you control at the operation level — use it intentionally.
- **The CAP Theorem is a constraint, not a guide.** Use PACELC to reason about both partition behavior and normal operation latency trade-offs.