# Replication

---

## What is Replication?

**Replication** is the process of maintaining multiple copies of the same data across different nodes, servers, or geographic locations.

**Why it matters:**
- **Availability** — if one node fails, others can serve data
- **Fault tolerance** — no single point of data loss
- **Read scalability** — spread read load across replicas
- **Latency reduction** — serve users from geographically closer replicas

---

## Core Replication Vocabulary

| Term | Meaning |
|---|---|
| **Leader / Primary / Master** | Node that accepts writes |
| **Follower / Replica / Slave** | Node that copies data from the leader |
| **Replication Lag** | Delay between a write on the leader and it appearing on a replica |
| **Failover** | Promoting a replica to leader when the current leader dies |
| **WAL (Write-Ahead Log)** | Log of all DB changes — the mechanism most DBs use to replicate |
| **Replication Factor** | Number of copies of the data maintained (e.g., 3 in Kafka, Cassandra) |

---

## Replication Topologies

### 1. Single-Leader (Master-Slave)

- One node is the **leader** — all writes go here
- One or more **followers** replicate the leader's writes
- Reads can be served by the leader or any follower
- If the leader fails → a follower is promoted to leader

```
Clients
  │
  ▼
[Leader]  ──writes──▶  [Replica 1]
                  └──▶  [Replica 2]
                  └──▶  [Replica 3]
```

**When to use:**
- Read-heavy workloads (offload reads to replicas)
- You need a simple consistency model
- Most relational DBs default to this (PostgreSQL, MySQL)

**Disadvantages:**
- Leader is a write bottleneck — all writes funnel through one node
- If leader fails before replicating, data can be lost
- Replicas serving reads may return stale data (replication lag)
- Promoting a slave to master requires additional logic
- Read replicas with heavy write load get bogged down replaying the write log and serve fewer reads
- More replicas = more replication overhead = higher replication lag

---

### 2. Multi-Leader (Master-Master)

- Multiple nodes act as leaders — each can accept reads *and* writes
- Leaders sync with each other asynchronously
- If one leader fails, others continue serving both reads and writes

```
[Leader A] ◀──sync──▶ [Leader B]
     │                     │
[Replica A1]         [Replica B1]
```

**When to use:**
- Multi-datacenter deployments — each DC has its own local leader
- Offline-capable clients (e.g., mobile apps that sync later)
- High write availability is required

**Disadvantages:**
- **Write conflicts** — two leaders can accept conflicting writes to the same record simultaneously; conflict resolution is hard
- Most multi-leader systems are either loosely consistent (violating ACID) or suffer increased write latency from synchronization
- Conflict resolution complexity grows as more write nodes and latency are added
- Needs a load balancer or application-level logic to route writes to the correct leader
- Adds significant operational complexity

**Conflict Resolution Strategies:**

| Strategy | How it works |
|---|---|
| **Last Write Wins (LWW)** | Timestamp-based; most recent write survives — risk of data loss |
| **Merge** | Application merges conflicting values (e.g., CRDTs in Riak) |
| **Custom logic** | App defines rules for how to resolve specific conflicts |
| **Avoid conflicts** | Route all writes for a given record to the same leader |

---

### 3. Leaderless Replication

- No designated leader — clients write to **multiple nodes in parallel**
- Reads also query multiple nodes and reconcile results (quorum reads)
- Used in: **Cassandra**, **DynamoDB**, **Riak**, **Voldemort**

**Quorum Condition:**

- `n` = total replicas, `w` = write quorum, `r` = read quorum
- For strong consistency: **w + r > n**
- Example: n=3, w=2, r=2 → any read will overlap with any write

| Config | Behavior |
|---|---|
| w=3, r=1 | Fast reads, slow/expensive writes |
| w=1, r=3 | Fast writes, slow/expensive reads |
| w=2, r=2 | Balanced — standard for n=3 |

**When to use:**
- Need high write availability with no single leader bottleneck
- Can tolerate eventual consistency
- Massive scale (Dynamo-style systems)

---

## Synchronous vs. Asynchronous Replication

This is one of the most important tradeoffs in replication.

### Synchronous Replication

- Leader **waits** for the replica to confirm it received and persisted the write before acknowledging success to the client
- **Guarantee**: replica is always up-to-date with the leader

```
Client ──write──▶ [Leader] ──replicate──▶ [Replica]
                      ◀────────ack─────────
         ◀──success──
```

| Pros | Cons |
|---|---|
| No data loss on leader failure | Write latency increases — leader blocks on replica response |
| Replica always consistent | If replica is slow or down, writes stall or fail |
| Safe for critical data (banking) | Not suitable when replicas are geographically distant |

**Used in:** PostgreSQL synchronous_commit, Google Spanner (globally), most RDBMS "sync" modes

---

### Asynchronous Replication

- Leader **does not wait** — acknowledges the write to the client immediately, then replicates in the background
- **Guarantee**: eventually the replica will catch up, but it may lag behind

```
Client ──write──▶ [Leader] ──▶ ack to client immediately
                      └──async──▶ [Replica] (later)
```

| Pros | Cons |
|---|---|
| Low write latency — leader doesn't block | **Replication lag** — replica may serve stale reads |
| System stays available even if replica is down | **Data loss risk** — if leader crashes before replicating |
| Better for geographically distributed setups | Harder to reason about consistency |

**Used in:** MySQL async replication, MongoDB (default), most cloud DBs by default

---

### Semi-Synchronous Replication

- A hybrid: leader waits for **at least one** replica to confirm, then proceeds asynchronously for the rest
- Guarantees at least one durable copy exists, without blocking on all replicas
- Common default in MySQL (`rpl_semi_sync`)

---

### Comparison Table

