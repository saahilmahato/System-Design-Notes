# Techniques: Optimizing Latency & Throughput

## Overview

The techniques below are organized by **primary benefit**. Most techniques improve both metrics to some degree — the dominant effect is noted.

---

## 1. Caching

**Primary benefit: Latency ↓, Throughput ↑**

Store results of expensive operations so repeated requests are served from fast memory.

```plantuml
@startuml
skinparam backgroundColor #FAFAFA
skinparam ArrowColor #336699

actor Client

rectangle "Application Server" as App #EAF4FB
rectangle "Cache (Redis / Memcached)" as Cache #FFF9C4
database "Database" as DB #F3E5F5

Client -> App : Request
App -> Cache : Lookup key
alt Cache HIT
  Cache --> App : Return cached value (< 1 ms)
else Cache MISS
  App -> DB : Query
  DB --> App : Result
  App -> Cache : Store result (TTL)
  App --> Client : Response
end
@enduml
```

| Cache Type | Where | Latency Benefit | Use Case |
|---|---|---|---|
| **In-process** | Application memory | Sub-millisecond | Computed config, small lookup tables |
| **Distributed** | Redis, Memcached | 1–5 ms | Session data, hot DB rows |
| **CDN** | Edge nodes globally | 10–50 ms → < 1 ms | Static assets, HTML pages |
| **Browser** | Client | Network eliminated | CSS, JS, images |
| **Read-through** | Cache layer auto-fills | Transparent to app | ORM-level caching |

**Key cache metrics to monitor:**
- **Hit rate** (target > 90% for effectiveness)
- **Eviction rate** (high eviction → cache too small)
- **TTL vs. staleness** trade-off

---

## 2. Load Balancing

**Primary benefit: Throughput ↑, single-server Latency ↓**

Distribute incoming requests across multiple servers to prevent any one from becoming a bottleneck.

```plantuml
@startuml
skinparam backgroundColor #FAFAFA
skinparam ArrowColor #336699

actor "Client A" as CA
actor "Client B" as CB
actor "Client C" as CC

rectangle "Load Balancer" as LB #D6E8F7

rectangle "Server 1" as S1 #EAF4FB
rectangle "Server 2" as S2 #EAF4FB
rectangle "Server 3" as S3 #EAF4FB

CA --> LB
CB --> LB
CC --> LB

LB --> S1
LB --> S2
LB --> S3
@enduml
```

| Algorithm | Best For | Trade-off |
|---|---|---|
| **Round Robin** | Homogeneous servers | Ignores server load |
| **Least Connections** | Variable request cost | Slightly more overhead |
| **IP Hash** | Session affinity needed | Uneven distribution risk |
| **Weighted Round Robin** | Mixed-capacity servers | Requires manual tuning |
| **Random** | Simple, low overhead | No load awareness |

---

## 3. Asynchronous Processing & Message Queues

**Primary benefit: Throughput ↑↑, perceived Latency ↓ for producers**

Decouple producers and consumers. The producer gets an instant acknowledgment; work is done in the background.

```plantuml
@startuml
skinparam backgroundColor #FAFAFA
skinparam ArrowColor #336699

actor Client
rectangle "API Server" as API #EAF4FB
queue "Message Queue\n(Kafka / RabbitMQ / SQS)" as MQ #FFF9C4
rectangle "Worker 1" as W1 #D6E8F7
rectangle "Worker 2" as W2 #D6E8F7
rectangle "Worker 3" as W3 #D6E8F7

Client -> API : Submit job
API -> MQ : Enqueue (instant ack)
API --> Client : 202 Accepted

MQ --> W1 : Dequeue
MQ --> W2 : Dequeue
MQ --> W3 : Dequeue
@enduml
```

| Queue Property | Impact |
|---|---|
| Partitioning (Kafka topics/partitions) | Increases parallelism → ↑ throughput |
| Consumer groups | Multiple consumers → ↑ throughput |
| Back-pressure | Prevents consumers from being overwhelmed |
| Acknowledgment / retries | Durability at cost of slight latency |

