# How to Approach a System Design Problem (or Interview)

> This is the framework that works for most interviews. Follow the 6-step structure. Time-box each phase. Communicate trade-offs explicitly.

---

## The 6-Step Framework

```
# D2 Diagram: Design Process
step1: "① Feature Expectations\n[5 min]" {shape: rectangle}
step2: "② Estimations\n[5 min]" {shape: rectangle}
step3: "③ Design Goals\n[5 min]" {shape: rectangle}
step4: "④ High Level Design\n[5–10 min]" {shape: rectangle}
step5: "⑤ Deep Dive\n[15–20 min]" {shape: rectangle}
step6: "⑥ Justify\n[5 min]" {shape: rectangle}

step1 -> step2 -> step3 -> step4 -> step5 -> step6
```

---

## Step 1 — Feature Expectations `[5 min]`

> **Goal:** Understand the problem space before writing a single diagram. Wrong assumptions here cascade into a broken design.

**Ask these questions:**

| Question | Why It Matters |
|---|---|
| What are the core **use cases**? | Determines what you actually need to build |
| What is **out of scope**? | Prevents over-engineering |
| **Who** uses the system? | End-user vs internal service → different SLAs |
| **How many** users? | Drives scale decisions |
| What are the **usage patterns**? | Bursty vs steady → affects queue/cache strategy |

**Example (Design Twitter):**
- ✅ In scope: Post tweets, follow users, view timeline
- ❌ Out of scope: Ads, video transcoding, ML-based recommendations
- Users: 300M DAU; read-heavy (10:1 read/write ratio)
- Patterns: Bursty during events (World Cup, elections)

---

## Step 2 — Estimations `[5 min]`

> **Goal:** Quantify the scale. This directly informs which technologies and patterns you choose.

### Throughput
```
Read QPS  = DAU × avg reads/day ÷ 86,400
Write QPS = DAU × avg writes/day ÷ 86,400
```

### Storage
```
Daily storage = Write QPS × avg payload size × 86,400
Annual storage = Daily storage × 365
```

### Memory (Cache sizing)
```
Cache size = Read QPS × avg object size × TTL (seconds)
             or: cache top 20% of daily read volume (80/20 rule)
```

### Estimation Template

| Metric | Formula | Example (Twitter) |
|---|---|---|
| **Write QPS** | 300M × 1 tweet/day ÷ 86,400 | ~3,500 QPS |
| **Read QPS** | Write × 10 (read-heavy) | ~35,000 QPS |
| **Storage/day** | 3,500 × 300 bytes | ~1 GB/day |
| **Storage/5yr** | 1 GB × 365 × 5 | ~1.8 TB |
| **Cache RAM** | Top 20% of 35K QPS × 300B × 60s | ~120 GB |
| **Bandwidth (out)** | 35K QPS × 300 bytes | ~10 MB/s |

> **Don't aim for precision — aim for the right order of magnitude.** Off by 2× is fine; off by 1000× is not.

---

## Step 3 — Design Goals `[5 min]`

> **Goal:** Establish the non-functional requirements. These are your design constraints.

### Latency vs Throughput

- **Latency** — How fast does a single request respond? (p99 < 100ms?)
- **Throughput** — How many requests can the system handle per second?
- They often trade off: optimizing for throughput can hurt latency (batching), and vice versa.

### Consistency vs Availability

Use CAP theorem to anchor your choice:

| Scenario | Choose |
|---|---|
| Bank transactions, inventory | **Consistency** (CP) |
| Social feed, shopping recommendations | **Availability** (AP, eventual consistency) |
| User profile reads | **Read-your-writes consistency** |
| Multi-region active-active | **Eventual consistency + conflict resolution** |

### Design Goals Checklist

```
□ Read latency target (e.g., p99 < 50ms)
□ Write latency target (e.g., p99 < 200ms)
□ Availability target (e.g., 99.99%)
□ Consistency model (strong / eventual / causal)
□ Durability requirements (e.g., no data loss on single node failure)
□ Read/write ratio
□ Expected growth (1yr, 5yr projections)
```

---

## Step 4 — High Level Design `[5–10 min]`

> **Goal:** Draw the skeleton. Cover the critical read and write paths end-to-end.

### What to Cover

- **APIs** — Define the key endpoints (REST or RPC signatures)
- **Database schema** — Core entities and their relationships
- **Basic algorithm** — e.g., how feed generation works conceptually
- **End-to-end flow** — Draw boxes and arrows for read + write paths

### API Design Checklist

```
□ Use nouns for resources: /users/{id}/tweets
□ Use HTTP verbs correctly: GET (read), POST (create), PUT (replace), PATCH (update), DELETE
□ Paginate list responses: cursor-based > offset-based at scale
□ Version your APIs: /v1/...
□ Return meaningful HTTP status codes
```

---

## Step 5 — Deep Dive `[15–20 min]`

> **Goal:** Pick 2–3 critical components and go deep. Show you understand trade-offs and can reason about failure modes.

### Component Decision Matrix

Use this to evaluate each major component:

#### a) DNS
- Use **GeoDNS** for latency-based routing to nearest data center
- TTL tuning: lower TTL = faster failover, higher DNS query load

#### b) CDN
| | Push CDN | Pull CDN |
|---|---|---|
| **Who uploads** | You push content proactively | CDN fetches on first miss |
| **Best for** | Predictable, small content set | Large, dynamic sites |
| **Stale risk** | Low (you control) | TTL-based |

#### c) Load Balancers

| Type | Protocol | Features |
|---|---|---|
| **Layer 4** | TCP/UDP | Fast, no content inspection |
| **Layer 7** | HTTP/HTTPS | URL routing, A/B testing, SSL termination |
| **Active-Passive** | — | Failover, no wasted capacity |
| **Active-Active** | — | Full utilization, no failover lag |

