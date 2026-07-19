# Scalability

## Definition

**Scalability** is the ability of a system to maintain proportional performance as load (users, data, traffic) increases by adding resources.

- **If your system is fast for one user but slow under heavy load, you have a scalability problem.**
- A system is scalable if adding resources results in **proportional performance gains** — not diminishing returns.
- Scalability must be **designed in from the start** — it cannot be bolted on later without significant rework.

---

## Axes of Scale

| Axis | Meaning | Example |
|---|---|---|
| **X-axis** | Horizontal duplication — run more copies | Multiple identical app servers behind a load balancer |
| **Y-axis** | Functional decomposition — split by responsibility | Break monolith into microservices |
| **Z-axis** | Data partitioning — split by data subset | Shard DB by user region or customer ID |

> These come from the **Scale Cube** (from *The Art of Scalability*). Mature systems use all three axes.

---

## Horizontal vs Vertical Scaling

| | Vertical Scaling (Scale Up) | Horizontal Scaling (Scale Out) |
|---|---|---|
| **What** | Bigger single machine (more CPU, RAM) | More machines of the same type |
| **Ceiling** | Hard hardware limits | Theoretically unlimited |
| **Complexity** | Simple — no code changes | Requires stateless design, load balancing |
| **Failure risk** | Single point of failure | Resilient — loss of one node is recoverable |
| **Cost** | Expensive at the top end | Commodity hardware, more cost-effective |
| **When to use** | Early stage, fast fix | Production systems under real load |

---

## Core Scalability Techniques

### 1. Load Balancing

- Distributes incoming traffic across multiple servers
- **Algorithms:**

| Algorithm | Behavior | Best For |
|---|---|---|
| Round Robin | Rotate through servers equally | Homogeneous servers, equal request cost |
| Least Connections | Route to server with fewest active connections | Long-lived connections |
| IP Hash | Same client always hits same server | Sticky sessions |
| Weighted Round Robin | Assign more traffic to stronger servers | Heterogeneous hardware |

- **L4 load balancers** (TCP level): faster, less flexible (e.g., AWS NLB)
- **L7 load balancers** (HTTP level): content-aware routing, SSL termination (e.g., NGINX, AWS ALB)

---

### 2. Stateless Services

- Store **no session state on the server** between requests
- State lives in a shared store: Redis, a database, or JWT tokens on the client
- Enables any node to handle any request → true horizontal scaling
- **Stateful services** require sticky sessions and are hard to scale or recover from failure

---

### 3. Caching for Scale

- Reduces the work each server must do, increasing effective capacity
- **Cache-aside (lazy loading):** App checks cache first; on miss, fetches from DB and populates cache
- **Write-through:** Every write goes to cache and DB simultaneously
- **Write-behind (write-back):** Write to cache, asynchronously flush to DB — faster writes, risk of data loss

| Cache Layer | Tool | Use Case |
|---|---|---|
| Application cache | In-process HashMap/LRU | Single-server, non-shared state |
| Distributed cache | Redis, Memcached | Shared across app servers |
| Database query cache | Built-in DB cache | Repeated identical SQL queries |
| CDN | Cloudflare, CloudFront | Static assets and edge-cached responses |

- **Cache stampede protection:** Use locks or probabilistic early expiration to prevent all servers simultaneously hitting the DB on cache expiry

---

### 4. Database Scaling

#### Read Replicas
- Primary handles writes; one or more replicas handle reads
- Works well when read/write ratio is high (common in most web apps)
- Replication lag can cause stale reads — design around eventual consistency

#### Database Sharding (Horizontal Partitioning)
- Split data across multiple DB instances by a **shard key** (e.g., user_id % N)
- Each shard holds a subset of data
- **Challenges:** cross-shard joins are expensive, re-sharding is hard, hot spots if key is poorly chosen
- **Shard key selection:** choose a key with high cardinality and even distribution

#### Vertical Partitioning
- Split columns into separate tables or databases (e.g., separate user profiles from user activity logs)
- Reduces row size, improves cache efficiency

