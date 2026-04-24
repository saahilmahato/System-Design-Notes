# Latency vs. Throughput

## The Core Rule

> **Aim for maximal throughput with acceptable latency.**

These are two distinct, often competing metrics. Understanding their relationship is essential for making correct system design trade-offs.

---

## Side-by-Side Comparison

| Dimension | Latency | Throughput |
|---|---|---|
| **Definition** | Time per single operation | Operations per unit of time |
| **Unit** | ms, µs, ns, clock cycles | RPS, TPS, Mbps, words/cycle |
| **Question answered** | "How fast does one request complete?" | "How many requests can the system handle?" |
| **User impact** | Responsiveness / perceived speed | Capacity / scalability |
| **Optimization target** | Minimize | Maximize |
| **Analogy** | Travel time for one car | Lanes × cars per hour |

---

## They Are Not the Same Thing

A critical misconception: **low latency ≠ high throughput**, and vice versa.

```plantuml
@startuml
skinparam backgroundColor #FAFAFA

rectangle "Low Latency\nLow Throughput" as Q1 #FFE0B2
note right of Q1 : Single-threaded server\nthat responds fast\nbut handles few requests

rectangle "Low Latency\nHigh Throughput" as Q2 #C8E6C9
note right of Q2 : The ideal:\nfast responses +\nhigh concurrency

rectangle "High Latency\nLow Throughput" as Q3 #FFCDD2
note right of Q3 : Worst case:\nslow and can't scale

rectangle "High Latency\nHigh Throughput" as Q4 #FFF9C4
note right of Q4 : Batch systems:\nslow per-item but\nhigh aggregate volume
@enduml
```

| Quadrant | Latency | Throughput | Typical Scenario |
|---|---|---|---|
| **Ideal** | Low | High | Optimized web API with horizontal scaling |
| **Single-threaded fast** | Low | Low | Simple server, no concurrency |
| **Batch pipeline** | High | High | Kafka consumer, bulk ETL |
| **Broken system** | High | Low | Overloaded, misconfigured server |

---

## The Fundamental Trade-off

Improving throughput often **increases latency**, and reducing latency often **reduces throughput**. Here's why:

### Trade-off 1: Batching

```plantuml
@startuml
skinparam backgroundColor #FAFAFA

participant Producer
participant "Batch Buffer" as Buffer
participant Consumer

Producer -> Buffer : Request 1
Producer -> Buffer : Request 2
Producer -> Buffer : Request 3
note right of Buffer : Waiting to fill batch...
Buffer -> Consumer : Batch of 3 (higher throughput)
note right of Consumer : Each request waited longer\n→ higher latency per item
@enduml
```

| | No Batching | With Batching |
|---|---|---|
| Latency per item | Low | Higher (wait for batch to fill) |
| Throughput | Lower | Higher (amortized overhead) |

### Trade-off 2: Replication / Horizontal Scaling

Adding more servers increases throughput (more parallel handlers), but can increase latency due to:
- Request routing overhead
- Cross-server data replication (consistency protocols)
- Cache invalidation delays

### Trade-off 3: Caching

Caching frequently accessed data in memory:
- **Reduces latency** for cache hits
- **Reduces throughput headroom for other operations** (memory is finite — cache consumes RAM that could serve other concurrent requests)

---

## System Design Examples

### Example 1: Web Server

```plantuml
@startuml
skinparam backgroundColor #FAFAFA
skinparam ArrowColor #336699

actor Users
rectangle "Load Balancer" as LB #D6E8F7
rectangle "Server A" as SA #EAF4FB
rectangle "Server B" as SB #EAF4FB
rectangle "Cache (Redis)" as Cache #FFF9C4
database "Database" as DB #F3E5F5

Users --> LB
LB --> SA
LB --> SB
SA --> Cache : cache hit → low latency
SA --> DB : cache miss → higher latency
SB --> Cache
SB --> DB
@enduml
```

| Design Decision | Effect on Latency | Effect on Throughput |
|---|---|---|
| Add more servers | ↑ slightly (routing overhead) | ↑↑ (parallel handling) |
| Add caching layer | ↓↓ (cache hits) | ↑ (fewer DB calls) |
| Async processing | ↑ (deferred response) | ↑↑ (frees threads faster) |
| Connection pooling | ↓ (no reconnect cost) | ↑ (reuse connections) |

### Example 2: Database

```plantuml
@startuml
skinparam backgroundColor #FAFAFA

rectangle "Read-Heavy System" as RH #EAF4FB {
  database "Primary DB" as PDB
  database "Read Replica 1" as R1
  database "Read Replica 2" as R2
  rectangle "In-Memory Cache" as MC #FFF9C4
}

note bottom of MC
  Cache reduces latency for hot data
  but consumes memory that could
  serve more concurrent queries
end note

note bottom of R1
  Replicas increase read throughput
  but replication lag introduces
  eventual consistency latency
end note
@enduml
```

| Strategy | Latency Impact | Throughput Impact |
|---|---|---|
| Memory cache for hot data | ↓ significantly | ↑ (fewer disk reads) |
| Read replicas | slight ↑ (replication lag) | ↑↑ (distribute reads) |
| Write-ahead logging (WAL) | ↑ slightly | ↑ (durability without full sync) |
| Index on query columns | ↓↓ | ↑ (faster scans → fewer locks) |

---

## Amdahl's Law: The Ceiling on Throughput Gains

When adding parallelism to increase throughput:

```
Speedup(N) = 1 / (S + (1-S)/N)
```

| Symbol | Meaning |
|---|---|
| `N` | Number of parallel processors/workers |
| `S` | Fraction of work that must be serial |
| `1-S` | Fraction that can be parallelized |

**Implication:** If 20% of your system is serial, maximum speedup = 5×, no matter how many servers you add. Throughput has a ceiling defined by the **serial bottleneck** — and that bottleneck also dictates minimum achievable latency for that serial section.

---

## Design Decision Framework

When facing a latency vs. throughput trade-off, ask:

| Question | Implication |
|---|---|
| Is this user-facing? | Prioritize latency (< 100 ms is the human perception threshold) |
| Is this a background/batch job? | Prioritize throughput |
| Is the system read-heavy or write-heavy? | Read-heavy → caching/replicas; Write-heavy → queueing/batching |
| What is the SLA? | Define acceptable p99 latency first, then maximize throughput within that bound |
| Is the bottleneck I/O or CPU? | I/O → async/non-blocking; CPU → parallelism/sharding |

---

## The Golden Rule

> Measure both. Define your SLA in terms of **p99 latency** and **target RPS**. Then optimize throughput until latency SLA is at risk — and stop there.
