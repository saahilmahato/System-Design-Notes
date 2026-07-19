# Interview Topics Recap

A quick-reference guide to every major topic that appears in system design interviews. Know these cold.

---

## 1. Scalability

### Horizontal Scaling (Scale Out)
- Add more machines/nodes to distribute load
- Achieved via load balancers or sharding
- No single ceiling — theoretically unlimited
- Used in: stateless services, web servers, microservices

### Vertical Scaling (Scale Up)
- Add more resources (CPU, RAM, storage) to an existing machine
- Simpler but has a hard ceiling (hardware limits)
- Can cause downtime during upgrades
- Used in: databases (short-term), monoliths

| | Horizontal | Vertical |
|---|---|---|
| Cost | Pay-per-node (linear) | Exponential after a point |
| Ceiling | Low (near-infinite) | Hard hardware limit |
| Complexity | Higher (distributed) | Lower |
| Downtime | None (rolling deploys) | Often required |

---

## 2. Load Balancing

- Distributes incoming traffic across multiple servers
- Prevents any single server from becoming a bottleneck
- Also provides health checks — removes unhealthy instances

**Types:**
- **Layer 4 (Transport)** — routes by IP/TCP; fast, no content inspection
- **Layer 7 (Application)** — routes by URL, headers, cookies; smarter, supports A/B testing

**Algorithms:**
- Round Robin — equal distribution
- Least Connections — routes to server with fewest active requests
- IP Hash — same client always goes to same server (session stickiness)
- Weighted — proportional routing by server capacity

**Failover modes:**
- **Active-Passive** — standby takes over if primary fails
- **Active-Active** — all nodes handle traffic; redistributed on failure

---

## 3. Caching

- Stores frequently accessed data in fast storage (RAM) to reduce latency and DB load
- Cache hit: data found in cache; Cache miss: must fetch from origin

**Where to cache:**
- Client-side (browser cache)
- CDN (edge cache)
- Web server / reverse proxy (Nginx, Varnish)
- Application layer (in-process, e.g., Guava Cache)
- Database query cache
- Distributed cache (Redis, Memcached)

**Write strategies:**

| Strategy | How It Works | Trade-off |
|---|---|---|
| Cache-aside | App reads cache; on miss, fetches DB and populates cache | Stale data possible |
| Write-through | Writes go to cache AND DB simultaneously | Higher write latency |
| Write-behind | Write to cache; flush to DB asynchronously | Risk of data loss |
| Refresh-ahead | Pre-emptively refresh before TTL expires | Can cache unused data |

**Eviction policies:** LRU (Least Recently Used), LFU (Least Frequently Used), TTL (time-based expiry)

---

## 4. Databases

### Relational (SQL)
- Structured schema, ACID guarantees, supports JOINs
- Best for: financial systems, e-commerce orders, user accounts
- Examples: PostgreSQL, MySQL, Oracle

**Scaling SQL:**
- **Master-Slave Replication** — reads from replicas, writes to master
- **Master-Master** — multiple writable nodes (conflict resolution needed)
- **Federation** — split DB by function (users DB, products DB)
- **Sharding** — split data horizontally by a shard key (e.g., user_id % N)
- **Denormalization** — reduce JOINs at the cost of data redundancy

### NoSQL
- Flexible/no schema, horizontal scaling, eventual consistency by default

| Type | Characteristics | Examples | Use Case |
|---|---|---|---|
| Key-Value | Ultra-fast lookups, simple data | Redis, DynamoDB | Sessions, caching, rate limiting |
| Wide-Column | Handles billions of rows, column families | Cassandra, HBase | Time-series, IoT, analytics |
| Document | JSON-like, flexible schema | MongoDB, CouchDB | Catalogs, CMS, user profiles |
| Graph | Nodes and edges, relationship traversal | Neo4j, Amazon Neptune | Social graphs, recommendation engines |

**When to choose NoSQL over SQL:**
- Need horizontal scalability beyond what SQL can offer
- Schema changes frequently
- Data is unstructured or semi-structured
- Read/write throughput is massive (millions of ops/sec)

---

## 5. CAP Theorem

A distributed system can guarantee only **2 of 3** properties simultaneously:

| Property | Description |
|---|---|
| **Consistency (C)** | Every read returns the most recent write |
| **Availability (A)** | Every request receives a response (not necessarily the latest data) |
| **Partition Tolerance (P)** | System continues operating despite network partitions |