**When to use async:**
- Email/notification sending
- Image/video processing
- Report generation
- Any work > 200 ms that doesn't need a synchronous result

---

## 4. Database Optimization

**Primary benefit: Latency ↓↓, Throughput ↑**

```plantuml
@startuml
skinparam backgroundColor #FAFAFA
skinparam ArrowColor #336699

rectangle "Database Optimization Strategies" as Root #D6E8F7

rectangle "Indexing" as I #EAF4FB
rectangle "Read Replicas" as RR #EAF4FB
rectangle "Sharding" as SH #EAF4FB
rectangle "Connection Pooling" as CP #EAF4FB
rectangle "Query Optimization" as QO #EAF4FB
rectangle "Denormalization" as DN #EAF4FB

Root --> I
Root --> RR
Root --> SH
Root --> CP
Root --> QO
Root --> DN
@enduml
```

| Technique | Latency Impact | Throughput Impact | Notes |
|---|---|---|---|
| **Indexing** | ↓↓ (O(log n) vs O(n) scans) | ↑ (fewer full scans) | Write overhead increases |
| **Read replicas** | ↑ slightly (replication lag) | ↑↑ (distribute reads) | Eventual consistency |
| **Connection pooling** | ↓ (no reconnect cost) | ↑ (reuse sockets) | PgBouncer, HikariCP |
| **Query optimization** | ↓ (explain analyze) | ↑ | Avoid N+1 queries |
| **Horizontal sharding** | ↑ slightly (routing) | ↑↑ | Operational complexity |
| **Denormalization** | ↓ (fewer JOINs) | ↑ | Consistency trade-off |
| **In-memory DB (Redis)** | ↓↓↓ | ↑↑ | Not for primary store |

---

## 5. Content Delivery Networks (CDN)

**Primary benefit: Latency ↓↓ for geographically distributed users**

Move static (and increasingly dynamic) content to edge nodes close to the user.

```plantuml
@startuml
skinparam backgroundColor #FAFAFA
skinparam ArrowColor #336699

cloud "Origin Server\n(US East)" as Origin #EAF4FB

rectangle "CDN Edge\n(Europe)" as EU #D6E8F7
rectangle "CDN Edge\n(Asia)" as AS #D6E8F7
rectangle "CDN Edge\n(US West)" as USW #D6E8F7

actor "EU User" as EUU
actor "Asia User" as ASU
actor "US West User" as USWU

Origin --> EU : Cache fill
Origin --> AS : Cache fill
Origin --> USW : Cache fill

EUU --> EU : < 10 ms (local)
ASU --> AS : < 10 ms (local)
USWU --> USW : < 10 ms (local)
@enduml
```

| CDN Use Case | Latency Reduction |
|---|---|
| Static assets (JS, CSS, images) | 100–200 ms → < 5 ms |
| Video streaming | Eliminates buffering |
| API responses (cacheable) | Significant for read-heavy global APIs |
| TLS termination at edge | Removes TLS RTTs from origin path |

---

## 6. Concurrency & Parallelism

**Primary benefit: Throughput ↑↑**

| Model | Description | Best For |
|---|---|---|
| **Multi-threading** | Multiple threads share memory | CPU-bound tasks |
| **Multi-processing** | Separate processes, isolated memory | CPU-bound, avoids GIL (Python) |
| **Async / Event loop** | Single-threaded, non-blocking I/O | I/O-bound tasks (Node.js, Python asyncio) |
| **Actor model** | Message-passing between isolated actors | Distributed systems (Erlang/Akka) |
| **Data parallelism** | Same operation on partitioned data | Batch processing, MapReduce |

```plantuml
@startuml
skinparam backgroundColor #FAFAFA

rectangle "I/O-bound workload" as IO #FFF9C4 {
  rectangle "Use: Async / non-blocking" as IO1
  note right of IO1
    Waiting on network/disk
    does not block other requests
  end note
}

rectangle "CPU-bound workload" as CPU #EAF4FB {
  rectangle "Use: Multi-process / worker pool" as CPU1
  note right of CPU1
    Distribute computation
    across cores
  end note
}
@enduml
```

