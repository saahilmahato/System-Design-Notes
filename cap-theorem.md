# CAP Theorem — Theory & Practice

---
# Part 1: Theory

## 1.1 Definition

In a distributed system, when a **network partition** occurs, a system must choose between:

| Property | Meaning |
|---|---|
| **Consistency (C)** | Every read receives the most recent write or an error. Behaves as if there's a single copy of the data (linearizability). |
| **Availability (A)** | Every request to a non-failing node receives a (non-error) response — no guarantee it's the latest write. |
| **Partition Tolerance (P)** | The system continues to operate despite arbitrary message loss/delay between nodes. |

**Formal statement (Gilbert & Lynch, 2002 — proof of Brewer's 2000 conjecture):** No distributed data store can simultaneously guarantee all three. Since network partitions are a physical inevitability in any system with more than one node, **P is not optional** — the real choice is **C vs A during a partition**.

## 1.2 Proof Sketch (Why It's True, Not Just Asserted)

Consider two nodes, N1 and N2, holding a replicated value, split by a partition:
1. Client writes value `v1` to N1.
2. Network partition occurs — N1 and N2 cannot communicate.
3. Client reads from N2.
4. N2 must choose:
   - **Wait / return error** until it can confirm sync with N1 → sacrifices **Availability**.
   - **Return its (possibly stale) local value** → sacrifices **Consistency**.
5. There is no third option: N2 cannot magically know N1's state without communication, and communication is impossible during a partition.

This is a **safety vs liveness** tradeoff at its core: Consistency is a safety property (nothing bad happens), Availability is a liveness property (something good eventually happens). Partition makes both impossible to guarantee together.

**Related result — FLP Impossibility (Fischer, Lynch, Paterson, 1985):** In an asynchronous system, no consensus algorithm can guarantee termination if even one node may fail — this is why real consensus protocols (Raft, Paxos) rely on timeouts/leader election rather than pure asynchronous guarantees, trading theoretical guarantees for practical liveness.

## 1.3 The Critical Misconception

CAP is commonly taught as "pick 2 of 3" — this is misleading:
- P is a fact of networked systems, not a design choice. A single-node system is trivially CA but isn't "distributed" in the sense CAP addresses.
- CAP constraints only bind **during an active partition**. Absent a partition, a well-built system can offer both C and A.
- The real, permanent decision is: **when a partition happens, do you sacrifice consistency or availability?**
- "We chose CA" is a red flag in interviews/design reviews — it implies either a single point of failure or a misunderstanding of the theorem.

## 1.4 CP vs AP — Practical Choice

| | CP (Consistency + Partition Tolerance) | AP (Availability + Partition Tolerance) |
|---|---|---|
| Behavior on partition | Minority-side nodes reject requests/block until reconciled | All nodes keep responding, may diverge |
| Use case | Payments, inventory, leader election, config/coordination, locks | Social feeds, shopping carts, DNS, caching, presence |
| Examples | Zookeeper, etcd, MongoDB (default), HBase, Spanner, CockroachDB | Cassandra, DynamoDB, CouchDB, Riak |
| Failure mode UX | "Service unavailable" for affected partition | Stale-but-present data |

## 1.5 PACELC — Extending CAP to the Non-Partition Case

CAP is silent about normal operation. **PACELC** (Abadi, 2010) fills the gap:

> **If Partition (P) → trade off A vs C. Else (E) → trade off Latency (L) vs Consistency (C).**

Even with zero partitions, waiting for all replicas to acknowledge a write (strong consistency) costs latency. This second axis is often *more relevant in practice* than the partition axis, since partitions are rare but latency tradeoffs happen on every request.

| System | Partition behavior | Normal-case behavior | Classification |
|---|---|---|---|
| Dynamo / Cassandra | Favors Availability | Favors Latency | **PA/EL** |
| MongoDB (majority writes) | Favors Consistency | Favors Consistency | **PC/EC** |
| Google Spanner | Favors Consistency | Favors Consistency (latency cost minimized via TrueTime) | **PC/EC** |
| Zookeeper / etcd | Favors Consistency | Favors Consistency | **PC/EC** |

---
# Part 2: Consistency Models (Full Spectrum)

Consistency is not binary — it's a spectrum of guarantees about **ordering** and **recency** of operations across replicas.

### 2.1 Data-Centric Models (apply across all clients)

| Model | Guarantee | Cost |
|---|---|---|
| **Linearizability (strict)** | Every operation appears to take effect instantaneously at some point between invocation and response; equivalent to a single copy of data | Highest latency, needs consensus (Raft/Paxos) or synchronized clocks |
| **Sequential Consistency** | All nodes agree on *one* global order of operations, but that order need not match real-time | Cheaper than linearizability, still needs global agreement |
| **Causal Consistency** | Operations that are causally related (A happens-before B) are seen in that order by all nodes; concurrent/unrelated ops may be seen in different orders | Achievable with vector clocks, good balance of usability + performance |
| **Eventual Consistency** | If writes stop, all replicas *eventually* converge to the same value | Cheapest, no ordering guarantee in the interim |
| **Strong Eventual Consistency (SEC)** | Eventual consistency + guarantee that replicas that received the same updates (in any order) converge to the same state, deterministically | Achieved via **CRDTs** (Conflict-free Replicated Data Types) — no reconciliation logic needed |

### 2.2 Client-Centric / Session Guarantees (apply per-client, cheaper than global models)

| Guarantee | Meaning |
|---|---|
| **Read-Your-Writes** | A client always sees its own prior writes |
| **Monotonic Reads** | If a client has seen a value, it will never see an older value on subsequent reads |
| **Monotonic Writes** | A client's writes are applied in the order it issued them |
| **Writes-Follow-Reads** | A client's write is ordered after any writes it has previously read (causal chain from a session) |

These are cheap to implement (e.g., "sticky sessions" to the same replica, or client-tracked version vectors) and solve most user-facing confusion (e.g., "I just posted a comment and it disappeared!") without paying for full linearizability.

### 2.3 A Frequently Confused Adjacent Concept: Serializability

- **Serializability** is a **transaction isolation** property (ACID), not a replication/CAP consistency property.
- It guarantees a set of transactions produces a result equivalent to *some* serial (one-at-a-time) execution — says nothing about real-time recency.
- **Strict Serializability = Serializability + Linearizability** — this is what Spanner actually provides, and is the gold standard for distributed databases.
- Don't conflate "consistency" in ACID (constraint validity) with "Consistency" in CAP (replica agreement) — they are different definitions of the same word.

### 2.4 Bounded Staleness
- A middle-ground model: reads may be stale, but bounded by a time window (e.g., "≤5 seconds old") or version count (e.g., "≤10 versions behind").
- Used by Cosmos DB as a tunable consistency level between eventual and strong.

---
# Part 3: Practice — How Real Systems Resolve the Tradeoff

## 3.1 Google Spanner (CP, globally distributed, strict serializability)

Spanner's core innovation is treating **time itself** as a solvable engineering problem:

- **TrueTime API**: Every node has access to GPS + atomic clocks, exposing not a single timestamp but a **bounded uncertainty interval** `[earliest, latest]` for "now."
- **Commit Wait**: Before acknowledging a write, Spanner waits out the TrueTime uncertainty interval (typically single-digit milliseconds) to guarantee the commit timestamp has definitely passed on all nodes — this is what makes external consistency (real-time global ordering) possible without a central coordinator.
- **Paxos per shard**: Each data shard (tablet) is replicated via Paxos across regions for CP behavior on partition.
- **Result**: Spanner gets strict serializability + global distribution, at the cost of a few extra ms latency per write (the commit-wait) and requiring specialized infrastructure (atomic clocks/GPS receivers in Google datacenters) — this is genuinely hard to replicate outside Google's infrastructure.
- **CockroachDB** (open-source, Spanner-inspired) achieves similar guarantees *without* atomic clocks by using **Hybrid Logical Clocks (HLC)** — combines physical clock + logical counter — trading a bit more latency uncertainty for commodity hardware compatibility.

## 3.2 Dynamo-Style Systems (Cassandra, DynamoDB, Riak) — AP

- **Vector clocks** or **version vectors** track causality between writes on different replicas to detect conflicts.
- **Read repair**: on a read, if replicas disagree, the coordinator reconciles and pushes the correct value back.
- **Hinted handoff**: if a node is down during a write, another node holds the write temporarily and forwards it once the down node recovers.
- **Conflict resolution**: last-write-wins (simplest, can lose data), or application-level merge (e.g., shopping cart union), or CRDTs.
- **Tunable consistency via quorums** (see 3.3) — Cassandra lets you pick consistency per-query (`ONE`, `QUORUM`, `ALL`).

## 3.3 Quorum Math (the practical lever behind most tunable systems)

Given `N` = total replicas, `W` = nodes that must ack a write, `R` = nodes queried on a read:

| Condition | Guarantee |
|---|---|
| `W + R > N` | Strong consistency — read set and write set always overlap by ≥1 node |
| `W + R ≤ N` | Availability/latency favored — possible stale reads |
| `W = N, R = 1` | Fast reads, slow/fragile writes (any node down blocks writes) |
| `W = 1, R = N` | Fast writes, slow/fragile reads |
| `W = R = (N/2)+1` (majority) | Balanced — the common default (e.g., Cassandra `QUORUM`) |

**Example:** N=3, W=2, R=2 → W+R=4 > N=3 → strong consistency, tolerates 1 node failure for both reads and writes.

## 3.4 Consensus-Based CP Systems (Zookeeper, etcd)

- Use **Raft** (etcd) or **Zab** (Zookeeper) — leader-based consensus protocols.
- Writes go through a leader, replicated to a majority before ack → naturally CP.
- On partition: minority side (no leader/no majority) rejects writes — this is why these are used for **coordination**, not bulk data (locks, leader election, config, service discovery) where correctness matters more than raw throughput.

## 3.5 Operational Realities Often Missed in Theory

- **Partition detection is probabilistic, not certain**: a node cannot distinguish "peer is down" from "peer is slow/network is congested" — this is why timeouts, heartbeats, and failure detectors (e.g., Phi Accrual) are core infra, not afterthoughts.
- **Split-brain risk**: two sides of a partition each think they're the "primary" — mitigated via **fencing tokens** (monotonically increasing tokens that invalidate stale leaders) or **quorum-based leader election** (minority side literally cannot elect a leader).
- **Client-perceived availability ≠ node availability**: a system can be "available" per CAP (nodes respond) while still being useless to the client if it returns errors due to quorum failure — define availability from the client's perspective in SLAs.
- **CAP is per-operation, not per-system**: the same database can serve a `QUORUM` read (CP-leaning) and a `ONE` read (AP-leaning) simultaneously — model tradeoffs at the operation/data-type level, not "our system is CP."

---
# Part 4: Design Checklist

- [ ] For each data type/feature, identify: **cost of returning stale data** vs **cost of returning an error/being unavailable**.
- [ ] Name the specific consistency model you need (not just "strong" or "eventual") — e.g., "causal consistency with read-your-writes" is a real, precise requirement.
- [ ] If low-latency global writes are needed with strong consistency, evaluate synchronized-clock approaches (TrueTime/HLC) vs accepting single-region writes.
- [ ] Use quorum tuning (`N/W/R`) where the underlying store supports it, rather than a fixed CP/AP label.
- [ ] Plan for split-brain explicitly: fencing tokens, majority quorums, or STONITH (Shoot The Other Node In The Head) for critical coordination systems.
- [ ] Distinguish CAP consistency (replica agreement) from ACID consistency (constraint validity) in design docs to avoid team miscommunication.
