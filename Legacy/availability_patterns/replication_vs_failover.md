# Availability Patterns: Replication & Fail-Over

---

## 1. Core Concept

**Availability** is the percentage of time a system is operational and accessible.
It is commonly expressed as "nines":

| Availability | Downtime / Year | Downtime / Month |
|---|---|---|
| 99% (2 nines) | ~3.65 days | ~7.2 hours |
| 99.9% (3 nines) | ~8.76 hours | ~43.8 min |
| 99.99% (4 nines) | ~52.6 minutes | ~4.4 min |
| 99.999% (5 nines) | ~5.26 minutes | ~26 sec |

**Availability Patterns** are architectural strategies to eliminate single points of failure (SPOF) and ensure a system continues to serve traffic even when components fail.

The two primary patterns are:
- **Replication** — duplicating data or services across multiple nodes
- **Fail-Over** — automatically switching traffic to a healthy node when one fails

---

## 2. Fail-Over

Fail-over is the mechanism of detecting a failure and routing traffic to a standby/replica node automatically.

### 2.1 Active-Passive (Hot Standby)

```
          ┌─────────────┐
Clients → │  Active     │ ← heartbeat → ┌─────────────┐
          │  (Primary)  │               │  Passive    │
          └─────────────┘               │  (Standby)  │
                                        └─────────────┘
```

- Only the **active** node serves traffic.
- The **passive** node receives heartbeats and holds a copy of state (either hot, warm, or cold).
- On failure, the passive node is promoted and begins accepting traffic.
- **VIP (Virtual IP)** or DNS record is updated to point to the new active node.

#### Standby Variants

| Type | State | Promotion Time | Cost |
|---|---|---|---|
| Hot Standby | Fully synced, running | Seconds | High (double resources) |
| Warm Standby | Partially synced, running | Minutes | Medium |
| Cold Standby | Not running, may be outdated | Many minutes | Low |

---

### 2.2 Active-Active

```
          ┌─────────────┐
          │  Node A     │ ←──── Load Balancer ────→ Clients
          └─────────────┘
          ┌─────────────┐
          │  Node B     │
          └─────────────┘
```

- **Both** nodes serve traffic simultaneously.
- On failure of one node, the load balancer stops routing to it; the surviving node handles all traffic.
- Requires conflict resolution if both nodes can accept writes.

---

### 2.3 Fail-Over Detection Methods

- **Heartbeat / Health Check** — periodic ping between nodes or from a monitor
- **Quorum / Consensus** — majority vote among cluster members (e.g., Raft, Paxos)
- **Gossip Protocol** — nodes propagate health state to peers (used in Cassandra, DynamoDB)
- **External Monitor** — a dedicated service (e.g., Keepalived, AWS Route 53 health checks) watches primary and triggers DNS/VIP change

---

### 2.4 Fail-Over Trade-offs

| | Active-Passive | Active-Active |
|---|---|---|
| **Complexity** | Lower | Higher (conflict resolution) |
| **Resource utilization** | Poor (standby is idle) | Good (both nodes serve traffic) |
| **Failover time** | Seconds–minutes | Near-zero |
| **Write conflicts** | None | Possible (need resolution strategy) |
| **Cost** | Higher (wasted standby) | Efficient |

**General Trade-offs:**
- Fail-over adds **hardware cost** and **operational complexity**.
- There is always a potential **data loss window** (RPO) between the last sync and the failure.
- A failover event can cause a brief period of **increased latency** during promotion.
- Risk of **split-brain**: both nodes believe they are the primary (mitigated by quorum/fencing).

---

## 3. Replication

Replication is the process of keeping copies of data synchronized across multiple nodes to improve **availability**, **durability**, and **read scalability**.

### 3.1 Synchronous vs. Asynchronous Replication

```
                  ┌──────────────┐
                  │   Primary    │
                  └──────┬───────┘
          ┌───────────────┴────────────────┐
   Sync   ▼                         Async  ▼
┌──────────────┐                  ┌──────────────┐
│  Replica A   │                  │  Replica B   │
│ (ack before  │                  │ (ack after   │
│  returning)  │                  │  returning)  │
└──────────────┘                  └──────────────┘
```

| | Synchronous | Asynchronous |
|---|---|---|
| **Durability** | High (no data loss on failover) | Lower (replication lag) |
| **Write Latency** | Higher (waits for replica ack) | Lower (fire-and-forget) |
| **Availability** | Lower (replica slowness blocks writes) | Higher |
| **Use case** | Financial transactions, critical data | High-throughput, geo-replication |

**Semi-synchronous**: Write must be acknowledged by at least one replica (used in MySQL, PostgreSQL). Balances latency and durability.

---

### 3.2 Replication Topologies

#### Single-Leader (Master-Slave / Primary-Replica)

```
Writes → [ Primary ] → replicates → [ Replica 1 ]
                                  → [ Replica 2 ]
                                  → [ Replica N ]
Reads  → any Replica (or Primary)
```

- All writes go to a single primary.
- Replicas serve reads, improving read throughput.
- Simple consistency model.
- Primary is still a SPOF for writes unless combined with fail-over.

#### Multi-Leader (Multi-Master)

```
[ Leader A ] ←──── bi-directional replication ────→ [ Leader B ]
(DC East)                                            (DC West)
```

- Multiple nodes accept writes.
- Necessary for **multi-datacenter** or **offline-capable** systems.
- Requires **conflict resolution** (last-write-wins, CRDTs, application logic).

#### Leaderless (Dynamo-style)

```
Clients write to N nodes (quorum W), read from R nodes.
No single leader — any replica can accept reads/writes.
```

