# Introduction

---

## 1. What is System Design?

- The process of defining the **architecture, components, modules, interfaces, and data** of a system to satisfy specified functional and non-functional requirements.
- Two broad flavors:
  - **High-Level Design (HLD)** — overall architecture: services, databases, communication patterns, scaling strategy.
  - **Low-Level Design (LLD)** — class structures, design patterns, API contracts, database schema details.
- Not about memorizing architectures — it's about **trade-off reasoning**. Every decision (SQL vs NoSQL, sync vs async, monolith vs microservices) is a trade-off, not a universal answer.

---

## 2. Why It Matters

- Separates senior/staff engineers from mid-level: the ability to reason about **scale, failure, and ambiguity**.
- Interviews test whether you can navigate an **open-ended, underspecified problem** like real work — not whether you know one "correct" diagram.
- Real-world impact: bad system design → outages, unscalable costs, unmaintainable code, security holes.

---

## 3. Core Themes That Recur Everywhere

| Theme | Core Tension |
|---|---|
| Scalability | Vertical vs horizontal scaling |
| Availability vs Consistency | CAP theorem trade-offs |
| Latency vs Throughput | Fast per-request vs high total volume |
| Consistency models | Strong vs eventual consistency |
| Coupling | Monolith vs microservices vs modular monolith |
| State | Stateless vs stateful services |
| Storage | SQL vs NoSQL vs specialized stores |
| Communication | Sync (REST/gRPC) vs async (queues/streams) |
| Fault tolerance | Redundancy, retries, graceful degradation |
| Cost | Over-engineering vs under-engineering |

---

## 4. How to Approach a System Design Interview

A repeatable framework (roughly time-boxed for a 45–60 min interview):

1. **Clarify Requirements (5–10 min)**
   - Functional requirements: what must the system do? (core features only — say no to scope creep)
   - Non-functional requirements: scale (users, QPS, data size), latency targets, availability (SLA), consistency needs.
   - Identify read-heavy vs write-heavy.
2. **Estimate Scale (Back-of-envelope math)**
   - DAU/MAU → QPS (avg + peak)
   - Storage per day/year
   - Bandwidth estimates
3. **Define API / Interface Contracts**
   - Key endpoints or RPCs, request/response shape.
4. **High-Level Architecture**
   - Draw major components: client, load balancer, services, cache, DB, queue, CDN.
   - Explain data flow for 1–2 core use cases end-to-end.
5. **Deep Dive on 1–2 Critical Components**
   - Interviewer usually steers this — e.g., "how does your database handle this scale?"
   - This is where most signal is generated. Don't stay shallow here.
6. **Address Bottlenecks & Failure Modes**
   - Single points of failure, hot partitions, thundering herd, cascading failures.
   - Discuss monitoring, retries, circuit breakers.
7. **Trade-offs Summary**
   - Explicitly state what you optimized for and what you sacrificed.

**Common failure modes to avoid:**
- Jumping to solutions before clarifying requirements.
- Designing for "Google scale" when the problem didn't need it.
- Silence — always narrate your thinking.
- Ignoring non-functional requirements (they usually drive the interesting decisions).

---

## 5. How to Approach a Real-World Design Problem

Differs from interviews in a few important ways:

| Aspect | Interview | Real World |
|---|---|---|
| Time | 45–60 min | Days to weeks |
| Requirements | Given upfront | Must be discovered (PM, stakeholders, users) |
| Constraints | Hypothetical scale | Real budget, team size, existing infra |
| Iteration | One-shot | Design docs, RFCs, reviews, revisions |
| Validation | Verbal reasoning | Prototypes, load tests, metrics |

Practical steps:
- Write a **design doc / RFC**: problem statement, goals, non-goals, proposed design, alternatives considered, rollout plan.
- Involve stakeholders early; get design reviewed before writing code.
- Prefer **boring, proven technology** unless there's a strong reason not to.
- Build incrementally — ship an MVP, measure, iterate. Avoid big-bang rewrites.
- Plan for **observability** (logs, metrics, traces) and **rollback** from day one.

---

> **Note:** Section below uses technical jargon more freely (consensus algorithms, replication internals, probabilistic data structures, etc.). If you're a beginner and some of it doesn't fully click yet, that's expected — don't get stuck here. These are reference/preview sections meant to be revisited as you go deeper into individual topics later in the series. Skim now, absorb later.

---

## 6. Key Vocabulary

