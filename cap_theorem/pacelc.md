# PACELC Theorem

## What Is It?

**PACELC** is an extension of CAP that captures a critical blind spot: **CAP only talks about tradeoffs during partitions, but what about normal operation?**

Proposed by **Daniel J. Abadi** (2010), PACELC states:

> If there is a **P**artition, choose between **A**vailability and **C**onsistency (like CAP);  
> **E**lse (normal operation), choose between **L**atency and **C**onsistency.

```
P → A/C tradeoff   (during failure)
E → L/C tradeoff   (during normal operation)
```

---

## Why PACELC Improves on CAP

CAP's problem: it only speaks to an edge case (partition events). In reality, the **latency vs. consistency tradeoff exists every single second** in a running distributed system — even when the network is healthy.

To achieve strong consistency in normal operation, a system must:
- Coordinate writes across multiple replicas before acknowledging them.
- Wait for quorum confirmation.
- This coordination costs **latency**.

To achieve low latency, a system must:
- Write to a local node first and propagate later.
- This risks **stale reads** — a consistency sacrifice.

**PACELC makes this everyday tradeoff explicit and first-class.**

---

## The Full Model

| Scenario | Variable | Options |
|---|---|---|
| **Partition (P)** | Network failure | (A) Availability OR (C) Consistency |
| **Else / Normal (E)** | Everything working | (L) Low Latency OR (C) Consistency |

A system's PACELC classification is written as: **PA/EL**, **PC/EC**, **PA/EC**, **PC/EL**

---

## PACELC Classifications of Real Systems

| System | PACELC Class | Partition Behavior | Normal Behavior |
|---|---|---|---|
| **DynamoDB** (default) | PA/EL | Returns available (possibly stale) data | Eventual consistency, low latency writes |
| **Cassandra** (ONE consistency) | PA/EL | Available, accepts writes | Low latency, eventual consistency |
| **Riak** | PA/EL | Available, no quorum required | Low latency, eventual consistency |
| **MongoDB** (primary reads) | PA/EC | Routes to primary, stays available | Strong consistency via primary, some latency |
| **Spanner** | PC/EC | Refuses requests to stay consistent | TrueTime-based strong consistency, higher latency |
| **Etcd / ZooKeeper** | PC/EC | Rejects requests on partition | Linearizable reads/writes, coordination latency |
| **HBase** | PC/EC | Blocks during partition | Strong consistency, HDFS-backed |
| **CRDT-based systems** | PA/EL | Available, merge on recovery | No coordination needed, low latency |
| **MySQL (single node)** | PC/EC | N/A (not distributed) | ACID, serializable |
| **VoltDB** | PC/EC | Consistency over availability | High consistency, some latency overhead |

> **Note:** Most systems allow tunable consistency (e.g., Cassandra's `QUORUM`, DynamoDB's `ConsistentRead`). The table reflects default behavior.

---

## The Latency–Consistency Tradeoff (Else Case)

This is the everyday reality of distributed databases. Two dominant replication strategies:

### Synchronous Replication (High Consistency, High Latency)
- Primary waits for acknowledgment from all (or quorum) replicas before responding to client.
- Guarantees no data loss and strong consistency.
- Latency = network RTT × number of replicas involved.
- If a replica is slow, the whole write is slow.

```
Client → Primary → [writes to Replica 1, Replica 2] → ACK → Client
         ←————————— latency of slowest replica ————————→
```

### Asynchronous Replication (Low Latency, Weaker Consistency)
- Primary ACKs the client immediately after local write.
- Replication happens in the background.
- Reads may return stale data until replicas catch up.
- If primary crashes before replication, data is lost.

```
Client → Primary → ACK to Client (immediately)
                 ↘ [async replication to Replica 1, Replica 2]
```

---

## Consistency Levels and Latency in Practice

| Consistency Level | Latency | Staleness Risk | Example |
|---|---|---|---|
| **Linearizable (strong)** | Highest | None | Spanner, Etcd |
| **Quorum read/write** | Medium-high | Minimal | Cassandra QUORUM, DynamoDB ConsistentRead |
| **Read-your-writes** | Medium | None for same client | Session-aware systems |
| **Eventual** | Lowest | Possible until convergence | Cassandra ONE, DynamoDB default |
| **Bounded staleness** | Low-medium | Bounded window (e.g., 5s) | CosmosDB, Azure |