- Uses **quorum reads/writes**: `R + W > N` to guarantee consistency.
- Highly available and partition-tolerant.
- Uses **read repair** and **anti-entropy** to reconcile replicas.

---

### 3.3 Replication Lag & Consistency Models

| Model | Guarantee | Example Systems |
|---|---|---|
| Strong Consistency | Read always sees latest write | Spanner, etcd, Zookeeper |
| Read-Your-Writes | You always see your own writes | Most SQL replicas w/ sticky sessions |
| Monotonic Reads | Reads don't go "back in time" | Cassandra tunable consistency |
| Eventual Consistency | Replicas converge over time | DynamoDB, Cassandra, CouchDB |
| Causal Consistency | Causally related ops are ordered | MongoDB (causal sessions) |

---

### 3.4 Replication Trade-offs

| Concern | Impact |
|---|---|
| **Read scalability** | More replicas → more read throughput |
| **Write scalability** | All writes still go through primary (single-leader) |
| **Replication lag** | Stale reads from replicas, especially under high load |
| **Storage cost** | N× storage for N replicas |
| **Conflict resolution** | Complexity increases in multi-leader / leaderless |
| **Network bandwidth** | Continuous replication stream consumes bandwidth |
| **Schema changes** | Must be applied carefully to avoid breaking replicas |

---

## 4. Combining Replication + Fail-Over

In practice, replication and fail-over are used **together**:

```
         ┌──────────────────────────────────────────────────┐
         │                 Load Balancer / DNS              │
         └──────────────────────┬───────────────────────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │           Primary (Leader)         │ ← writes
              └────────────┬────────────┬──────────┘
                           │            │
              ┌────────────▼──┐   ┌─────▼────────┐
              │  Replica 1    │   │   Replica 2  │ ← reads
              └───────────────┘   └──────────────┘
```

- Replicas serve reads, reducing load on primary.
- On primary failure, one replica is **elected** as the new primary (via Raft/Paxos or external tool like Orchestrator/Patroni).
- Health checks and sentinel processes detect the failure and trigger promotion.

---

## 5. Real-World Systems & Applications

### 5.1 MySQL / PostgreSQL
- **Pattern**: Single-leader async/semi-sync replication
- **Fail-over**: Orchestrated by tools like **Orchestrator** (MySQL), **Patroni** (Postgres), or **MHA**
- **Usage**: Standard RDBMS HA in applications like GitHub, GitLab, Shopify

### 5.2 Redis Sentinel / Redis Cluster
- **Pattern**: Primary-Replica with Sentinel for monitoring
- **Fail-over**: Sentinel quorum votes to promote a replica to primary automatically
- **Usage**: Session stores, caching layers (Twitter, GitHub)

### 5.3 Apache Kafka
- **Pattern**: Leader-follower replication per partition; ISR (In-Sync Replicas)
- **Fail-over**: Controller node detects leader failure and elects a new leader from ISR
- **Usage**: Event streaming at LinkedIn, Uber, Netflix

### 5.4 Amazon DynamoDB
- **Pattern**: Multi-leader (Global Tables) + leaderless within a region
- **Replication**: Async cross-region; synchronous within AZs
- **Usage**: Shopping carts, session storage, gaming leaderboards

### 5.5 Google Spanner
- **Pattern**: Multi-region synchronous replication using Paxos
- **Fail-over**: Transparent — Paxos handles leader election automatically
- **Usage**: Google Ads, financial systems requiring external consistency

### 5.6 Elasticsearch
- **Pattern**: Primary shard + replica shards
- **Fail-over**: Master node detects shard failure; promotes replica to primary automatically
- **Usage**: Search infrastructure at Uber, Netflix, Wikipedia

### 5.7 AWS RDS Multi-AZ
- **Pattern**: Synchronous replication to a standby in a different Availability Zone
- **Fail-over**: Automatic DNS failover within 60–120 seconds
- **Usage**: Managed PostgreSQL/MySQL HA for web applications

### 5.8 CockroachDB / TiDB
- **Pattern**: Multi-active with Raft consensus per range/region
- **Fail-over**: Automatic, no manual intervention
- **Usage**: Geo-distributed OLTP applications

---

## 6. Key Design Decisions & Checklist

When designing for availability using replication and fail-over, consider:

- [ ] **RTO** (Recovery Time Objective): How quickly must the system recover?
- [ ] **RPO** (Recovery Point Objective): How much data loss is acceptable?
- [ ] **Replication mode**: sync (durable) vs. async (fast) vs. semi-sync (balanced)?
- [ ] **Topology**: single-leader, multi-leader, or leaderless?
- [ ] **Fail-over mechanism**: manual, automated, or consensus-based?
- [ ] **Split-brain prevention**: use fencing (STONITH), quorum, or leader leases
- [ ] **Consistency model**: what does the application require after a failover?
- [ ] **Read routing**: direct reads to replicas to reduce primary load?
- [ ] **Monitoring**: health checks, lag metrics, alerting on replication delay
- [ ] **Testing**: regularly test failover with chaos engineering (e.g., Netflix Chaos Monkey)

---

## 7. Summary

```
High Availability = Replication (data redundancy) + Fail-Over (traffic rerouting)

Active-Passive  → Simple, some downtime, possible data loss
Active-Active   → Complex, near-zero downtime, conflict resolution needed

Single-Leader   → Simple writes, scales reads, lag possible
Multi-Leader    → Scales writes, conflict resolution required
Leaderless      → Highest availability, tunable consistency via quorum
```

The right combination depends on your **SLA**, **consistency requirements**, **cost tolerance**, and **operational maturity**.