#### d) Application Layer Scaling

- **Stateless services** → horizontal scaling behind LB
- **Service discovery** → Consul, Zookeeper, Kubernetes DNS
- **Microservices** → domain isolation, independent deployments
- **API Gateway** → auth, rate limiting, routing in one place

#### e) Database Selection Guide

Choose a database based on the primary access pattern and data model:

* **Relational (PostgreSQL, MySQL)**: Complex queries, joins, transactions, and strongly related data.
* **Key-Value (Redis, DynamoDB)**: Fast lookups by a unique key.
* **Wide-Column (Cassandra, HBase)**: High write throughput, time-series data, and large-scale distributed workloads.
* **Document (MongoDB)**: Flexible schema and nested or semi-structured data.
* **Graph (Neo4j)**: Relationship-heavy data requiring traversal across connected entities.


**Fast lookup reference:**

| Need | Tool |
|---|---|
| Bounded cache (fits in RAM) | Redis, Memcached |
| AP + unbounded storage | Cassandra, DynamoDB, Riak |
| CP + unbounded storage | HBase, MongoDB, Couchbase |

#### f) Caching Strategy

```
□ What to cache? (read-heavy, expensive to compute, rarely changes)
□ Cache-aside or write-through?
□ TTL? (balance freshness vs hit rate)
□ How to handle cache stampede? (mutex lock, probabilistic early expiration)
□ Cache eviction? (LRU for most cases)
```

#### g) Asynchronism

| Pattern | Use Case | Tools |
|---|---|---|
| **Message Queue** | Decouple services, async jobs | Kafka, SQS, RabbitMQ |
| **Task Queue** | Scheduled or deferred work | Celery, Sidekiq, BullMQ |
| **Back Pressure** | Prevent consumer overload | Queue depth limits, flow control |
| **Event Streaming** | Real-time processing pipelines | Kafka Streams, Flink |

#### h) Communication Protocols

| Protocol | Latency | Use Case |
|---|---|---|
| REST (HTTP/1.1) | Medium | External APIs |
| gRPC (HTTP/2) | Low | Internal microservices |
| WebSocket | Very low | Real-time bidirectional (chat, gaming) |
| SSE | Low | Server push (notifications, live feeds) |
| TCP | Lowest | Custom protocols, raw performance |
| UDP | Lowest (no guarantee) | Video, DNS, gaming |

### Failure Mode Analysis

For each critical component, ask:
```
□ What happens if this component fails?
□ Is there a single point of failure?
□ How does it degrade gracefully?
□ How does it recover? (restart, replay, re-elect)
□ What data is lost if it crashes mid-operation?
```

---

## Step 6 — Justify `[5 min]`

> **Goal:** Validate your design against the requirements you set in Steps 1–3. Close the loop.

### Justification Checklist

| Check | Question |
|---|---|
| **Throughput** | Can each layer handle the estimated QPS? |
| **Latency** | Is p99 latency within the target at each hop? |
| **Bottleneck** | What's the weakest link? Have you addressed it? |
| **Single points of failure** | Is every critical path redundant? |
| **Consistency guarantees** | Does your DB + cache choice match your consistency goal? |
| **Trade-offs acknowledged** | Did you call out what you sacrificed and why? |

### Latency Budget Example

For a read QPS = 35,000, p99 < 100ms target:

| Hop | Latency | Cumulative |
|---|---|---|
| Client → CDN (cache hit) | 5ms | 5ms ✅ |
| CDN → LB → API | 10ms | 15ms |
| API → Redis (cache hit) | 1ms | 16ms ✅ |
| API → Cassandra (cache miss) | 5ms | 21ms ✅ |
| API → Response serialization | 2ms | 23ms ✅ |

> Total: ~23ms for cache hit (well within 100ms). Cache miss path: ~60ms — still within budget.

---

## Common Mistakes to Avoid

| Mistake | Fix |
|---|---|
| Jumping to solution before clarifying requirements | Always spend 5 min on Step 1 |
| Designing everything at once | Draw the skeleton first, then deep dive |
| Ignoring failure modes | Always ask "what if X fails?" |
| Picking a DB without justification | State why (scale, consistency, query pattern) |
| Over-engineering for scale you don't have | Design for 10× current; note path to 100× |
| Forgetting back-of-envelope numbers | Do the math — it signals engineering maturity |
| Not acknowledging trade-offs | "I chose X over Y because..." always scores better |

---

## Interview Communication Tips

- **Think out loud.** Interviewers want to follow your reasoning, not just the output.
- **State assumptions explicitly.** "I'm assuming read-heavy, 10:1 ratio."
- **Use "I'd start with X, and scale to Y."** Shows pragmatic thinking.
- **Draw first, code never.** Diagrams > pseudocode in a system design interview.
- **Invite feedback.** "Does this approach match what you're looking for?"
- **Prioritize depth over breadth.** One well-justified deep dive > five shallow ones.

---

## Design Interview Cheat Sheet

```
1. Clarify [5 min]
   → Use cases, scale, constraints

2. Estimate [5 min]
   → QPS, storage, bandwidth, cache

3. Goals [5 min]
   → Latency target, consistency model, availability SLA

4. Sketch [5–10 min]
   → APIs, schema, high-level boxes-and-arrows

5. Deep Dive [15–20 min]
   → Pick 2-3 components: DB choice, caching, async, scaling

6. Validate [5 min]
   → Does the design meet the requirements?
   → What are the trade-offs?
   → What would you do differently with more time?
```

---

> **The best system designers are not the ones who know the most technologies — they're the ones who best understand trade-offs and can communicate decisions clearly.**