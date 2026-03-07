# System Design — Introduction

---

## 1. What is System Design?

System design is the process of defining the **architecture, components, modules, interfaces, and data flow** of a system to satisfy a set of specified requirements. It bridges the gap between a problem statement and a working, scalable, production-grade solution.

It answers questions like:
- How do we handle **10 million users** without the system crashing?
- Where does **data live**, and how is it accessed efficiently?
- What happens when a **server fails**?
- How do we keep the system **fast** as it grows?

---

## 2. Goals of System Design

| Goal | Description |
|---|---|
| **Scalability** | Handle increasing load without redesigning the system |
| **Reliability** | Operate correctly even when components fail |
| **Availability** | Be accessible and operational as much as possible |
| **Maintainability** | Allow easy updates, debugging, and extension |
| **Performance** | Respond quickly and process efficiently |
| **Security** | Protect data and prevent unauthorized access |
| **Cost Efficiency** | Achieve goals without unnecessary resource waste |

---

## 3. Types of System Design

### 3.1 High-Level Design (HLD)
Focuses on the **overall architecture** — major components and how they interact. This is the "bird's eye view."

- Defines services, databases, caches, message queues
- Describes communication patterns (sync vs. async)
- Often represented as block/architecture diagrams

### 3.2 Low-Level Design (LLD)
Focuses on the **internal design** of individual components — class structures, APIs, database schemas, algorithms.

- Class diagrams, ER diagrams
- API contracts and data models
- Algorithm choices within a service

---

## 4. Key Properties of Distributed Systems

### 4.1 Scalability
The ability of a system to handle a growing amount of work.

- **Vertical Scaling (Scale Up):** Add more resources (CPU, RAM) to a single machine.
- **Horizontal Scaling (Scale Out):** Add more machines to distribute the load.

### 4.2 Reliability vs. Availability
- **Reliability:** The system produces the correct result consistently (correctness over time).
- **Availability:** The system is up and responsive (uptime percentage).

