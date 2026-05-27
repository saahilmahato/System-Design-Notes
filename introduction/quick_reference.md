# System Design — Quick Reference for Core Concepts

> Use this as a cheat sheet during design sessions or interview prep.

---

## 1. Scaling

| | Vertical (Scale Up) | Horizontal (Scale Out) |
|---|---|---|
| **Mechanism** | Add CPU/RAM to existing node | Add more nodes |
| **Limit** | Hardware ceiling | Near-infinite |
| **Downtime** | Often | Rarely |
| **Cost at scale** | Very high | Moderate |
| **When to use** | Early stage, simple systems | Production, distributed systems |

**Stateless services** scale horizontally easily. **Stateful services** require session affinity or shared state (Redis).

---

## 2. CAP Theorem

> Pick **2 of 3** in any distributed system. In practice, **P is mandatory** — so you choose between C and A.

| Combo | Systems | Trade-off |
|---|---|---|
| **CP** | HBase, MongoDB, ZooKeeper | May reject requests to stay consistent |
| **AP** | Cassandra, DynamoDB, CouchDB | May return stale data |
| **CA** | Traditional RDBMS (single-node) | Can't tolerate partitions |

**PACELC Extension:** Even without partitions, there's a **latency vs. consistency** trade-off.

---

## 3. Consistency Models

| Model | Behavior | Example |
|---|---|---|
| **Strong** | All reads see the latest write | RDBMS transactions |
| **Eventual** | All replicas converge *eventually* | DNS, S3, Cassandra |
| **Read-your-writes** | You always see your own writes | User profile updates |
| **Monotonic read** | Won't read older data than previously read | Session guarantees |
| **Causal** | Causally related ops stay ordered | Collaborative editing |

---

## 4. Availability Patterns

### Active-Passive Failover
- Primary handles traffic; secondary is on standby
- On failure: standby is promoted (seconds to minutes of downtime)

### Active-Active
- Both nodes handle traffic simultaneously
- Load balanced; automatic failover; no downtime

| | Active-Passive | Active-Active |
|---|---|---|
| **Complexity** | Low | Higher |
| **Downtime on failure** | Some | Near zero |
| **Resource utilization** | 50% | 100% |

### Availability SLA

| Nines | Downtime/Year | Downtime/Month |
|---|---|---|
| 99% (2 nines) | ~87.6 hrs | ~7.3 hrs |
| 99.9% (3 nines) | ~8.76 hrs | ~43.8 min |
| 99.99% (4 nines) | ~52.6 min | ~4.4 min |
| 99.999% (5 nines) | ~5.26 min | ~26 sec |

---

## 5. Load Balancing

| Type | How | Use Case |
|---|---|---|
| **Round Robin** | Rotate requests across servers | Uniform servers, stateless |
| **Least Connections** | Route to server with fewest active connections | Variable request duration |
| **IP Hash** | Hash client IP → same server | Session stickiness |
| **Weighted** | Servers get proportional traffic | Heterogeneous servers |

| Layer | Protocol | Insight |
|---|---|---|
| **Layer 4 (Transport)** | TCP/UDP | Fast; no content inspection |
| **Layer 7 (Application)** | HTTP/HTTPS | Smarter routing; URL/header-aware |

---

## 6. Caching

### Where to Cache

| Layer | Example | TTL Typical |
|---|---|---|
| Client (browser) | HTTP Cache-Control | Minutes–Days |
| CDN | CloudFront, Fastly | Minutes–Hours |
| App-level | Redis, Memcached | Seconds–Minutes |
| DB query cache | MySQL Query Cache | Seconds |

### Cache Eviction Policies

| Policy | Description | Best For |
|---|---|---|
| **LRU** | Evict least recently used | General-purpose |
| **LFU** | Evict least frequently used | Repeated access patterns |
| **FIFO** | Evict oldest entry | Streaming data |
| **TTL** | Expire after fixed time | Freshness-sensitive data |

### Cache Write Strategies

| Strategy | Write Flow | Trade-off |
|---|---|---|
| **Cache-aside (Lazy)** | App writes DB, invalidates cache | Simple; stale reads possible |
| **Write-through** | Write to cache + DB simultaneously | Always consistent; slower writes |
| **Write-behind (Async)** | Write cache; flush to DB async | Fast writes; risk of data loss |
| **Refresh-ahead** | Pre-warm cache before expiry | Low latency; may cache unused data |

---

## 7. Databases

### SQL vs NoSQL