| Term | One-liner |
|---|---|
| Latency | Time for a single request to complete |
| Throughput | Number of requests handled per unit time |
| Availability | % of time system is operational (e.g., 99.99%) |
| Consistency | All nodes/readers see the same data at the same time |
| Partition Tolerance | System keeps working despite network splits |
| CAP Theorem | Pick 2 of Consistency, Availability, Partition tolerance during a network partition |
| PACELC | Extension of CAP: even without partition, trade Latency vs Consistency |
| Idempotency | Repeating an operation has the same effect as doing it once |
| Sharding | Splitting data horizontally across nodes |
| Replication | Copying data across nodes for redundancy/availability |
| Load Balancing | Distributing traffic across multiple servers |
| Caching | Storing frequently accessed data closer to compute for speed |
| CDN | Geographically distributed cache for static/edge content |
| Rate Limiting | Controlling request volume to protect a system |
| Backpressure | Signaling upstream to slow down when downstream is overwhelmed |
| Eventual Consistency | Data converges to consistent state given enough time |
| SLA / SLO / SLI | Agreement / Objective / Indicator — how service quality is contracted & measured |
| Fan-out | One event triggering many downstream writes/notifications |
| Hot Partition/Key | Uneven load causing one shard/key to bottleneck |
| Thundering Herd | Many clients hitting a resource simultaneously after it becomes available |
| Circuit Breaker | Pattern to stop calling a failing dependency temporarily |
| Bulkhead | Isolating resources per dependency so one failure doesn't sink the whole ship |
| Backoff (Exponential/Jitter) | Progressively delaying retries to avoid overwhelming a recovering system |
| Graceful Degradation | Serving reduced/partial functionality instead of total failure |
| Failover | Automatically switching to a standby system when the primary fails |
| Horizontal vs Vertical Scaling | Adding more machines vs adding more power to one machine |
| Statelessness | A service instance holds no session/data specific to a client between requests |
| Multitenancy | Single system instance serving multiple isolated customers/tenants |
| Data Locality | Placing computation close to where data resides to reduce network cost |
| Read Replica | A copy of a database used only for read traffic, offloading the primary |
| Write-Behind / Write-Through Cache | Caching strategies differing in when data is persisted to the source of truth |
| Cache Stampede | Many requests recomputing the same expired cache key simultaneously |
| Long Polling / Webhooks / WebSockets | Patterns for near-real-time client-server communication |
| Message Broker | Middleware that routes messages between producers and consumers (Kafka, RabbitMQ) |
| Dead Letter Queue (DLQ) | Holding area for messages that repeatedly fail processing |
| At-Least-Once / At-Most-Once / Exactly-Once | Delivery guarantees for messaging systems |
| Strong vs Weak Consistency | Whether reads always reflect the latest write, or may lag |
| Linearizability | Strongest consistency model — operations appear instantaneous and globally ordered |
| Data Skew | Uneven distribution of data/load across partitions |
| Service Discovery | Mechanism for services to find each other's network locations dynamically |
| API Gateway | Single entry point that routes, authenticates, and rate-limits client requests |
| Service Mesh | Infrastructure layer managing service-to-service communication (e.g., Istio) |
| Blue-Green Deployment | Running two environments to enable zero-downtime releases |
| Canary Release | Rolling out a change to a small subset of traffic before full rollout |
| Multi-Region / Multi-AZ | Deploying across geographic regions/availability zones for resilience |
| Vertical Partitioning | Splitting a table/schema by columns/features rather than by rows |
| Horizontal Partitioning | Splitting data into row-based chunks (a.k.a. sharding) |
| Denormalization | Duplicating data to optimize read performance at the cost of write complexity/consistency |
| N+1 Query Problem | Performance anti-pattern from executing a query per row instead of batching |

---

## 7. Algorithms & CS Fundamentals Worth Knowing

These aren't "system design" per se but are frequently load-bearing in design discussions. Grouped by purpose:

**Hashing & Data Distribution**
- **Consistent Hashing** — minimal data movement when nodes are added/removed (used in sharding, caches, CDNs)
- **Rendezvous Hashing (HRW)** — alternative to consistent hashing, simpler ring-free node selection
- **Chord Protocol** — DHT (Distributed Hash Table) lookup algorithm for peer-to-peer systems

**Rate Limiting**
- **Token Bucket** — allows bursts up to bucket size, refills at fixed rate
- **Leaky Bucket** — smooths bursts into a fixed output rate
- **Fixed/Sliding Window Counter** — simple time-window based request counting
- **Sliding Window Log** — precise but memory-heavier request tracking