Network partitions are unavoidable in distributed systems — so the real choice is **CP vs. AP**:
- **CP systems** (sacrifice availability): HBase, MongoDB, Redis — used when correctness is critical
- **AP systems** (sacrifice consistency): Cassandra, DynamoDB, CouchDB — used when uptime is critical

> Real systems often allow tunable consistency — e.g., Cassandra lets you choose quorum levels per query.

---

## 6. Consistency Models

| Model | Description | Example |
|---|---|---|
| Strong Consistency | All nodes see the same data immediately after a write | Banking transactions |
| Eventual Consistency | All nodes will converge to the same state *eventually* | DNS, shopping carts |
| Weak Consistency | No guarantee reads reflect recent writes | Live video streams |
| Read-your-writes | A user always sees their own writes | Social media posts |
| Monotonic Read | A user never sees older data after seeing newer | Feed timelines |

---

## 7. Replication & Redundancy

- **Replication** — maintaining multiple copies of data across nodes
  - Synchronous: write confirmed only after all replicas updated (strong consistency, higher latency)
  - Asynchronous: write confirmed immediately; replicas catch up (lower latency, risk of data loss)
- **Redundancy** — duplicating critical components to eliminate single points of failure (SPOF)
  - Active redundancy: all copies serve traffic
  - Passive redundancy: standby takes over on failure

---

## 8. Sharding

- Partitioning data horizontally across multiple DB nodes (shards)
- Each shard holds a subset of the total data

**Sharding strategies:**
- **Range-based** — e.g., users A–M on shard 1, N–Z on shard 2 (simple, but uneven distribution)
- **Hash-based** — `shard = hash(key) % N` (even distribution, hard to add shards)
- **Directory-based** — lookup table maps keys to shards (flexible, lookup is a bottleneck)

**Challenges:**
- Cross-shard queries and JOINs are complex
- Re-sharding when data grows is painful
- Hot shards (celebrity problem) cause uneven load

---

## 9. Microservices

- Decompose a monolith into small, independent services each responsible for one domain
- Services communicate via REST, gRPC, or message queues
- Each service has its own database (database-per-service pattern)

**Benefits:** independent scaling, independent deployments, tech stack freedom, fault isolation

**Challenges:** distributed tracing, service discovery, network latency, data consistency across services

**Key patterns:**
- **API Gateway** — single entry point that routes to downstream services; handles auth, rate limiting, SSL
- **Service Discovery** — services register themselves (Consul, Eureka, K8s DNS); clients find them dynamically
- **Circuit Breaker** — stops calling a failing service to prevent cascading failures (Hystrix, Resilience4j)

---

## 10. Message Queues & Asynchronism

- Decouple producers from consumers; enable async processing
- Producer publishes messages; consumers process at their own pace

**Benefits:** absorbs traffic spikes, retries failed jobs, enables fan-out (one message → many consumers)

| Tool | Type | Best For |
|---|---|---|
| Kafka | Distributed log | Event streaming, high throughput, replay |
| RabbitMQ | Message broker | Task queues, routing, low latency |
| Amazon SQS | Managed queue | Cloud-native, simple decoupling |
| Redis Pub/Sub | In-memory | Real-time notifications, ephemeral messages |

**Back pressure** — mechanism to slow producers when consumers fall behind; prevents queue overflow

---

## 11. Content Delivery Network (CDN)

- Globally distributed servers that cache and serve static content close to users
- Reduces latency by serving from edge nodes instead of origin server
- Reduces origin server load

| Type | Description | Use When |
|---|---|---|
| Push CDN | You upload content proactively | Predictable, infrequently changing content |
| Pull CDN | CDN fetches from origin on first request, caches for TTL | Dynamic sites, unpredictable access patterns |

---

## 12. Proxy & Reverse Proxy

- **Forward Proxy** — sits in front of *clients*; used for anonymity, filtering, access control
- **Reverse Proxy** — sits in front of *servers*; used for load balancing, SSL termination, caching, compression

Common reverse proxies: **Nginx**, **HAProxy**, **Envoy**, **Traefik**

---

## 13. Communication Protocols

| Protocol | Properties | Use Case |
|---|---|---|
| HTTP/REST | Stateless, text-based, widely adopted | Public APIs, CRUD operations |
| gRPC | Binary (Protobuf), strongly typed, streaming | Internal microservice communication |
| WebSocket | Full-duplex, persistent connection | Chat, live dashboards, notifications |
| TCP | Reliable, ordered, connection-based | Any data where loss is unacceptable |
| UDP | Unreliable, fast, connectionless | Video streaming, VoIP, gaming |
| GraphQL | Query language over HTTP, client-specified fields | Mobile apps, flexible data fetching |