| | SQL (RDBMS) | NoSQL |
|---|---|---|
| **Schema** | Fixed, structured | Flexible |
| **Transactions** | ACID | BASE (typically) |
| **Scaling** | Vertical (mostly) | Horizontal |
| **Joins** | Native | Application-level |
| **Best for** | Complex queries, relations | High throughput, flexible schema |

### NoSQL Types

| Type | Examples | Best For |
|---|---|---|
| **Key-Value** | Redis, DynamoDB, Memcached | Sessions, caching, leaderboards |
| **Wide-Column** | Cassandra, HBase | Time-series, event logs |
| **Document** | MongoDB, CouchDB | User profiles, catalogs |
| **Graph** | Neo4j, Amazon Neptune | Social graphs, recommendations |

### SQL Scaling Patterns

| Pattern | Description | Use Case |
|---|---|---|
| **Master-Slave** | One write master; multiple read replicas | Read-heavy workloads |
| **Master-Master** | Multiple write nodes | Multi-region writes |
| **Federation** | Split DB by function (users DB, orders DB) | Domain separation |
| **Sharding** | Split DB by data range/hash | Massive horizontal scale |
| **Denormalization** | Add redundant data to avoid joins | Read performance |

---

## 8. Asynchronism & Message Queues

| Component | Purpose | Examples |
|---|---|---|
| **Message Queue** | Fire-and-forget job dispatch | Kafka, SQS, RabbitMQ |
| **Task Queue** | Execute deferred or periodic tasks | Celery, Sidekiq, BullMQ |
| **Back Pressure** | Slow producer when consumer is overwhelmed | TCP flow control, queue limits |

---

## 9. Networking & Communication

| Protocol | Layer | Characteristics | Use Case |
|---|---|---|---|
| **TCP** | Transport | Reliable, ordered, connection-based | Most application traffic |
| **UDP** | Transport | Fast, unreliable, connectionless | Video streaming, gaming, DNS |
| **HTTP/REST** | Application | Stateless, text-based, widely supported | APIs, web |
| **gRPC** | Application | Binary (protobuf), multiplexed, typed | Microservice-to-microservice |
| **WebSocket** | Application | Persistent bidirectional connection | Chat, live updates |
| **GraphQL** | Application | Query what you need | Flexible client queries |

---

## 10. CDN

| Strategy | How | Best For |
|---|---|---|
| **Pull CDN** | CDN fetches from origin on first request, caches | Large sites; low origin load |
| **Push CDN** | You proactively upload assets to CDN | Small sites; predictable content |

---

## 11. Key Numbers Every Engineer Should Know

| Operation | Approximate Latency |
|---|---|
| L1 cache reference | 0.5 ns |
| L2 cache reference | 7 ns |
| RAM read | 100 ns |
| SSD random read | 150 µs |
| HDD seek | 10 ms |
| Same datacenter round trip | 0.5 ms |
| Cross-region round trip | 150 ms |

| Metric | Rule of Thumb |
|---|---|
| Read throughput (SSD) | ~500 MB/s |
| Network bandwidth (1 GbE) | ~100 MB/s |
| MySQL QPS (simple queries) | ~10K–50K/s |
| Redis QPS | ~100K–1M/s |
| Kafka throughput | ~1M msgs/s |

---

## 12. Architecture Patterns Summary

| Pattern | Problem It Solves | Trade-off |
|---|---|---|
| **RLBS** | Single point of failure, traffic spikes | Requires stateless services |
| **CQRS** | Mixed read/write performance needs | Eventual consistency between models |
| **Saga** | Distributed transactions without 2PC | Complex rollback logic |
| **2PC** | Strong consistency across services | Blocking; coordinator SPOF |
| **Event Sourcing** | Audit trail; replayable state | Storage overhead; query complexity |
| **Circuit Breaker** | Cascade failures in microservices | False positives; open circuit lag |
| **Sidecar** | Cross-cutting concerns (logging, auth) | Extra infra per service |

---

## 13. Estimation Quick Formulas

```
QPS = Daily Active Users × Requests/User/Day ÷ 86,400

Storage/Year = Write QPS × Payload Size × 86,400 × 365

Cache Memory = Read QPS × Avg Object Size × Cache TTL

Bandwidth = QPS × Avg Response Size
```

**Powers of 2 reference:**

| Power | Value | Human |
|---|---|---|
| 2^10 | 1,024 | ~1 KB |
| 2^20 | 1,048,576 | ~1 MB |
| 2^30 | ~1 billion | ~1 GB |
| 2^40 | ~1 trillion | ~1 TB |

---

> **Golden Rule:** Never optimize prematurely. Start simple, measure, then scale what actually bottlenecks.