> A system can be available but unreliable (returns wrong data), or reliable but unavailable (returns correct data only when it's up).

### 4.3 Consistency
All nodes in a distributed system see the same data at the same time.

- **Strong Consistency:** Every read reflects the most recent write.
- **Eventual Consistency:** Nodes converge to the same value over time; reads may be stale briefly.

### 4.4 Fault Tolerance
The ability to continue operating despite partial failures. Achieved via redundancy, replication, and failover mechanisms.

### 4.5 Latency vs. Throughput
- **Latency:** Time taken to process a single request (ms).
- **Throughput:** Number of requests processed per unit of time (req/sec).

---

## 5. The CAP Theorem

A distributed system can guarantee only **two of three** properties simultaneously:

```
         Consistency
              /\
             /  \
            /    \
           /      \
Partition  --------  Availability
Tolerance
```

| Combination | Meaning | Example Systems |
|---|---|---|
| **CP** | Consistent + Partition Tolerant | HBase, Zookeeper, MongoDB (strong mode) |
| **AP** | Available + Partition Tolerant | Cassandra, DynamoDB, CouchDB |
| **CA** | Consistent + Available | Traditional RDBMS (no network partitions assumed) |

> In practice, network partitions are unavoidable in distributed systems, so the real trade-off is between **Consistency** and **Availability**.

---

## 6. The PACELC Theorem (Extension of CAP)

Even when there is **no partition**, there's a trade-off between **Latency** and **Consistency**.

```
If Partition → choose Availability or Consistency
Else         → choose Latency or Consistency
```

| System | Partition Choice | Normal Choice |
|---|---|---|
| Cassandra | AP | EL (low latency) |
| DynamoDB | AP | EL |
| PostgreSQL | CP | EC (strong consistency) |

---

## 7. Common System Design Vocabulary

| Term | Definition |
|---|---|
| **Node** | A single machine or process in a distributed system |
| **Load Balancer** | Distributes incoming traffic across multiple servers |
| **Cache** | Temporary fast-access storage layer (e.g., Redis, Memcached) |
| **Database Sharding** | Partitioning data horizontally across multiple DB instances |
| **Replication** | Copying data across multiple nodes for redundancy |
| **Message Queue** | Async communication buffer between services (e.g., Kafka, RabbitMQ) |
| **CDN** | Content Delivery Network — serves static assets from edge locations |
| **API Gateway** | Entry point for clients; handles routing, auth, rate limiting |
| **Microservices** | Architecture splitting an app into small, independently deployable services |
| **Monolith** | Single unified codebase and deployment unit |
| **SLA** | Service Level Agreement — formal uptime/performance commitment |
| **SLO** | Service Level Objective — target metric (e.g., 99.9% uptime) |
| **SLI** | Service Level Indicator — the actual measured metric |

---

## 8. Trade-offs

### 8.1 Consistency vs. Availability
- Choosing strong consistency means some requests may fail or be delayed during partitions.
- Choosing high availability means data may be temporarily stale.
- **Decision factor:** Nature of the data. Financial transactions demand consistency; social media feeds can tolerate eventual consistency.

### 8.2 Latency vs. Consistency
- Replicating data across regions reduces latency for local reads but makes strong consistency expensive.
- A cache improves read latency but introduces the risk of serving stale data.

### 8.3 Scalability vs. Simplicity
- Horizontal scaling introduces complexity: distributed coordination, data partitioning, network failures.
- A monolith is simpler to build and debug but harder to scale independently.

### 8.4 Performance vs. Cost
- Caching at every layer, CDNs, and multi-region deployments improve performance but are expensive.
- Over-engineering for scale you don't have yet wastes engineering effort and money.

### 8.5 Flexibility vs. Coupling
- Microservices offer independent deployability but introduce network overhead and operational complexity.
- Monoliths are tightly coupled but have in-process communication (much faster).

### 8.6 Durability vs. Speed
- Persisting every write synchronously to disk ensures durability but adds latency.
- Buffering writes (async) is faster but risks data loss on crash.

---

## 9. Real-World Systems & Applications

### 9.1 Google Search
- Massive **distributed indexing** across thousands of nodes.
- Heavy use of **MapReduce** for processing web-crawl data.
- **Bigtable** (NoSQL) for storing the web index.
- Trade-off: eventual consistency in index updates is acceptable; search results don't need to be real-time.

### 9.2 Netflix
- Fully **microservices-based** architecture (~700+ services).
- Uses **AWS** with multi-region deployment for high availability.
- **Chaos Engineering** (Chaos Monkey) to proactively test fault tolerance.
- **CDN (Open Connect)** for delivering video content from edge servers.
- Trade-off: availability over consistency — a user seeing a slightly stale recommendation list is acceptable.

### 9.3 WhatsApp
- Handles ~100 billion messages/day with a relatively small engineering team.
- Uses **Erlang/OTP** for its highly concurrent, fault-tolerant messaging server.
- Trade-off: messages are delivered at-least-once; duplicate handling is managed client-side.

### 9.4 Amazon (E-Commerce)
- Pioneered the move from monolith to **SOA (Service-Oriented Architecture)**, the precursor to microservices.
- Uses **DynamoDB (AP system)** for shopping carts — availability is prioritized so users can always add items.
- Trade-off: a shopping cart may show inconsistent totals briefly, but losing a cart entirely would be far worse.

### 9.5 Twitter (X)
- **Fan-out on write** for timeline generation — tweets are pre-computed and pushed to followers' feeds.
- Uses **Redis** for in-memory timeline caching.
- Trade-off: high write amplification (a celebrity's tweet fans out to millions of cache entries) vs. fast read latency on timeline loads.

---

## 10. How to Approach a System Design Problem

A practical framework:

```
1. Clarify Requirements
   ├── Functional: What does the system do?
   └── Non-Functional: Scale, latency, availability, consistency needs

2. Estimate Scale
   ├── Users (DAU, MAU)
   ├── Requests per second (read vs. write ratio)
   └── Data volume (storage needed)

3. Define the API
   └── What endpoints/interfaces does the system expose?

4. High-Level Design
   └── Draw the major components and their interactions

5. Deep Dive into Components
   └── Database choice, caching strategy, sharding, replication

6. Identify & Discuss Trade-offs
   └── Justify your decisions; acknowledge what you're giving up

7. Address Failure Scenarios
   └── What happens when a node, network, or DB fails?
```

---

## 11. Numbers Every Designer Should Know

### Latency Cheat Sheet

| Operation | Approximate Latency |
|---|---|
| CPU register access | ~0.3 ns |
| L1 cache reference | 0.5 ns |
| Branch misprediction | 5 ns |
| L2 cache reference | 7 ns |
| Mutex lock/unlock | 25 ns |
| L3 cache reference | ~15–40 ns |
| RAM access (main memory) | 100 ns |
| Compress 1 KB (Snappy/Zippy) | 3 µs |
| Send 1 KB over 1 Gbps network | 10 µs |
| SSD random read (4 KB) | 150 µs |
| Read 1 MB sequentially from memory | 250 µs |
| Network round-trip (same datacenter) | 0.5 ms |
| Read 1 MB sequentially from SSD | 1 ms |
| HDD seek | 10 ms |
| Read 1 MB sequentially from HDD | 20 ms |
| Network round-trip (cross-continent) | 100–150 ms |

---

### Throughput / Scale Rules of Thumb

| Metric | Rule of Thumb |
|---|---|
| 1 byte | 8 bits |
| 1 KB | 1,024 bytes |
| 1 MB | ~1 million bytes |
| 1 GB | ~1 billion bytes |
| 1 TB | ~1 trillion bytes |
| 1 million users (light traffic) | ~10–50 req/sec |
| Medium web service | ~1K–10K req/sec |
| Large consumer service | ~100K+ req/sec |
| Twitter-scale reads | ~300K req/sec |
| Typical cache lookup (Redis/Memcached) | <1 ms |
| Typical database query | ~1–10 ms |
| Typical internal service call | ~10–100 ms |
| Typical user-facing API latency target | ~50–300 ms |
| 1 server (async I/O) | ~10K–100K connections |
| 1 server (thread-per-request) | ~1K–5K connections |
| 1 TB of text | ~1 billion paragraphs |
| 1 TB logs | ~5–10 billion log lines |

---

### Data Transfer Speeds (Useful for Back-of-the-Napkin Math)

| Medium | Approximate Throughput |
|---|---|
| L1 cache bandwidth | ~1 TB/s |
| RAM bandwidth | ~20–50 GB/s |
| NVMe SSD | ~2–7 GB/s |
| SATA SSD | ~500 MB/s |
| HDD | ~100–200 MB/s |
| 1 Gbps network | ~125 MB/s |
| 10 Gbps network | ~1.25 GB/s |

---

### Hidden Pattern engineers memorize

ns   → CPU / cache
µs   → SSD / small network transfer
ms   → disk / datacenter
100ms+ → global internet