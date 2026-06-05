# Availability vs Consistency: CP vs AP Systems

## The Core Tension

In distributed systems, **you cannot guarantee both strong consistency and high availability at the same time** when a network partition occurs (CAP Theorem). This forces a design choice that shapes your entire architecture:

| | **CP (Consistency + Partition Tolerance)** | **AP (Availability + Partition Tolerance)** |
|---|---|---|
| **On partition** | Reject or block requests | Serve potentially stale data |
| **Priority** | Correctness | Uptime |
| **Failure mode** | Returns error / timeout | Returns outdated data |
| **Recovery** | Clean — nodes re-sync before serving | Complex — conflicting writes must be reconciled |

> **P is not a choice.** Networks partition. Every real distributed system must tolerate partitions. The only actual choice is C vs A when a partition occurs.

---

## Consistency — What It Actually Means

### Strong Consistency (Linearizability)
- After a write completes, every subsequent read from **any** node returns that written value.
- Behaves as if there's a single machine with a single copy of data.
- Reads reflect real-time global state.

### Eventual Consistency
- All replicas will **converge** to the same value — given no new updates and enough time.
- A read immediately after a write may return the old value.
- The gap between write and global visibility is the **replication lag**.

### Causal Consistency
- Operations that are causally related are seen in order by all nodes.
- A reply is always seen after the message it replies to.
- Stronger than eventual, weaker than linearizable.

### Read-Your-Writes
- A client always sees its own writes reflected in subsequent reads.
- No guarantee other clients see them yet.
- Common in session-based systems.

### Monotonic Read Consistency
- Once a client reads a value, it will never read an older value.
- Prevents "going back in time" within a session.

---

## Availability — What It Actually Means

**Availability** = every request to a non-failing node returns a valid response within a bounded time.

- Not just "the system is running" — it means 100% of requests to live nodes get a non-error response.
- CAP availability is stricter than SLA availability (e.g., 99.99% uptime).
- A system that returns errors to prevent inconsistency is **not available** under CAP.

### Availability Metrics in Practice

| Availability | Downtime per Year | Downtime per Month |
|---|---|---|
| 99% ("two nines") | 3.65 days | 7.2 hours |
| 99.9% ("three nines") | 8.76 hours | 43.8 minutes |
| 99.99% ("four nines") | 52.6 minutes | 4.4 minutes |
| 99.999% ("five nines") | 5.26 minutes | 26.3 seconds |

> Most production systems target 99.9%–99.99%. "Five nines" requires extreme engineering.

---

## CP Systems — Consistency Over Availability

### How They Work
- On partition: refuse to serve requests from the isolated node (returns error or timeout).
- Before a write is acknowledged: confirm with quorum or all replicas.
- Reads are always from an up-to-date source.

### Mechanisms
- **Leader-based replication:** Only the elected leader serves reads/writes. Followers are hot standbys.
- **Quorum writes/reads:** Write to `W` nodes, read from `R` nodes, where `R + W > N` (N = total replicas).
- **Two-Phase Commit (2PC):** All nodes must agree before a transaction commits.
- **Raft / Paxos consensus:** Distributed agreement protocols ensure single consistent state.

### Real Systems

| System | Why CP |
|---|---|
| **ZooKeeper** | Distributed coordination — lock state must be correct |
| **Etcd** | Key-value store for Kubernetes config — stale config is dangerous |
| **Google Spanner** | Globally consistent transactions via TrueTime |
| **HBase** | Hadoop-backed, single master for strong consistency |
| **VoltDB** | In-memory NewSQL, serializable transactions |
| **PostgreSQL (synchronous replication)** | Primary blocks until replica confirms write |

### When to Use CP
- **Financial systems:** Debit/credit operations must be globally ordered. Double-spend = catastrophic.
- **Inventory management:** Overselling due to stale reads causes real-world losses.
- **Leader election / distributed locking:** Two nodes believing they hold a lock = split brain.
- **Configuration management:** Kubernetes nodes acting on stale config can cause outages.
- **Healthcare records:** Stale data can cause harm.
- **Authentication tokens:** A revoked session must be reflected everywhere immediately.

### Trade-offs
- Higher latency for writes (must wait for quorum/all replicas).
- May reject requests during partition (reduced availability).
- More complex failure handling and recovery.

---

## AP Systems — Availability Over Consistency

### How They Work
- On partition: continue serving requests on both sides of the partition.
- Return the most recent locally available data (which may be stale).
- Accept writes on both sides; reconcile conflicts after partition heals.

### Mechanisms
- **Async replication:** Write locally, propagate in background.
- **Vector clocks / version vectors:** Track causality to detect and resolve conflicts.
- **Last-Write-Wins (LWW):** In conflict, the write with the latest timestamp wins (risks data loss).
- **CRDTs (Conflict-free Replicated Data Types):** Data structures designed to merge automatically without conflicts (counters, sets, flags).
- **Read-repair:** On read, detect stale replicas and update them in background.
- **Anti-entropy / Gossip:** Background process continuously syncs replica differences.

### Real Systems