| Dimension | Synchronous | Semi-Synchronous | Asynchronous |
|---|---|---|---|
| **Write latency** | High | Medium | Low |
| **Data durability** | Highest | High | Lower |
| **Data loss on failover** | None | Minimal | Possible |
| **Availability** | Lower (replica slowness blocks writes) | Medium | High |
| **Use case** | Financial systems, critical data | Most production DBs | High-throughput, geo-distributed |

---

## Full vs. Partial Replication

### Full Replication

- **Every node holds the complete dataset**
- Every replica is an exact copy of the leader

**Pros:**
- Any node can answer any query — great for read scalability
- Simple mental model

**Cons:**
- Every node needs enough storage for the entire dataset
- Replication bandwidth is proportional to total data size
- Write amplification — every write must be applied everywhere

**Used in:** Most traditional single-leader setups (MySQL replicas, PostgreSQL standbys)

---

### Partial Replication (Filtered / Selective Replication)

- Only a **subset of the data** is replicated to each node
- Different replicas may hold different subsets

**Common forms:**

| Form | Description | Example |
|---|---|---|
| **Row filtering** | Only rows matching a condition are replicated | Replicate only US customer records to US replica |
| **Column filtering** | Sensitive columns excluded from some replicas | Strip PII before replicating to analytics replica |
| **Table filtering** | Only specific tables are replicated | Replicate only the `orders` table to reporting replica |
| **Sharding-based** | Each shard is a partial replica of the total dataset | Cassandra, MongoDB sharding |

**Pros:**
- Reduces storage requirements per node
- Reduces replication bandwidth
- Enables compliance (keep data in specific regions)

**Cons:**
- Queries that span multiple subsets must fan out to multiple nodes
- More complex to manage and reason about

---

## Replication Lag & Its Problems

**Replication lag** = time between a write on the leader and it being visible on a replica.

Even a few seconds of lag can cause serious issues in practice.

### Read-Your-Own-Writes Violation

- User writes data, then immediately reads it from a replica that hasn't caught up yet
- They see their own data disappear or revert
- **Fix**: route reads-after-writes to the leader, or track the write timestamp and wait for replica to catch up

### Monotonic Reads Violation

- User reads value `X` from Replica 1, then refreshes and reads from Replica 2 which is further behind — sees an older value
- Data appears to "go back in time"
- **Fix**: sticky sessions — always route a given user to the same replica

### Consistent Prefix Reads Violation

- In distributed systems, writes that happened in order on the leader may arrive out of order at replicas
- Reads may see effects before causes (e.g., a reply to a message appears before the original message)
- **Fix**: causality tracking, vector clocks, or ordering guarantees in the replication protocol

---

## Failover Deep Dive

When the leader fails, a replica must be promoted. This is more complex than it sounds.

### Automatic Failover Steps

1. Detect leader failure (health check timeout, heartbeat loss)
2. Choose a new leader — usually the most up-to-date replica (least replication lag)
3. Reconfigure clients/load balancers to route writes to new leader
4. Old leader (if it recovers) must become a follower and not accept writes

### Failover Failure Modes

| Problem | Description |
|---|---|
| **Split-brain** | Both old and new leader think they're primary → conflicting writes. Mitigated with fencing tokens or STONITH (Shoot The Other Node In The Head) |
| **Data loss** | New leader is behind — writes on old leader that weren't replicated are lost |
| **False failover** | Network hiccup causes healthy leader to be declared dead and replaced unnecessarily |
| **Cascading failures** | New leader is already under load — taking on writes causes it to also fail |

---

## Replication in Popular Systems

| System | Model | Sync Mode | Notes |
|---|---|---|---|
| **PostgreSQL** | Single-leader | Sync or async (configurable) | Streaming replication via WAL |
| **MySQL** | Single-leader | Async or semi-sync | Binlog-based replication |
| **MongoDB** | Single-leader (Replica Sets) | Async (majority write concern available) | Auto-elects new primary via Raft |
| **Cassandra** | Leaderless | Async (tunable quorum) | Eventual consistency by default |
| **DynamoDB** | Leaderless | Async (eventual) or strong consistency per request | Quorum-based internally |
| **Redis** | Single-leader | Async | Redis Sentinel/Cluster for HA |
| **Kafka** | Leader per partition | Sync (ISR — In-Sync Replicas) | Acks=all for no data loss |
| **Google Spanner** | Multi-leader (Paxos) | Synchronous (globally) | Externally consistent; uses TrueTime |

---

## Replication Tradeoff Summary

| Tradeoff | Option A | Option B |
|---|---|---|
| **Consistency vs. Latency** | Sync replication (consistent, slow) | Async replication (fast, may be stale) |
| **Write throughput vs. Safety** | Single leader (bottleneck, consistent) | Multi-leader (higher throughput, conflicts) |
| **Storage vs. Query simplicity** | Full replication (expensive, simple queries) | Partial/sharded (cheaper, complex queries) |
| **Availability vs. Consistency** | Async + many replicas (high availability) | Sync + quorum (stronger consistency) |

---

## Quick Interview Cheatsheet

- **"How do you prevent data loss on leader failure?"** → Synchronous replication to at least one replica, or majority quorum writes
- **"How do you scale reads?"** → Add read replicas (single-leader), be aware of replication lag
- **"How do you handle multi-datacenter writes?"** → Multi-leader or leaderless with async replication + conflict resolution
- **"What is split-brain?"** → Two nodes both think they're primary → use fencing, Raft, or Paxos to prevent it
- **"Eventual consistency vs. strong consistency?"** → Async replication = eventual; sync + quorum = strong

---

> **Key Principle:** There is no free lunch in replication. Every system trades between write latency, data durability, read consistency, and availability. Know the tradeoffs and choose based on the system's specific requirements.