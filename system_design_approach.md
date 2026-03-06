# How to Approach a System Design Problem

> Structured notes for designing scalable, reliable, and maintainable systems.

---

## Table of Contents

1. [The Framework: A Step-by-Step Approach](#1-the-framework)
2. [Step 1 — Clarify Requirements](#2-step-1--clarify-requirements)
3. [Step 2 — Estimate Scale (Back-of-Envelope)](#3-step-2--estimate-scale)
4. [Step 3 — Define the API / Interface](#4-step-3--define-the-api--interface)
5. [Step 4 — High-Level Design](#5-step-4--high-level-design)
6. [Step 5 — Data Model & Storage](#6-step-5--data-model--storage)
7. [Step 6 — Deep Dive & Bottlenecks](#7-step-6--deep-dive--bottlenecks)
8. [Step 7 — Non-Functional Requirements](#8-step-7--non-functional-requirements)
9. [Trade-offs Cheat Sheet](#9-trade-offs-cheat-sheet)
10. [Worked Example A — Design a URL Shortener](#10-worked-example-a--design-a-url-shortener)
11. [Worked Example B — Design a Twitter/X Feed](#11-worked-example-b--design-a-twitterx-feed)
12. [Worked Example C — Design a Distributed File Storage (like S3)](#12-worked-example-c--design-a-distributed-file-storage-like-s3)
13. [Common Patterns Quick Reference](#13-common-patterns-quick-reference)

---

## 1. The Framework

System design is deliberately open-ended. There is no single correct answer. The goal is to **demonstrate structured thinking**, make **explicit trade-offs**, and show that you understand the consequences of your choices.

### The 7-Step Blueprint

```
1. Clarify Requirements       →  What exactly are we building?
2. Estimate Scale             →  How big will this get?
3. Define the API             →  What does the system expose?
4. High-Level Design          →  What are the major components?
5. Data Model & Storage       →  What data, how stored, how queried?
6. Deep Dive & Bottlenecks    →  Where will it break? How to fix it?
7. Non-Functional Requirements→  Availability, consistency, security, cost
```

> **Key mindset:** Drive the conversation. Ask questions, state assumptions aloud, and justify your decisions. Interviewers and stakeholders value the reasoning more than the final diagram.

---

## 2. Step 1 — Clarify Requirements

Before drawing a single box, nail down **what you're building**.

### Functional Requirements
- What are the core features? (MVP only — resist gold-plating)
- Who are the users? (consumers, businesses, internal teams)
- What are the critical user journeys?

### Non-Functional Requirements
- **Scale:** DAU, requests/sec, data volume
- **Latency:** p99 read/write SLA (e.g., < 100ms reads)
- **Availability:** 99.9% vs 99.99% — huge cost difference
- **Consistency:** Strong vs eventual?
- **Durability:** Can we lose data? (almost always: no)
- **Security & Compliance:** PII, GDPR, HIPAA?

### Questions to Ask
| Area | Sample Questions |
|------|-----------------|
| Scope | "Should I include auth/login, or assume that's handled?" |
| Scale | "Are we designing for 1M or 100M users?" |
| Read/Write ratio | "Is this read-heavy, write-heavy, or balanced?" |
| Geography | "Single region or global?" |
| Consistency | "Is it OK to show slightly stale data?" |

### Trade-offs
- **More requirements clarity** → less ambiguity but takes more upfront time
- **Overly narrow scope** → misses edge cases; **too broad** → unfocused design

---

## 3. Step 2 — Estimate Scale

Numbers give shape to your design. Rough estimates reveal whether you need a single server or a continent-spanning distributed system.

### Reference Numbers (memorize these)

| Metric | Value |
|--------|-------|
| SSD random read latency | ~0.1 ms |
| Network round-trip (same datacenter) | ~0.5 ms |
| Network round-trip (cross-continent) | ~150 ms |
| Read 1 MB sequentially from SSD | ~1 ms |
| Read 1 MB from RAM | ~0.025 ms |
| Disk seek | ~10 ms |

### Common Estimates

```
DAU = 100M users
Each user: 10 actions/day
→ Total actions/day = 1B
→ Requests/sec = 1B / 86,400 ≈ ~12,000 RPS

Storage:
Each action stores 1 KB of data
→ 1B × 1 KB = 1 TB / day
→ 1 year = ~365 TB
```

### Trade-offs
- **Over-provisioning** → safe but expensive
- **Under-provisioning** → cheap but risks outages at scale
- **Design for 10x current load** → common rule of thumb

### Real-World Context
- **Twitter:** ~6,000 tweets/sec average, 300K reads/sec
- **WhatsApp:** ~100B messages/day ≈ 1.15M messages/sec
- **Netflix:** ~15% of global internet bandwidth at peak

---

## 4. Step 3 — Define the API / Interface

Defining the API forces you to think about **what the system must do** before worrying about how it does it.

### REST API Design Principles
- Use nouns for resources: `/users/{id}`, `/posts/{id}`
- HTTP verbs carry meaning: `GET` (read), `POST` (create), `PUT/PATCH` (update), `DELETE` (remove)
- Return appropriate status codes: `200`, `201`, `400`, `404`, `429`, `500`
- Version your API: `/v1/users`

### gRPC / GraphQL Considerations
- **gRPC:** Better for internal service-to-service (binary protocol, lower overhead)
- **GraphQL:** Better when clients need flexible querying (mobile apps, varied frontends)
- **REST:** Best default for public-facing APIs

### Example API Sketch (URL Shortener)
```
POST   /shorten          { long_url, custom_alias?, ttl? }  → { short_url }
GET    /{short_code}      → 301/302 redirect to long_url
DELETE /{short_code}      → 204 No Content
GET    /{short_code}/stats → { clicks, created_at, last_accessed }
```

### Trade-offs
| Choice | Pro | Con |
|--------|-----|-----|
| 301 (permanent redirect) | Browser caches → less load | Can't track analytics |
| 302 (temporary redirect) | Full analytics visibility | Higher server load |
| Pagination (cursor-based) | Stable under writes | More complex client logic |
| Pagination (offset-based) | Simple to implement | Unstable if data changes mid-page |

---

## 5. Step 4 — High-Level Design

Sketch the major components and data flow. Keep it **simple first**, then optimize.

### Core Building Blocks

```
Clients → DNS → CDN → Load Balancer → API Servers → Cache → Database
                                             ↓
                                       Message Queue → Workers
```

### Component Responsibilities

| Component | Role | Examples |
|-----------|------|---------|
| **Load Balancer** | Distribute traffic, health checks | AWS ALB, Nginx, HAProxy |
| **API Gateway** | Rate limiting, auth, routing | Kong, AWS API Gateway |
| **Application Server** | Business logic | Node.js, Go, Java |
| **Cache** | Fast reads, reduce DB load | Redis, Memcached |
| **Database** | Persistent storage | PostgreSQL, MySQL, DynamoDB |
| **Message Queue** | Async processing, decoupling | Kafka, RabbitMQ, SQS |
| **CDN** | Static assets, edge caching | Cloudflare, AWS CloudFront |
| **Object Storage** | Large blobs, files, media | AWS S3, GCS |
| **Search Index** | Full-text search | Elasticsearch, OpenSearch |

### Trade-offs
- **Monolith vs Microservices:** Monolith is simpler to start; microservices allow independent scaling but add operational complexity
- **Synchronous vs Asynchronous:** Sync is simpler but couples services; async (queues) decouples them and improves resilience
- **Stateless vs Stateful servers:** Stateless scales horizontally easily; stateful is harder to scale

### Real-World Examples
- **Uber:** Uses a mix of microservices; surge pricing calculation is a separate service
- **Netflix:** Decoupled video encoding pipeline using message queues; API gateway handles routing to 700+ microservices
- **Discord:** Migrated from a monolith to microservices at ~5M concurrent users

---

## 6. Step 5 — Data Model & Storage

**Choosing the right database is one of the most impactful decisions in system design.**

### Storage Type Decision Tree

```
Need flexible schema or document model?     → MongoDB, DynamoDB (NoSQL Document)
Need strong relations & ACID transactions?  → PostgreSQL, MySQL (Relational)
Need fast key-value access?                 → Redis, DynamoDB
Need time-series data?                      → InfluxDB, TimescaleDB
Need full-text search?                      → Elasticsearch
Need graph relationships?                   → Neo4j, Amazon Neptune
Need large file/blob storage?               → S3, GCS
Need column-oriented analytics?             → BigQuery, Redshift, Snowflake
```

### SQL vs NoSQL — The Core Trade-off

| | SQL (Relational) | NoSQL |
|--|--|--|
| **Schema** | Rigid, enforced | Flexible |
| **Transactions** | ACID | Eventual consistency (typically) |
| **Scaling** | Vertical (primarily) | Horizontal |
| **Joins** | Native, efficient | Avoided (denormalize instead) |
| **Best for** | Complex queries, financial data | High throughput, unstructured data |
| **Examples** | Postgres, MySQL | DynamoDB, Cassandra, MongoDB |

### Data Modeling Tips
- **Denormalize for read performance** in NoSQL (duplicate data to avoid joins)
- **Index strategically:** Index columns used in `WHERE`, `JOIN`, `ORDER BY`
- **Sharding key selection is critical:** Choose a key with high cardinality and even distribution
- **Hot partitions:** Avoid sharding on time (all writes go to the latest shard)

### Real-World Examples
- **Instagram:** PostgreSQL for user/post metadata; Cassandra for feed; S3 for photos
- **Airbnb:** MySQL for core data; Elasticsearch for search; Redis for sessions and rates
- **LinkedIn:** Uses a distributed graph database for the social graph (LinkedIn's Voldemort)

### Trade-offs
- **Normalization** → less data duplication, slower reads (more joins)
- **Denormalization** → faster reads, higher storage cost, risk of inconsistency
- **Single DB** → simpler ops; **Polyglot persistence** → each service uses best-fit DB but operationally complex

---

## 7. Step 6 — Deep Dive & Bottlenecks

After the happy path, ask: **"Where does this break?"**

### Identify Bottlenecks

Common hotspots:
1. **Database reads** → Add read replicas + caching layer
2. **Database writes** → Sharding, write-optimized stores (Cassandra, LSM trees)
3. **Single points of failure** → Redundancy, failover, replication
4. **Hot keys in cache** → Replicate hot keys across multiple cache nodes
5. **Long-running synchronous calls** → Move to async (queues)
6. **Large file uploads** → Direct-to-S3 presigned URLs (bypass app servers)

### Scaling Strategies

| Strategy | Description | When to Use |
|----------|-------------|-------------|
| **Vertical Scaling** | Bigger machine | Quick fix, limited ceiling |
| **Horizontal Scaling** | More machines | Stateless services |
| **Read Replicas** | Route reads to replicas | Read-heavy workloads |
| **Sharding** | Partition data across nodes | Write-heavy, large datasets |
| **Caching** | Store hot data in memory | Repeated reads of same data |
| **CDN** | Cache at edge nodes globally | Static assets, geo-distributed users |
| **Async Queues** | Decouple producers from consumers | Burst traffic, long tasks |

### Caching Strategies

| Pattern | How It Works | Trade-off |
|---------|-------------|-----------|
| **Cache-Aside** | App checks cache first; on miss, reads DB and populates cache | Stale data risk; cache miss penalty |
| **Write-Through** | Write to cache and DB simultaneously | Always consistent; higher write latency |
| **Write-Behind** | Write to cache; async flush to DB | Fast writes; risk of data loss |
| **Read-Through** | Cache handles DB reads automatically | Simpler app code; cold start issue |

### Failure Modes & Resilience

- **Circuit Breaker:** Stop calling a failing service to prevent cascade failure
- **Retry with Backoff:** Retry failed requests with exponential backoff + jitter
- **Bulkhead:** Isolate resource pools per service/tenant
- **Timeout:** Always set timeouts on external calls
- **Health Checks:** Load balancers route only to healthy instances
- **Graceful Degradation:** Serve stale/cached data when live source is down

### Real-World Examples
- **Amazon:** Uses circuit breakers extensively across microservices (Hystrix/Resilience4j)
- **Netflix Chaos Monkey:** Deliberately kills instances in production to test resilience
- **Facebook TAO:** Custom distributed cache for the social graph to handle hot reads

---

## 8. Step 7 — Non-Functional Requirements

### Availability

```
Availability %   Downtime/year    Downtime/month
99%              87.6 hrs         7.3 hrs
99.9%            8.76 hrs         43.8 min
99.99%           52.6 min         4.4 min
99.999%          5.26 min         26.3 sec
```

**Achieving high availability:**
- Active-Active failover (both nodes serve traffic)
- Active-Passive failover (standby takes over on failure)
- Multi-region deployment
- Database replication (synchronous = no data loss; async = performance)

### Consistency Models (CAP Theorem)

The CAP theorem states a distributed system can only guarantee **two of three**:
- **C**onsistency — every read sees the latest write
- **A**vailability — every request gets a response
- **P**artition Tolerance — system works despite network failures

Since network partitions are inevitable, the real choice is **CP vs AP**:
- **CP (Consistency + Partition Tolerance):** HBase, Zookeeper, etcd — used for config, locking
- **AP (Availability + Partition Tolerance):** DynamoDB, Cassandra — used for shopping carts, social feeds

**PACELC** extends CAP: even without a partition, there's a trade-off between **latency** and **consistency**.

### Security Considerations
- **Authentication:** OAuth 2.0 / JWT tokens
- **Authorization:** RBAC (Role-Based Access Control) or ABAC
- **Encryption:** TLS in transit; AES-256 at rest
- **Rate Limiting:** Token bucket or leaky bucket algorithm per user/IP
- **Input Validation:** Prevent injection attacks at every entry point

### Observability (the 3 Pillars)
1. **Metrics:** CPU, memory, RPS, error rate, p99 latency → Prometheus + Grafana
2. **Logs:** Structured logs with trace IDs → Elasticsearch/Kibana, Datadog
3. **Traces:** Distributed request tracing → Jaeger, Zipkin, AWS X-Ray

### Trade-offs
- **Strong Consistency** → higher latency, lower availability
- **Eventual Consistency** → lower latency, risk of stale reads
- **More observability** → higher operational cost, better debuggability

---

## 9. Trade-offs Cheat Sheet

| Decision | Option A | Option B | Choose A when... | Choose B when... |
|----------|----------|----------|-----------------|-----------------|
| **Storage** | SQL | NoSQL | Complex relations, ACID needed | High throughput, flexible schema |
| **Caching** | Redis | Memcached | Need data structures, persistence | Pure key-value, simplicity |
| **Messaging** | Kafka | RabbitMQ | High throughput, replay needed | Complex routing, lower volume |
| **API** | REST | gRPC | Public API, simplicity | Internal services, performance |
| **Consistency** | Strong | Eventual | Financial, inventory | Social feeds, analytics |
| **Scaling** | Vertical | Horizontal | Stateful, quick fix | Stateless, long-term |
| **Deployment** | Monolith | Microservices | Small team, early stage | Large org, independent scaling |
| **Search** | DB LIKE queries | Elasticsearch | Low volume, simple | Full-text, faceting, scale |

---

## 10. Worked Example A — Design a URL Shortener

> *Like bit.ly or TinyURL*

### Requirements (Clarified)
- **Functional:** Shorten URLs, redirect to original, custom aliases, expiry
- **Non-Functional:** 100M URLs created/day; 10:1 read-to-write ratio; p99 redirect < 10ms; 10-year data retention

### Scale Estimates
```
Writes: 100M / 86,400 ≈ 1,200 writes/sec
Reads:  1.2B / 86,400 ≈ 14,000 reads/sec

Storage per URL: ~500 bytes
10 years of data: 100M/day × 365 × 10 × 500B ≈ 182 TB
```

### API
```
POST /v1/shorten   { long_url, alias?, ttl_days? } → { short_url, code }
GET  /{code}       → 302 redirect
```

### High-Level Design
```
Client → CDN (cache popular redirects)
       → Load Balancer
       → Redirect Service → Redis Cache (hot URLs)
                          → PostgreSQL (full URL store)

Write Path:
Client → API Server → ID Generator (Snowflake) → encode to Base62
                   → Store (code → long_url) in PostgreSQL
```

### Data Model
```sql
CREATE TABLE urls (
    id          BIGINT PRIMARY KEY,      -- Snowflake ID
    code        VARCHAR(8) UNIQUE,       -- Base62 encoded
    long_url    TEXT NOT NULL,
    user_id     BIGINT,
    created_at  TIMESTAMP,
    expires_at  TIMESTAMP,
    click_count BIGINT DEFAULT 0
);
```

### Key Design Decisions

1. **ID Generation:** Use a distributed ID generator (Snowflake, UUID) → encode to Base62 (a-z, A-Z, 0-9) → 7 chars = 62^7 ≈ 3.5 trillion unique codes
2. **Redirect type:** Use `302` (temporary) to enable analytics tracking
3. **Caching:** Cache top 20% of URLs in Redis (80% of traffic) with TTL matching expiry
4. **Collision handling:** If custom alias exists, return 409 Conflict
5. **Cleanup:** Background job to delete expired URLs (soft-delete first)

### Trade-offs
| Decision | Choice | Rationale |
|----------|--------|-----------|
| 301 vs 302 | 302 | Need click analytics |
| Hash vs counter | Counter + Base62 | No collision issues |
| DB choice | PostgreSQL + Redis | Strong consistency for writes, fast cache for reads |
| Sharding | By `code` hash | Even distribution, no hot partitions |

### Real-World: bit.ly
- Uses a distributed counter with Zookeeper coordination
- Stores long URLs in a mix of MySQL and Cassandra
- Redis caches billions of short codes for sub-millisecond redirects

---

## 11. Worked Example B — Design a Twitter/X Feed

> *Timeline generation for a social media platform*

### Requirements (Clarified)
- **Functional:** Post tweets (280 chars), follow users, view home timeline, view user timeline
- **Non-Functional:** 300M DAU; 6,000 tweets/sec written; 300,000 timeline reads/sec; timeline load < 200ms

### Scale Estimates
```
Tweets written: 6,000/sec
Timeline reads: 300,000/sec
Read:Write ratio = 50:1 → heavily read-optimized

Storage: 6K tweets/sec × 300 bytes × 86,400 × 365 ≈ ~57 TB/year
```

### Two Approaches: Fan-out on Write vs Fan-out on Read

#### Fan-out on Write (Push Model)
- On tweet, immediately write to all followers' timeline caches
- Read is O(1) — just read pre-computed cache
- **Problem:** A celebrity with 10M followers causes 10M cache writes per tweet (**hotspot**)

#### Fan-out on Read (Pull Model)
- On timeline load, query tweets from all followed users → merge & sort
- **Problem:** Following 1,000 people → 1,000 DB queries → slow

#### Hybrid Model (Twitter's actual approach)
- **Regular users** (< ~10K followers): Fan-out on write → inject into followers' Redis timelines
- **Celebrities** (> ~10K followers): Fan-out on read → merge at read time
- On timeline request: serve pre-computed cache + inject celebrity tweets in real-time

### Data Model
```sql
-- Users
users(id, username, follower_count, following_count, created_at)

-- Tweets
tweets(id, user_id, content, media_ids[], created_at, like_count, retweet_count)

-- Follows (Graph)
follows(follower_id, followee_id, created_at)

-- Timeline Cache (Redis Sorted Set — score = tweet timestamp)
ZADD timeline:{user_id} {timestamp} {tweet_id}
ZRANGE timeline:{user_id} 0 19  →  latest 20 tweets
```

### High-Level Design
```
Post Tweet:
Client → API Server → Kafka (tweet event)
                        → Fan-out Worker → Redis (follower timelines)
                        → Tweet DB (store tweet)
                        → Search Indexer (Elasticsearch)

Read Timeline:
Client → API Server → Redis (pre-computed timeline)
                    → Hydration Service (fetch tweet details by IDs)
                    → Celebrity tweet injector
                    → Return merged, sorted timeline
```

### Trade-offs
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fan-out model | Hybrid | Balances write amplification vs read latency |
| Timeline storage | Redis sorted sets | O(log N) inserts, O(1) range reads |
| Tweet storage | Cassandra | Write-heavy, wide column for time-series |
| Search | Elasticsearch | Full-text tweet search at scale |
| Media | S3 + CDN | Offload large binary content |

### Real-World: Twitter's Actual Architecture
- Uses a **Flock** service for the social graph (follow relationships)
- **Manhattan** (custom key-value store) for tweet storage
- **Redis** timeline caches with ~800 tweet IDs per user
- Timeline is a sorted set of tweet IDs — full hydration happens separately

---

## 12. Worked Example C — Design a Distributed File Storage (like S3)

> *Object store for uploading, storing, and downloading files at scale*

### Requirements (Clarified)
- **Functional:** Upload files (up to 5GB), download files, delete files, list files in a bucket, versioning
- **Non-Functional:** Durability 99.999999999% (11 nines); 1B objects; 10PB storage; Multi-region

### Scale Estimates
```
1B objects × avg 1MB = 1 PB baseline
At 10 PB with replication factor 3 = 30 PB raw storage needed

Uploads: 1M/day ≈ 12 uploads/sec
Downloads: 10x uploads = 120 downloads/sec (varies widely)
```

### Core Design Challenges
1. **Durability:** Files must never be lost — replicate across failure domains
2. **Large file uploads:** Can't upload 5GB in one HTTP request → multipart uploads
3. **Metadata vs data separation:** Store file metadata (name, size, owner) separately from binary content
4. **Deduplication:** Identical files shouldn't be stored twice

### High-Level Design
```
Upload Flow:
Client → API Gateway → Upload Service → Chunk file (5MB chunks)
                                      → Store chunks across Data Nodes
                                      → Write metadata to Metadata DB
                                      → Return file URL

Download Flow:
Client → API Gateway → Metadata Lookup → Get chunk locations
                                       → Fetch chunks from Data Nodes (parallel)
                                       → Stream to client

Data Node Replication:
Each chunk stored on 3 data nodes across 2+ AZs
Primary node streams to 2 replica nodes on write
```

### Metadata Model
```
Buckets: { bucket_id, owner_id, region, created_at, versioning_enabled }
Objects: { object_id, bucket_id, key, size, content_hash, created_at, version_id }
Chunks:  { chunk_id, object_id, chunk_index, checksum, [data_node_ids] }
```

### Key Design Decisions

1. **Chunking:** Split files into ~5MB chunks → enables parallel upload/download, easier repair
2. **Erasure Coding (vs simple replication):** Store k data chunks + m parity chunks → reconstruct from any k of k+m chunks (e.g., 6+3 = survive loss of 3 nodes using less space than 3x replication)
3. **Content Addressing:** Name chunks by their hash (SHA-256) → natural deduplication, integrity checks
4. **Consistent Hashing:** Assign chunks to data nodes → minimal remapping when nodes join/leave
5. **Heartbeats:** Metadata server tracks live data nodes; rereplicates chunks from failed nodes

### Trade-offs
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Replication vs Erasure Coding | Erasure coding | 50% storage overhead vs 200% for 3x replication |
| Metadata DB | Relational (PostgreSQL) | Complex queries, strong consistency needed |
| Chunk size | 5-64 MB | Balances parallelism vs metadata overhead |
| Object versioning | Append-only with version chain | Enables point-in-time recovery |

### Real-World: Amazon S3
- Stores trillions of objects across multiple availability zones
- Uses a ring-based consistent hashing scheme internally
- Applies erasure coding for cold storage tiers (S3 Glacier)
- Multipart upload API allows uploading parts in parallel and resuming failed uploads

---

## 13. Common Patterns Quick Reference

### Idempotency
Ensure repeated requests produce the same result. Critical for retries.
- Use idempotency keys (client-generated UUID sent in header)
- Server stores key + result; on duplicate, return stored result
- **Used by:** Stripe payments, Uber ride requests

### Rate Limiting Algorithms
| Algorithm | Description | Best For |
|-----------|-------------|---------|
| **Token Bucket** | Bucket fills at fixed rate; requests consume tokens | Bursty traffic OK |
| **Leaky Bucket** | Requests enter queue; processed at fixed rate | Smooth output |
| **Fixed Window Counter** | Count requests per time window | Simple; boundary spike issue |
| **Sliding Window Log** | Track exact request timestamps | Accurate; memory heavy |
| **Sliding Window Counter** | Weighted interpolation | Best balance |

### Distributed Locking
- Use Redis `SET key value NX PX timeout` for short-lived locks
- Use Zookeeper or etcd for durable, coordinated locks
- Always set TTL to prevent deadlocks on crash

### Event Sourcing
- Store all changes as immutable events; derive state by replaying
- **Pro:** Full audit log, time travel, replay for new projections
- **Con:** Complexity, eventual consistency
- **Used by:** Banking ledgers, Kafka-based architectures

### CQRS (Command Query Responsibility Segregation)
- Separate read models from write models
- Writes go to normalized DB; reads from denormalized read replicas
- **Used by:** High-traffic e-commerce (orders vs catalog)

### Saga Pattern (Distributed Transactions)
- Break distributed transaction into local transactions with compensating actions
- **Choreography:** Services emit events and react to each other
- **Orchestration:** Central coordinator directs each step
- **Used by:** Booking systems (reserve flight + hotel + car atomically)