---

## 7. Protocol & Serialization Optimization

**Primary benefit: Latency ↓, Throughput ↑ (less data over wire)**

| Protocol / Format | Relative Size | Latency | Use Case |
|---|---|---|---|
| JSON (text) | 1× (baseline) | Baseline | Human-readable APIs |
| MessagePack | ~0.5× | ↓ | Binary JSON replacement |
| Protocol Buffers | ~0.3× | ↓↓ | Internal microservices |
| FlatBuffers | ~0.3× | ↓↓↓ (zero-copy) | Real-time, gaming |
| HTTP/1.1 | — | Baseline | Standard web |
| HTTP/2 | — | ↓ (multiplexing) | Concurrent streams, gRPC |
| HTTP/3 / QUIC | — | ↓↓ (0-RTT, no HOL blocking) | Mobile, lossy networks |
| WebSocket | — | ↓↓ (persistent) | Real-time bidirectional |
| gRPC | Binary (protobuf) | ↓↓ | Microservice-to-service |

---

## 8. Batching & Micro-batching

**Primary benefit: Throughput ↑↑ (amortizes per-request overhead)**

Group multiple operations into a single system call or network round-trip.

| Example | Overhead Reduced | Latency Cost |
|---|---|---|
| Bulk DB inserts | Per-row commit overhead | Slight delay until batch fills |
| Kafka producer batching | Per-message TCP overhead | Configurable `linger.ms` |
| HTTP request batching (GraphQL) | Round-trips | 1 RTT vs N RTTs |
| GPU mini-batches | Kernel launch overhead | Throughput >> single-sample |

---

## 9. Prefetching & Speculative Execution

**Primary benefit: Perceived Latency ↓ (start work before it's needed)**

| Technique | Description |
|---|---|
| **Read-ahead / prefetch** | Load next pages/records before user requests them |
| **Speculative execution** | Execute multiple branches in parallel, discard losers |
| **Connection warm-up** | Pre-establish DB/service connections at startup |
| **Predictive caching** | Cache based on access patterns (e.g., ML-driven prefetch) |

---

## Techniques Summary Table

| Technique | Latency ↓ | Throughput ↑ | Complexity Added |
|---|---|---|---|
| Caching | ✅✅ | ✅ | Medium |
| Load balancing | ✅ | ✅✅ | Low–Medium |
| Async / message queues | ✅ (perceived) | ✅✅ | Medium |
| DB indexing | ✅✅ | ✅ | Low |
| Read replicas | ➖ | ✅✅ | Medium |
| CDN | ✅✅ | ✅ | Low |
| HTTP/2 or gRPC | ✅ | ✅ | Low–Medium |
| Binary serialization | ✅ | ✅ | Medium |
| Connection pooling | ✅ | ✅ | Low |
| Horizontal sharding | ➖ | ✅✅ | High |
| Batching | ❌ (increases) | ✅✅ | Low |
| Prefetching | ✅ | ➖ | Medium |
| Async non-blocking I/O | ✅ | ✅✅ | Medium |

---

## Decision Guide: Which Technique to Apply?

```plantuml
@startuml
skinparam backgroundColor #FAFAFA
skinparam ArrowColor #336699

start

:Identify bottleneck with profiling;

if (Bottleneck is I/O?) then (yes)
  :Use async I/O + connection pooling;
  if (Data is repeated?) then (yes)
    :Add caching layer;
  endif
else (no, CPU-bound)
  if (Can parallelize?) then (yes)
    :Multi-process / worker pool;
  else (no, serial)
    :Optimize algorithm (O-complexity);
    :Consider hardware upgrade;
  endif
endif

if (Global users?) then (yes)
  :Add CDN;
endif

if (High write volume?) then (yes)
  :Add message queue + async workers;
  :Consider batching writes;
endif

if (Read/write ratio > 5:1?) then (yes)
  :Add read replicas;
  :Consider denormalization;
endif

stop
@enduml
```
