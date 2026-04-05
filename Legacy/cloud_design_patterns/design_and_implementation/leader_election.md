# Leader Election — Cloud Design Pattern

---

## 1. What Is Leader Election?

In a distributed system with multiple identical instances (nodes/workers), **Leader Election** is the process of designating one instance as the **coordinator (leader)** responsible for managing shared resources, orchestrating work, or making decisions — while all other instances act as **followers** that stand by to take over if the leader fails.

Without a leader election mechanism, multiple nodes acting independently on shared state leads to **race conditions, duplicate work, and split-brain scenarios**.

---

## 2. Core Concepts

| Term | Definition |
|---|---|
| **Leader** | The single elected node with authority to perform privileged operations |
| **Follower** | Passive nodes that monitor the leader and are candidates for re-election |
| **Election** | The process triggered when no leader exists or the current leader fails |
| **Term / Epoch** | A monotonically increasing number identifying an election cycle |
| **Lease** | A time-bounded lock granted to the leader; must be renewed periodically |
| **Split Brain** | Two nodes simultaneously believing they are the leader — the most dangerous failure mode |
| **Quorum** | A majority of nodes (N/2 + 1) that must agree for a decision to be valid |
| **Fencing** | Mechanism to prevent a deposed leader from corrupting state (e.g., STONITH, fencing tokens) |

---

## 3. When to Use

- Exactly-one execution of periodic jobs (scheduled tasks, cron-like workloads)
- Coordinating writes to a shared resource (primary DB, distributed lock)
- Managing shard assignment or partition ownership (Kafka partition leaders)
- Sequence number / ID generation that must be monotonic
- Orchestrating cluster-wide configuration changes
- Primary replica management in database replication

### When NOT to Use

- Stateless, horizontally scalable workloads (use load balancing instead)
- When work can be safely deduplicated at the consumer (idempotent consumers)
- Systems where partition tolerance is more critical than coordination (use leaderless replication)

---

## 4. How It Works — General Flow

```
Startup
   │
   ▼
All nodes attempt to acquire
a distributed lock / register
   │
   ├── One node wins → becomes LEADER
   │       │
   │       ▼
   │   Performs privileged work
   │   Renews lease periodically
   │       │
   │       ▼
   │   Leader fails / lease expires
   │
   └── Remaining nodes → new ELECTION
           │
           ▼
       New leader elected
       (epoch/term incremented)
```

---

## 5. Leader Election Algorithms

### 5.1 Bully Algorithm
- The node with the **highest ID** bullies lower-ID nodes into surrendering.
- Steps: A node detects leader failure → sends `ELECTION` to all higher-ID nodes → if no response, it declares itself leader → broadcasts `COORDINATOR` message.
- **Flaw**: O(n²) messages. High-ID node re-elects itself even if it has poor network.

### 5.2 Ring Algorithm
- Nodes arranged in a **logical ring**; election message travels around the ring.
- Each node appends its ID; the node with the max ID wins.
- **Flaw**: O(n) message rounds but susceptible to ring partitions.

### 5.3 Raft Consensus
- Nodes are in one of three states: **Follower, Candidate, Leader**.
- Followers wait for heartbeats; if timeout expires → become Candidate → send `RequestVote` RPCs.
- A node becomes Leader when it receives votes from a **majority (quorum)**.
- Leader sends periodic `AppendEntries` heartbeats to suppress new elections.
- Each term has at most one leader. **Term number acts as a logical clock**.

```
[Follower] ──timeout──► [Candidate] ──majority votes──► [Leader]
     ▲                        │                              │
     └────────────────────────┘◄─────── heartbeat ──────────┘
          discovers higher term
```

### 5.4 ZAB (Zookeeper Atomic Broadcast)
- Used by Apache ZooKeeper.
- Combines leader election with a total-order broadcast protocol.
- New leader must sync with a quorum before serving writes.
- Epoch numbers prevent old leaders from issuing commands.

### 5.5 Lease-Based Election (Practical / Cloud-Native)
- Leader acquires a **TTL-based lock** in a shared store (etcd, Redis, ZooKeeper).
- Leader renews the lease before TTL expires.
- If the leader crashes, TTL expires → other nodes compete for the lock.
- Simple to implement; widely used in Kubernetes, cloud services.

```
etcd / Redis / ZooKeeper
        │
  SET leader=nodeA EX 10   ← nodeA acquires lock
        │
  nodeA renews every 5s
        │
  nodeA crashes → TTL expires
        │
  nodeB acquires lock → new leader
```

---

## 6. Implementation Approaches