---

## 14. Distributed System Patterns

### Two-Phase Commit (2PC)
- **Phase 1 (Prepare):** Coordinator asks all nodes "can you commit?"
- **Phase 2 (Commit):** If all say yes, coordinator sends commit; otherwise sends abort
- **Problem:** Blocking — if coordinator crashes after prepare, participants are stuck
- **Use:** Database distributed transactions

### Saga Pattern
- Replace 2PC with a sequence of local transactions + compensating actions
- If any step fails, compensating transactions roll back previous steps
- **Choreography** — each service reacts to events (decentralized)
- **Orchestration** — a central saga orchestrator commands each step (centralized)
- **Use:** Long-running business transactions across microservices

### CQRS (Command Query Responsibility Segregation)
- Separate the model for reading (queries) from the model for writing (commands)
- Read model can be optimized independently (e.g., denormalized views, different DB)
- Often paired with Event Sourcing
- **Use:** High-read systems where read and write patterns diverge significantly

### Event Sourcing
- Instead of storing current state, store a log of all events that led to that state
- Current state = replay of all events
- Enables audit logs, time travel, and event-driven architectures
- **Trade-off:** Query complexity increases; events must never be deleted

---

## 15. Availability & Reliability

**Availability** = uptime as a percentage

| SLA | Downtime Per Year |
|---|---|
| 99% ("two nines") | ~3.65 days |
| 99.9% ("three nines") | ~8.76 hours |
| 99.99% ("four nines") | ~52 minutes |
| 99.999% ("five nines") | ~5 minutes |

**Strategies to improve availability:**
- Eliminate single points of failure (SPOF)
- Replication and redundancy
- Graceful degradation (serve partial functionality instead of full outage)
- Health checks + automatic failover
- Chaos engineering (intentionally break things to find weaknesses)

---

## 16. Rate Limiting

- Throttle requests to protect services from overload or abuse

**Algorithms:**
- **Token Bucket** — tokens refill at a rate; each request consumes a token (allows bursts)
- **Leaky Bucket** — requests drain at a fixed rate; excess spills over (smooth output)
- **Fixed Window** — count requests in fixed time windows (simple, but boundary spike problem)
- **Sliding Window** — rolling count over last N seconds (more accurate, higher memory cost)

**Implementation:** At API Gateway, Nginx, or a distributed counter in Redis

---

## 17. DNS (Domain Name System)

- Translates human-readable domain names to IP addresses
- Hierarchical: Root → TLD (.com, .org) → Authoritative DNS server
- TTL controls how long DNS records are cached

**Routing strategies:**
- **Round Robin DNS** — returns multiple IPs in rotation
- **Geo DNS** — routes users to nearest data center
- **Weighted DNS** — traffic splitting (canary deploys, A/B testing)

---

## 18. API Design Fundamentals

**REST best practices:**
- Use nouns for resources (`/users`, `/orders`), not verbs
- Use HTTP methods semantically: `GET` (read), `POST` (create), `PUT/PATCH` (update), `DELETE`
- Version your APIs: `/v1/users`
- Return appropriate HTTP status codes (200, 201, 400, 401, 403, 404, 429, 500)
- Use pagination for large collections: cursor-based preferred over offset for large datasets

**Idempotency:**
- `GET`, `PUT`, `DELETE` should be idempotent (same result on repeated calls)
- Critical for safe retries in distributed systems
- Use idempotency keys for `POST` operations (e.g., payment APIs)

---

## Key Trade-offs to Always Know

| Trade-off | Option A | Option B |
|---|---|---|
| Consistency vs. Availability | CP (correct but may be unavailable) | AP (always available, may be stale) |
| Latency vs. Throughput | Optimize for single request speed | Optimize for total requests/sec |
| SQL vs. NoSQL | Schema, ACID, complex queries | Flexibility, horizontal scale |
| Monolith vs. Microservices | Simple to develop, hard to scale | Complex to build, easy to scale independently |
| Push vs. Pull | Server pushes updates to clients | Clients poll for updates |
| Sync vs. Async | Immediate response, tight coupling | Delayed response, loose coupling |
| Normalization vs. Denormalization | Less storage, more JOINs | More storage, faster reads |