| System | Why AP | Conflict Strategy |
|---|---|---|
| **Cassandra** | High-write, always-on use cases | LWW (configurable) |
| **DynamoDB** (default) | Amazon's shopping cart, global scale | Eventual consistency + vector clocks |
| **Riak** | Geo-distributed, high availability | CRDTs, vector clocks |
| **CouchDB** | Offline-first, sync when connected | Multi-version, app-level merge |
| **DNS** | Availability of name resolution over real-time accuracy | TTL-based propagation |
| **Caches (Redis, Memcached)** | Speed over accuracy | TTL eviction |

### When to Use AP
- **Shopping carts:** A cart showing a slightly stale item count is acceptable. A failed checkout page is not.
- **Social media feeds / timelines:** Post appearing 200ms later is fine.
- **Product catalog / recommendations:** Stale data rarely matters; uptime always does.
- **Logging and metrics:** Approximate counts and eventual aggregation are acceptable.
- **CDNs:** Serve cached content; propagate updates eventually.
- **Collaborative editors (with CRDTs):** Merge edits from offline users.

### Trade-offs
- Must handle conflict resolution (who wins when two nodes wrote different values for same key?).
- Client must tolerate possibly stale data.
- Reconciliation logic can be complex.
- Some data loss possible if a node crashes before async replication completes.

---

## Conflict Resolution Strategies in AP Systems

| Strategy | How | Risk |
|---|---|---|
| **Last-Write-Wins (LWW)** | Timestamp comparison — latest wins | Clock skew can cause wrong winner |
| **Multi-Version Concurrency (MVCC)** | Store all versions, let app choose | Storage overhead, app complexity |
| **Vector Clocks** | Track causal history per replica | Version explosion with many clients |
| **CRDTs** | Mathematically conflict-free merge | Limited to certain data types (counters, sets) |
| **Application-level merge** | Business logic resolves conflicts | Requires custom code per entity type |
| **Human resolution** | Surface conflicts to user | Only practical for specific domains (docs) |

---

## Real-World Decision Framework

### Step 1: Classify Your Data

| Data Type | Recommended | Reason |
|---|---|---|
| Money, balances, inventory counts | CP | Incorrect state has direct business/financial impact |
| Session tokens, auth state | CP | Security requires immediate revocation |
| User preferences, settings | AP | Stale data causes UX annoyance, not breakage |
| Social actions (likes, follows) | AP | Eventual accuracy is fine |
| Distributed locks, leader election | CP | Correctness is binary |
| Product catalog, prices | AP or tunable | Short staleness windows acceptable |

### Step 2: Evaluate Your Failure Mode

Ask: **What's worse — a stale read or a failed request?**

- Stale read worse → CP (e.g., bank account balance)
- Failed request worse → AP (e.g., checkout page must load)

### Step 3: Consider Recovery Complexity

- CP: Simple — just replay or re-read after partition heals.
- AP: Complex — must detect, merge, and reconcile diverged state.

---

## Hybrid Approaches

Most modern systems are not purely CP or AP. They are **tunable** or **per-operation**.

### Tunable Consistency (Cassandra Example)

```
Write consistency:  ONE | QUORUM | ALL
Read consistency:   ONE | QUORUM | ALL

Strong consistency: R + W > N
  - N=3, W=2, R=2 → QUORUM reads and writes → strongly consistent
  
High availability:  R=1, W=1 → fastest, eventually consistent
```

### Multi-Model Systems
- **CosmosDB:** Offers 5 consistency levels on a spectrum — Strong → Bounded Staleness → Session → Consistent Prefix → Eventual.
- **MongoDB:** Default is eventual, but `majority` write concern + `majority` read concern = strong consistency.
- **DynamoDB:** Eventually consistent by default, `ConsistentRead: true` for strong.

### Two-Tier Architecture Pattern
Use different stores for different data needs within one system:

```
Financial Transactions  →  PostgreSQL (CP, serializable)
User Activity Feed      →  Cassandra (AP, eventual)
Session Store           →  Redis (AP, with TTL)
Config / Leader State   →  Etcd (CP, linearizable)
```

---

## Common Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Using AP store for financial data | Risk of double-spend, wrong balance | Use CP store or distributed transactions |
| Using CP store for high-traffic feeds | Bottleneck at leader, high latency | AP store with eventual consistency |
| Treating eventual consistency as "wrong data" | Misleads on acceptable windows | Define max staleness SLA explicitly |
| Ignoring conflict resolution in AP systems | Data silently overwritten | Implement and test merge logic |
| Assuming single-region CP = global CP | Replication lag between regions | Use geo-aware consistency (Spanner, CosmosDB) |

---

## Summary Cheat Sheet

```
Partition happens → Must choose:

CP: "I'd rather say 'error' than lie to you."
  ↳ Wait / block / reject
  ↳ All nodes converge before responding
  ↳ Use for: money, locks, config, auth

AP: "I'd rather give you something than nothing."
  ↳ Return latest local data
  ↳ Reconcile diverged state later
  ↳ Use for: feeds, carts, catalogs, analytics

Normal operation → PACELC's L vs C:
  ↳ Low latency = eventual consistency risk
  ↳ Strong consistency = coordination cost
```