**Probabilistic Data Structures**
- **Bloom Filter** — probabilistic membership testing (avoid unnecessary lookups/disk reads)
- **Count-Min Sketch** — approximate frequency counting of events/items
- **HyperLogLog** — approximate cardinality (unique count) estimation at scale
- **Cuckoo Filter** — like Bloom filter but supports deletion

**Consensus & Coordination**
- **Paxos** — foundational distributed consensus algorithm
- **Raft** — more understandable consensus algorithm (leader election + log replication)
- **ZAB (ZooKeeper Atomic Broadcast)** — consensus protocol behind ZooKeeper
- **Bully Algorithm** — simple leader election among nodes
- **Two-Phase Commit (2PC)** — blocking distributed transaction protocol
- **Three-Phase Commit (3PC)** — non-blocking improvement over 2PC
- **Saga Pattern** — long-running distributed transactions via compensating actions

**Replication & Consistency**
- **Quorum Reads/Writes (R + W > N)** — tunable consistency in distributed stores
- **Vector Clocks** — event ordering without a global clock; detects concurrent writes
- **Lamport Timestamps** — simpler logical clock for partial event ordering
- **Merkle Trees** — efficient way to detect data differences between replicas (Git, DynamoDB, Cassandra)
- **Gossip Protocol** — decentralized, epidemic-style state propagation across nodes
- **Anti-Entropy & Read-Repair** — background processes that reconcile replica divergence
- **Hinted Handoff** — temporary write buffering when target replica is down
- **CRDTs (Conflict-free Replicated Data Types)** — data structures that merge automatically without conflict

**Caching & Eviction**
- **LRU (Least Recently Used)**
- **LFU (Least Frequently Used)**
- **ARC (Adaptive Replacement Cache)** — hybrid of LRU + LFU used in production systems (e.g., ZFS)

**Storage Engine Fundamentals**
- **B-Trees / B+ Trees** — classic on-disk index structure (most relational DBs)
- **LSM Trees (Log-Structured Merge Trees)** — write-optimized structure (Cassandra, RocksDB, LevelDB)
- **Skip Lists** — probabilistic structure used for in-memory ordered data (Redis sorted sets)
- **Write-Ahead Log (WAL)** — durability mechanism before applying writes to main storage
- **MapReduce** — batch distributed computation model over large datasets

**Failure Detection**
- **Heartbeat Mechanism** — periodic liveness signals between nodes
- **Phi Accrual Failure Detector** — adaptive, probabilistic failure detection (used in Cassandra, Akka)

**Misc Fundamentals**
- **Tries** — prefix trees, used in autocomplete/search suggestion systems
- **Geohashing** — encoding geographic coordinates for proximity search
- **Erasure Coding (e.g., Reed-Solomon)** — space-efficient redundancy vs full replication (used in storage systems like HDFS, S3)

---

## 8. Interesting Topics / Rabbit Holes Worth Exploring Later

- Why Amazon's Dynamo paper (2007) shaped an entire generation of NoSQL databases (Cassandra, Riak, DynamoDB itself).
- How Google's Spanner achieves "external consistency" globally using atomic clocks and GPS (TrueTime).
- The difference between **horizontal scaling of stateless vs stateful services** and why stateful is fundamentally harder.
- Why **exactly-once delivery** is largely a myth in distributed messaging — and how idempotency fakes it.
- The trade-offs Kafka made (log-based, pull-based storage) vs traditional queues (RabbitMQ, push-based).
- How CDNs and edge computing blur the line between "client" and "server."
- Why Facebook's TAO and similar systems built custom caching graphs instead of using generic databases directly.
- The "split-brain" problem in distributed systems — what happens when a cluster partitions and both sides think they're the leader.
- How Git's object model is essentially a Merkle DAG, and why that idea reappears in blockchains and distributed databases.
- Why relational databases are coming back into vogue for many workloads (e.g., "NewSQL" like Spanner, CockroachDB, Vitess) after the 2010s NoSQL wave.
- The story behind Netflix's Chaos Monkey and the birth of chaos engineering as a discipline.
- Why leap seconds and clock drift are a genuinely hard, underappreciated problem in distributed systems.
- How rate limiting at the edge (CDN/API gateway) differs architecturally from rate limiting inside a service mesh.
- The CAP theorem's real-world nuance — most systems don't cleanly pick "C" or "A"; they tune it per-operation (see PACELC).
- Why WhatsApp famously ran on very few engineers/servers per user — lessons in Erlang/OTP and lightweight process models.
- How search engines' inverted indices relate conceptually to Bloom filters and hash-based lookups.
- The idea of "eventual consistency" in DNS — the entire internet already runs on a distributed, eventually-consistent system every day.

---