### 6.1 Using etcd (Kubernetes-style)
```go
// Acquire leadership via etcd lease
lease, _ := etcdClient.Grant(ctx, ttlSeconds)
txn := etcdClient.Txn(ctx).
    If(clientv3.Compare(clientv3.CreateRevision("/leader"), "=", 0)).
    Then(clientv3.OpPut("/leader", nodeID, clientv3.WithLease(lease.ID))).
    Commit()

if txn.Succeeded {
    // This node is the leader
    go renewLease(lease.ID)
}
```

### 6.2 Using Redis (SET NX EX)
```python
import redis, time, uuid

r = redis.Redis()
node_id = str(uuid.uuid4())
LOCK_KEY = "service:leader"
TTL = 10  # seconds

def try_become_leader():
    # SET if Not eXists with TTL
    return r.set(LOCK_KEY, node_id, nx=True, ex=TTL)

def renew_leadership():
    # Only renew if I am still the leader (atomic check-and-set via Lua)
    lua = """
    if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('expire', KEYS[1], ARGV[2])
    else
        return 0
    end
    """
    return r.eval(lua, 1, LOCK_KEY, node_id, TTL)

while True:
    if try_become_leader() or renew_leadership():
        do_leader_work()
    time.sleep(TTL / 2)
```

### 6.3 Using ZooKeeper
```java
// Use ephemeral sequential znodes — lowest sequence number = leader
String path = zk.create("/election/node-", data,
    ZooDefs.Ids.OPEN_ACL_UNSAFE,
    CreateMode.EPHEMERAL_SEQUENTIAL);

// Watch the node with the immediately lower sequence number
// If it disappears → try to become leader
```

### 6.4 Kubernetes Leader Election (client-go)
```go
// Kubernetes uses a Lease object in the API server
leaderelection.RunOrDie(ctx, leaderelection.LeaderElectionConfig{
    Lock:            resourceLock,
    LeaseDuration:   15 * time.Second,
    RenewDeadline:   10 * time.Second,
    RetryPeriod:     2 * time.Second,
    Callbacks: leaderelection.LeaderCallbacks{
        OnStartedLeading: func(ctx context.Context) { runController(ctx) },
        OnStoppedLeading: func() { os.Exit(1) },
        OnNewLeader:      func(id string) { log.Printf("new leader: %s", id) },
    },
})
```

---

## 7. Trade-offs

### Availability vs. Consistency
| Concern | Description |
|---|---|
| **Short TTL** | Faster failover, but risks false positives (GC pause mimics crash) → split brain |
| **Long TTL** | Safer, but slow failover → reduced availability window |
| **Recommended** | TTL = 3–5× the renewal interval; tune based on p99 GC/network latency |

### Fencing — Preventing Stale Leaders
A deposed leader may still be running (e.g., long GC pause caused lease expiry). Use **fencing tokens**:
```
Leader A gets token=42, lease expires, Leader B gets token=43
A (still alive) tries to write → storage rejects because 42 < 43
```
- **etcd**: revision numbers serve as fencing tokens.
- **ZooKeeper**: zxid (transaction ID) serves this role.
- **Redis (Redlock)**: No built-in fencing — do NOT use for strict leader election in safety-critical systems.

### Summary Trade-off Table

| Dimension | Strong Consensus (Raft/ZAB) | Lease-Based (etcd/Redis) |
|---|---|---|
| **Correctness** | High — quorum prevents split brain | Medium — depends on clock drift & TTL |
| **Operational complexity** | High | Low |
| **Failover speed** | Seconds (election round) | TTL-dependent (configurable) |
| **Throughput overhead** | High (n messages per heartbeat) | Low (periodic lock renewal) |
| **Split brain risk** | Very low | Low–Medium (clock skew risk) |
| **Best for** | Database replication, critical coordination | Service singletons, k8s controllers |

---

## 8. Failure Modes & Mitigations

| Failure | Cause | Mitigation |
|---|---|---|
| **Split Brain** | Network partition; two nodes think they're leader | Quorum-based voting; fencing tokens |
| **Stale Leader** | GC pause or CPU starvation causes missed renewal | Fencing tokens; short renewals relative to TTL |
| **Thundering Herd** | All followers race for election simultaneously | Randomized election timeouts (Raft: 150–300ms jitter) |
| **Leader Thrashing** | Leader keeps crashing and re-electing | Circuit breaker on election frequency; back-off |
| **False Failover** | Network hiccup to coordinator misread as crash | Require N consecutive missed heartbeats before election |
| **Epoch Collisions** | Two nodes with same term/epoch | Monotonic term counter stored in durable storage |

---

## 9. Real-World Systems & Applications

