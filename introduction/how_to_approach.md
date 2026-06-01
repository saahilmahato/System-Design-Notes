# How to Approach

## The Right Mindset

System design interviews (and real-world design sessions) are **open-ended conversations**, not exams with a single correct answer. You are expected to **lead the discussion**, ask clarifying questions, and make defensible trade-off decisions.

The goal is not to arrive at a perfect answer — it's to demonstrate structured thinking, breadth of knowledge, and communication clarity.

---

## The 6-Step Framework

### Step 1 — Clarify Requirements & Feature Expectations `[~5 min]`

Never start designing before you understand the problem. Ask questions aggressively.

**Functional Requirements (what the system does):**
- What are the core use cases?
- What scenarios are explicitly *out of scope*?
- Who uses the system? (consumers, businesses, internal tools)

**Non-Functional Requirements (how the system behaves):**
- How many users? (current and projected)
- What are the read/write patterns? (read-heavy, write-heavy, mixed)
- What are the latency expectations? (real-time vs. eventual)
- What consistency model is acceptable? (strong, eventual, weak)
- What are the availability requirements? (99.9%, 99.99%?)

> **Key principle:** Requirements drive every design decision. A wrong assumption here cascades into a wrong architecture.

---

### Step 2 — Capacity Estimation `[~5 min]`

Back-of-the-envelope calculations establish the scale you're designing for. They prevent over-engineering and under-engineering.

**Throughput:**
| Metric | Questions to Answer |
|---|---|
| Read QPS | How many read requests per second? |
| Write QPS | How many write requests per second? |
| Read/Write ratio | 10:1? 100:1? |

**Storage:**
- How much data is written per request?
- How long is data retained?
- Total storage = write volume × retention period

**Memory (Cache):**
- What data is hot (frequently accessed)?
- How much RAM is needed to cache the working set?
- `Cache size = hot data % × total data size`

**Bandwidth:**
- Ingress: data coming in
- Egress: data going out (especially important for media-heavy systems)

**Useful constants to memorize:**

| Resource | Approximate Latency |
|---|---|
| L1 cache access | 0.5 ns |
| L2 cache access | 7 ns |
| RAM access | 100 ns |
| SSD random read | 150 µs |
| HDD seek | 10 ms |
| Network round trip (same DC) | 0.5 ms |
| Network round trip (cross-region) | 150 ms |

| Scale | Value |
|---|---|
| 1 KB | 10³ bytes |
| 1 MB | 10⁶ bytes |
| 1 GB | 10⁹ bytes |
| 1 TB | 10¹² bytes |
| 1 million req/day | ~12 req/sec |
| 1 billion req/day | ~12,000 req/sec |

---

### Step 3 — Define Design Goals `[~5 min]`

Explicitly state the design priorities before touching the architecture.

**Consistency vs. Availability (CAP Theorem):**
- Do all users need to see the same data at the same time? → Prioritize **Consistency**
- Can the system tolerate stale reads in exchange for higher uptime? → Prioritize **Availability**

**Latency vs. Throughput:**
- Low-latency systems (e.g., trading, gaming) optimize for response time
- High-throughput systems (e.g., analytics pipelines) optimize for volume

**Write your design goals explicitly, e.g.:**
> "This system is read-heavy (100:1 ratio), requires high availability (99.99%), can tolerate eventual consistency, and must handle P99 latency under 200ms."

---

### Step 4 — High-Level Design `[~5-10 min]`

Sketch the major components and their interactions. Don't go deep yet — establish the skeleton.

**Cover the following:**
- APIs for core read/write scenarios (REST endpoints or RPC interfaces)
- Database schema (rough — tables, key relationships, data types)
- Basic data flow (client → load balancer → service → DB)
- Identify the critical path (the sequence of operations that must work for the system to function)

**Design for the happy path first**, then layer in fault tolerance.

---

### Step 5 — Deep Dive `[~15-20 min]`

This is where you differentiate yourself. Pick the most critical or interesting components and go deep.