#### CQRS (Command Query Responsibility Segregation)
- Separate the write model (commands) from the read model (queries)
- Read model can be a denormalized, pre-aggregated view optimized for queries
- Pairs well with event sourcing

---

### 5. Message Queues & Async Processing

- Decouple producers (who generate work) from consumers (who process work)
- Producers add messages to a queue; workers pull and process at their own pace
- **Benefits:**
  - Absorbs traffic spikes — queue acts as a buffer
  - Workers can be scaled independently of the API tier
  - Failed jobs can be retried without affecting the user-facing request
- **Tools:** Kafka, RabbitMQ, AWS SQS, Celery

| Pattern | Description |
|---|---|
| **Work Queue** | One message → one worker processes it |
| **Pub/Sub** | One message → multiple subscribers receive it |
| **Dead Letter Queue** | Failed messages are moved here for inspection |
| **Priority Queue** | Higher-priority messages processed first |

---

### 6. Microservices & Functional Decomposition

- Break a large monolith into independently deployable services, each responsible for one domain
- Each service can be scaled independently based on its own demand
- **Trade-offs:** network latency between services, distributed tracing complexity, eventual consistency challenges
- Scale only the services that are bottlenecks rather than the entire application

---

### 7. Auto-Scaling

- Automatically add/remove compute resources based on real-time load metrics (CPU, request rate, queue depth)
- **Reactive scaling:** Scale after a threshold is breached (slight lag)
- **Predictive scaling:** ML-based, scales ahead of anticipated load (e.g., pre-scaling before a known marketing event)
- **Tools:** AWS Auto Scaling Groups, Kubernetes HPA (Horizontal Pod Autoscaler), GKE Autopilot

---

### 8. DNS & Global Load Balancing

- Route users to the nearest data center using **GeoDNS** or **Anycast**
- Reduces latency by keeping traffic local to the user's region
- Enables multi-region active-active or active-passive deployments
- Examples: AWS Route 53 latency-based routing, Cloudflare

---

### 9. Data Partitioning Strategies

| Strategy | Description | Use Case |
|---|---|---|
| **Range partitioning** | Split by value range (e.g., dates A–M, N–Z) | Time-series data, sorted access |
| **Hash partitioning** | Shard key passed through hash function | Uniform distribution |
| **Directory partitioning** | Lookup table maps key → shard | Flexible, allows re-sharding |
| **Geographic partitioning** | Split by user region | Compliance, latency |

---

## Scalability Pitfalls

| Pitfall | Description | Mitigation |
|---|---|---|
| **Shared mutable state** | Global locks kill concurrency | Move state to external store, use immutable design |
| **Synchronous chains** | Long chains of sync calls amplify latency | Use async processing, circuit breakers |
| **Hot spots / hot keys** | One shard or cache key gets disproportionate traffic | Add local micro-caches, use consistent hashing |
| **Sticky sessions** | Ties users to specific servers | Externalize session state to Redis |
| **Heterogeneity** | New hardware is faster but algorithms assume uniformity | Use consistent hashing, capacity-aware scheduling |
| **Thundering herd** | All clients retry at the same time after failure | Exponential backoff with jitter |
| **Missing backpressure** | Producers overwhelm consumers | Use bounded queues; reject excess at ingress |

---

## Reliability Within Scalability

- Adding redundancy to avoid failures is part of scalability
- An **always-on service** is scalable only if adding redundancy does **not** degrade performance
- **Redundancy patterns:**
  - Active-active: multiple nodes all serve traffic simultaneously
  - Active-passive: standby nodes only activate on failure
  - N+1 redundancy: always one spare available

---

## Summary Checklist

- [ ] Design services as stateless from day one
- [ ] Use a load balancer in front of every service tier
- [ ] Cache aggressively at every layer (app, DB, CDN)
- [ ] Use message queues to absorb spikes and decouple services
- [ ] Scale reads with read replicas; scale writes with sharding or CQRS
- [ ] Implement auto-scaling with meaningful metrics
- [ ] Design for heterogeneity — your hardware will not stay uniform
- [ ] Choose shard keys carefully; uneven keys create hot spots
- [ ] Always plan along which axis the system will grow (X / Y / Z)