### 9.1 Kubernetes — Controller Manager & Scheduler
- The `kube-controller-manager` and `kube-scheduler` run as multiple replicas for HA.
- Only one replica is **active** at a time; others are on standby.
- Uses Kubernetes `Lease` objects (stored in etcd) with `client-go`'s leader election library.
- LeaseDuration: 15s, RenewDeadline: 10s, RetryPeriod: 2s (defaults).

### 9.2 Apache Kafka — Partition Leadership
- Each partition has exactly one **leader broker** that handles all reads and writes.
- Followers replicate from the leader and form the **ISR (In-Sync Replicas)** set.
- ZooKeeper (legacy) or KRaft (Kafka Raft, new) manages partition leader elections.
- Kafka Controller (itself elected via ZooKeeper/KRaft) assigns partition leaders.

### 9.3 Apache ZooKeeper — Self-Election (ZAB)
- ZooKeeper itself uses the **ZAB protocol** to elect a leader among its ensemble nodes.
- The leader handles all write requests; followers forward writes to the leader.
- Reads can be served by any follower (with possible staleness).

### 9.4 Elasticsearch — Master Node Election
- One node elected as **master** manages cluster state (index creation, shard allocation).
- Uses a quorum-based election (majority of master-eligible nodes).
- `minimum_master_nodes = (N/2) + 1` prevents split-brain.
- In v7+, uses a Raft-like protocol replacing the older zen discovery.

### 9.5 CockroachDB / etcd — Raft
- Every range (shard) in CockroachDB elects a **Raft leader** for that range's replicas.
- The leader serializes writes; followers apply committed log entries.
- etcd uses Raft natively for its own key-value store consensus.

### 9.6 Redis Sentinel — Leader for Failover Orchestration
- Redis Sentinel nodes elect a **Sentinel leader** when the primary Redis instance is down.
- The elected Sentinel leader initiates the promotion of a replica to primary.
- Uses a modified Raft-like election among Sentinels.

### 9.7 Google Chubby
- Google's distributed lock service (precursor to ZooKeeper).
- Provides coarse-grained distributed locking; widely used internally for leader election.
- Bigtable, GFS, and other Google systems use Chubby to elect primaries.

### 9.8 HDFS — NameNode HA
- HDFS HA runs two NameNodes: **Active** and **Standby**.
- ZooKeeper ZKFC (ZooKeeper Failover Controller) monitors health and triggers election.
- Fencing ensures the old Active NameNode cannot corrupt shared edit logs.

---

## 10. Design Checklist for System Design Interviews

```
□ Does only one node need to run this job/hold this resource?
  └── Yes → Leader Election needed

□ What is my election mechanism?
  └── Strong consistency needed → Raft / ZAB / etcd
  └── Operational simplicity → Lease-based (etcd SET, k8s Lease)

□ How do I handle stale leaders (GC pauses, network partition)?
  └── Fencing tokens in all write paths

□ What is my TTL strategy?
  └── TTL >> p99 renewal latency (3–5× renewal interval)
  └── Tune based on acceptable failover time

□ How do I prevent thundering herd on election?
  └── Randomized back-off / jitter on candidates

□ What happens if the leader crashes mid-task?
  └── Idempotent operations + checkpointing
  └── New leader resumes from last checkpoint

□ How do followers know the leader is alive?
  └── Heartbeat mechanism with configurable timeout

□ Is my quorum sized correctly?
  └── N/2 + 1 to tolerate (N-1)/2 failures
```

---

## 11. Key Metrics to Monitor

| Metric | Why It Matters |
|---|---|
| **Leader election count / rate** | High rate = instability (thrashing) |
| **Election duration** | Time from leader loss to new leader active |
| **Lease renewal latency** | p99 must be well below TTL |
| **Leader term/epoch** | Sudden jump = unexpected re-election |
| **Follower lag** | How far behind are followers? |
| **Split-brain events** | Should always be 0 |

---

## 12. Interview Cheat Sheet

| Question | Answer |
|---|---|
| Why not just use a load balancer for singleton work? | LBs distribute load; they don't prevent two workers running the same job simultaneously |
| What's split brain? | Two nodes both acting as leader simultaneously; caused by network partition + no quorum |
| How does Raft prevent two leaders? | Term numbers + quorum voting; only one node can get majority votes per term |
| Why is Redlock controversial? | Clock drift + no fencing tokens make it unsafe for strict mutual exclusion |
| How do you fence a stale leader? | Fencing tokens: storage layer rejects writes with an older token than the current term |
| What's the quorum formula? | `floor(N/2) + 1`; e.g., 3 nodes → quorum of 2; tolerate 1 failure |
| How does Kubernetes do leader election? | Lease object in etcd; `client-go` library with configurable LeaseDuration/RenewDeadline |
| What happens to in-flight work when a leader dies? | Design operations to be idempotent; new leader retries or resumes from checkpoint |