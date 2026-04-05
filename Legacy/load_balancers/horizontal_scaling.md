# Horizontal Scaling

> Adding more machines to a system to handle increased load, distributing work across multiple nodes.

---

## 1. Core Concept

**Horizontal Scaling (Scale Out/In)** means increasing capacity by adding more servers/nodes to a pool rather than upgrading a single machine. Each node handles a portion of the total workload.

- **Scale Out** → Add more nodes
- **Scale In** → Remove nodes (e.g., during low traffic)

Contrast with **Vertical Scaling (Scale Up)** — upgrading CPU, RAM, or disk on a single machine.

---

## 2. Key Components

### Load Balancer
Distributes incoming traffic across nodes. Acts as the entry point to the cluster.
- Algorithms: Round Robin, Least Connections, IP Hash, Weighted
- Types: L4 (transport layer) vs L7 (application layer)

### Stateless Services
Nodes must be stateless for horizontal scaling to work cleanly. Session state should be externalized to:
- Distributed caches (Redis, Memcached)
- Databases
- Sticky sessions (workaround — generally discouraged)

### Service Discovery
Nodes need to find each other dynamically as the cluster grows/shrinks.
- Tools: Consul, etcd, Kubernetes DNS, AWS Cloud Map

### Data Layer Considerations
The application tier scales easily; the **data tier is harder**.
- Read replicas for read-heavy workloads
- Sharding/partitioning for write-heavy workloads
- Distributed databases (Cassandra, CockroachDB)

---

## 3. When to Use

| Situation | Horizontal Scaling Fits? |
|---|---|
| Unpredictable, spiky traffic | ✅ Yes — auto-scale on demand |
| Stateless services (APIs, web servers) | ✅ Yes — trivial to add nodes |
| High availability requirement | ✅ Yes — no single point of failure |
| Tight budget / commodity hardware | ✅ Yes — cheaper per unit |
| Single-threaded / legacy monolith | ❌ No — refactoring needed first |
| Low-latency inter-process communication | ❌ Caution — network overhead adds up |

---

## 4. Trade-offs

### ✅ Advantages

- **High Availability & Fault Tolerance** — If one node fails, others absorb the load. No single point of failure.
- **Near-Linear Throughput Growth** — Doubling nodes roughly doubles throughput (for stateless services).
- **Cost Efficiency** — Commodity hardware is cheaper than high-end specialized machines.
- **Elastic Scaling** — Nodes can be added or removed dynamically, matching traffic patterns. Pay-as-you-go in cloud environments.
- **No Downtime for Scaling** — Adding nodes doesn't require taking the system offline.
- **Geographic Distribution** — Nodes can be placed in multiple regions for lower latency.

### ❌ Disadvantages

- **Increased Complexity** — Requires load balancers, service discovery, distributed tracing, and orchestration (e.g., Kubernetes).
- **Data Consistency Challenges** — Distributed state is hard. CAP theorem constraints apply. Cache invalidation, split-brain scenarios.
- **Network Overhead** — Latency increases when nodes communicate. Chatty microservices suffer significantly.
- **Stateful Services are Hard to Scale** — Databases, WebSocket connections, and file systems require special handling (sharding, replication).
- **Debugging & Observability** — Distributed systems are harder to trace and debug. Requires centralized logging (ELK, Datadog) and distributed tracing (Jaeger, Zipkin).
- **Consistency of Deployments** — All nodes must run the same version. Rolling deployments add risk if not managed well.
- **Operational Overhead** — More infrastructure to manage, monitor, and secure.

---

## 5. Patterns & Strategies

### Auto-Scaling
Automatically adjusts the number of nodes based on metrics (CPU, request rate, queue depth).
- AWS Auto Scaling Groups, GCP Managed Instance Groups, Kubernetes HPA (Horizontal Pod Autoscaler)

### Sharding (Database Horizontal Scaling)
Partition data across multiple DB nodes by a shard key.
- Range-based, hash-based, or directory-based sharding
- Challenge: hotspots, rebalancing, cross-shard queries

### Read Replicas
Distribute read traffic to replica nodes. Writes go to a primary.
- Works well for read-heavy workloads (>80% reads)
- Replication lag is a consistency concern

### CQRS (Command Query Responsibility Segregation)
Separate read and write paths. Scale them independently.

### Message Queues for Async Scaling
Decouple producers from consumers. Add more consumers (workers) to process faster.
- Kafka, RabbitMQ, AWS SQS

---

## 6. Real-World Systems & Applications

### Twitter / X
- Handles billions of tweets and timeline reads daily. 
- Horizontally scales stateless API servers and fan-out services.
- Uses sharded MySQL and Manhattan (internal distributed DB) for data storage.

### Netflix
- Runs thousands of microservices on AWS, each horizontally scaled independently.
- Uses Eureka for service discovery and Ribbon for client-side load balancing.
- Chaos Engineering (Chaos Monkey) validates fault tolerance in scaled-out clusters.

### Amazon
- Every major service (product catalog, cart, checkout) is a separate horizontally scaled fleet.
- Pioneered the model of small, independently scalable services (precursor to microservices).

### Google Search
- Web crawling, indexing, and serving are all massively horizontally distributed.
- Bigtable and GFS were designed specifically for horizontal scalability across thousands of commodity machines.

### Uber
- Surge pricing, dispatch, and ride matching are horizontally scaled services.
- Uses Kafka extensively for event streaming across scaled consumer groups.
- Schemaless (built on MySQL) and Cassandra for horizontally scaled storage.

### Discord
- Handles millions of concurrent WebSocket connections across horizontally scaled gateway nodes.
- Uses session affinity (sticky sessions) for WebSocket connections, then externalizes state to Cassandra.

### Elasticsearch
- Designed from the ground up for horizontal scaling.
- Shards and replicas are distributed across a cluster of nodes automatically.

---

## 7. Horizontal vs. Vertical Scaling — Quick Comparison

| | Horizontal | Vertical |
|---|---|---|
| How | Add more nodes | Upgrade one machine |
| Cost | Cheaper at scale | Expensive, hits hardware limits |
| Fault Tolerance | High (redundancy) | Low (single point of failure) |
| Complexity | High (distributed systems) | Low (simple architecture) |
| Scaling Limit | Theoretically unlimited | Physical hardware ceiling |
| Best For | Stateless services, web tier | Databases, legacy apps |
| Downtime for Scaling | None | Usually required |

---

## 8. Key Metrics to Monitor

- **Request throughput** (RPS — requests per second)
- **CPU & Memory utilization per node**
- **Load balancer latency & error rate**
- **Queue depth** (for async worker pools)
- **Replication lag** (for DB replicas)
- **Node health checks & failure rate**

---

## 9. Related Topics

- Load Balancing
- CAP Theorem
- Database Sharding
- Consistent Hashing
- Service Discovery
- Auto-Scaling & Cloud Infrastructure
- Stateless Architecture
- Message Queues & Event Streaming