#### Scaling the Algorithm
- Can the core logic handle 10x traffic? 100x?
- Are there O(n²) operations that break at scale?

#### Component-Level Scaling

**DNS & CDN:**
- CDN for static assets — reduces origin load and latency
- Push CDN (proactive) vs. Pull CDN (on-demand) — push for predictable content, pull for dynamic

**Load Balancers:**
- Layer 4 (TCP/UDP) — fast, no content inspection
- Layer 7 (HTTP) — route by URL, headers, cookies; smarter but more overhead
- Active-Active vs. Active-Passive failover

**Reverse Proxy:**
- SSL termination, compression, rate limiting, caching at the edge

**Application Layer:**
- Microservices vs. Monolith trade-offs
- Service discovery (Consul, Eureka, Kubernetes DNS)

**Databases:**

| Type | Best For | Examples |
|---|---|---|
| RDBMS (SQL) | Relational data, ACID transactions | PostgreSQL, MySQL |
| Key-Value | Fast lookups, sessions, caching | Redis, DynamoDB |
| Wide-Column | Time-series, large-scale writes | Cassandra, HBase |
| Document | Semi-structured, flexible schema | MongoDB, CouchDB |
| Graph | Relationship-heavy data | Neo4j |

RDBMS scaling strategies: Master-slave replication → Master-master → Federation → Sharding → Denormalization

**Caching:**

| Strategy | Description | Use When |
|---|---|---|
| Cache-aside | App checks cache first, loads from DB on miss | General purpose |
| Write-through | Write to cache and DB simultaneously | Consistent reads needed |
| Write-behind | Write to cache, async flush to DB | High write throughput |
| Refresh-ahead | Proactively refresh before expiry | Predictable access patterns |

Cache levels: Client → CDN → Web server → Application → Database query → Object

Eviction policies: LRU (most common), LFU, FIFO, TTL-based

**Asynchronism:**
- Message queues (Kafka, RabbitMQ, SQS) — decouple producers from consumers
- Task queues (Celery, Sidekiq) — background job processing
- Back pressure — slow down producers when consumers can't keep up

**Communication Protocols:**

| Protocol | Characteristics | Use When |
|---|---|---|
| REST (HTTP) | Stateless, widely supported, human-readable | Public APIs, CRUD |
| gRPC (RPC) | Binary, strongly typed, streaming support | Internal microservices |
| WebSocket | Full-duplex, persistent connection | Real-time (chat, live data) |
| TCP | Reliable, ordered delivery | When data integrity matters |
| UDP | Fast, no guarantee of delivery | Video streaming, gaming |

---

### Step 6 — Justify & Summarize `[~5 min]`

Close the loop. Revisit your design and validate it against the original requirements.

- Does every layer meet the throughput requirements?
- What is the latency at each hop? Does the total satisfy the SLA?
- What are the single points of failure? How are they mitigated?
- What would you change if traffic grew 10x?
- What did you explicitly *not* design and why?

> This step demonstrates engineering maturity — knowing what you built, why you built it, and what its limits are.

---

## Common Mistakes to Avoid

- **Jumping into design without clarifying requirements** — always ask first
- **Designing for 1000x scale when 10x is needed** — over-engineering wastes time
- **Ignoring failure modes** — every component will fail; plan for it
- **No trade-off discussion** — "I chose X" is weaker than "I chose X over Y because..."
- **Designing in silence** — narrate your thinking; the interviewer evaluates your process
- **Forgetting the data model** — most systems live or die by their database design

---

## Quick Reference Checklist

```
[ ] Clarified functional and non-functional requirements
[ ] Estimated QPS, storage, memory, and bandwidth
[ ] Stated explicit design goals (consistency, availability, latency)
[ ] Sketched high-level architecture with major components
[ ] Defined APIs and database schema
[ ] Deep-dived on critical components
[ ] Addressed scaling, caching, and fault tolerance
[ ] Justified trade-offs and summarized design
```