---

## PACELC in System Design Decisions

### When to Choose EL (Low Latency > Consistency)

- **Social media feeds:** A post appearing 200ms later is acceptable. A 500ms write latency is not.
- **Shopping carts:** Stale cart data is tolerable; a slow checkout page loses customers.
- **Recommendation engines:** Slightly outdated data doesn't hurt user experience.
- **Logging and analytics:** Approximate counts are fine. Strict ordering is not required.
- **Gaming leaderboards:** Eventually correct is acceptable; blocking writes is not.

### When to Choose EC (Consistency > Latency)

- **Financial transactions:** Double-spend prevention requires linearizable writes.
- **Inventory management:** Must not oversell. Every decrement must be globally ordered.
- **Distributed locking / leader election:** Requires consensus (ZooKeeper, Etcd).
- **User authentication:** Login tokens must not have split-brain state.
- **Medical records:** Incorrect or stale reads can cause harm.

---

## Tunable Consistency — The Practical Middle Ground

Most modern systems don't force a hard EC or EL choice. They offer **tunable consistency**:

### Cassandra Consistency Levels

| Level | Behavior | Tradeoff |
|---|---|---|
| `ONE` | Reads/writes to 1 replica | Lowest latency, highest staleness risk |
| `QUORUM` | Majority of replicas | Balanced (typical production choice) |
| `ALL` | Every replica must respond | Highest consistency, highest latency |
| `LOCAL_QUORUM` | Quorum within local datacenter | Minimizes cross-DC latency |

**Formula:** Read level + Write level > Replication Factor → strong consistency guaranteed.

### DynamoDB
- Default: Eventually consistent reads (EL).
- `ConsistentRead: true`: Strongly consistent reads (EC) — higher latency, higher cost.

---

## PACELC and the Replication Factor

Replication factor (RF) affects the *scope* of the L/C tradeoff:

- **Higher RF** → More nodes to coordinate on writes → higher latency for consistency.
- **Lower RF** → Fewer nodes → lower latency but less fault tolerance and harder to reach quorum.

At RF=3 with QUORUM reads and writes (2 of 3): any 1 node can fail and the system remains consistent. Latency is bounded by the 2nd-fastest replica.

---

## CAP vs PACELC — Side by Side

| Dimension | CAP | PACELC |
|---|---|---|
| **When** | During partitions only | During partitions AND normal operation |
| **Tradeoffs captured** | A vs C (under P) | A vs C (under P), L vs C (always) |
| **Latency** | Not addressed | First-class concern |
| **Practical relevance** | Edge case | Everyday engineering |
| **Classification** | CP, AP, (CA) | PA/EL, PA/EC, PC/EL, PC/EC |
| **System examples** | CP: ZooKeeper; AP: Dynamo | PC/EC: ZooKeeper; PA/EL: Cassandra |

---

## Key Takeaways for Engineers

- **CAP addresses failure. PACELC addresses everything.** Most of your system's life is not during a partition.
- **Low latency always comes at a consistency cost.** Every async replication is a bet that the window of staleness won't matter.
- **Tune for your access patterns.** Heavy read systems benefit from caching + eventual consistency. Heavy write coordination systems need quorum.
- **Know your SLAs.** If you promise 99.9% uptime and sub-10ms writes, you are implicitly choosing EL. Design accordingly.
- **Use bounded staleness** where you can't accept full eventual consistency but can't afford synchronous replication cost — set a maximum lag window.

---

## References

- Abadi, D. (2012). *Consistency Tradeoffs in Modern Distributed Database System Design: CAP is Only Part of the Story*. IEEE Computer. [Paper](https://cs-www.cs.yale.edu/homes/dna/papers/abadi-pacelc.pdf)
- Vogels, W. (2009). *Eventually Consistent*. ACM Queue. [Article](https://queue.acm.org/detail.cfm?id=1466448)
- Brewer, E. (2000). *Towards Robust Distributed Systems*. PODC Keynote.