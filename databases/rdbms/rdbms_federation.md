# RDBMS: Federation (Functional Partitioning)

---

## What is Federation?

**Federation** (also called **functional partitioning**) splits a single monolithic database into **multiple smaller databases, each organized around a specific domain or business function**.

Instead of one giant database serving all features, you have:
- A **Users DB** for identity and auth
- A **Products DB** for catalog and inventory
- An **Orders DB** for transactions
- A **Analytics DB** for reporting

Each database is independently deployable, scalable, and owned by a separate team or service.

```
         ❌ MONOLITHIC DATABASE
┌──────────────────────────────────┐
│                                  │
│  Users + Orders + Products +     │
│  Payments + Analytics + ...      │
│                                  │
│  Single connection pool          │
│  Single bottleneck               │
└──────────────────────────────────┘


         ✅ FEDERATED DATABASES
┌────────────┐  ┌────────────┐  ┌────────────┐
│  Users DB  │  │ Orders DB  │  │Products DB │
│            │  │            │  │            │
│  auth      │  │  checkout  │  │  catalog   │
│  profiles  │  │  payments  │  │  inventory │
└────────────┘  └────────────┘  └────────────┘
       │               │               │
       └───────────────┴───────────────┘
               Application Layer
             (joins done in code)
```

---

## Core Concepts

### Functional Domain Boundaries
Each federated database maps to a **bounded context** — a well-defined domain with clear ownership. This aligns with Domain-Driven Design (DDD) principles and microservice architectures.

### No Shared Schema
Databases do not share tables or schemas. Cross-domain data access happens through:
- **API calls** between services
- **Eventual consistency** via events/messages
- **Application-level joins** in code

### Independent Connection Pools
Each database has its own connection pool. This eliminates the single connection bottleneck that plagues monolithic databases.

```
Monolith:
App → [Single Pool: 100 conns] → One DB
           (all domains compete)

Federation:
App → [Pool: 30 conns] → Users DB
App → [Pool: 30 conns] → Orders DB
App → [Pool: 40 conns] → Products DB
       (domains isolated, independently tuned)
```

---

## Why Federation?

### The Monolithic DB Problem at Scale

As a system grows, a single database faces:
- **Write contention** — all writes compete for locks on the same server
- **Connection exhaustion** — thousands of app instances overwhelm a single pool
- **Schema coupling** — teams block each other deploying changes
- **Scaling limits** — vertical scaling (bigger machine) has a ceiling
- **Blast radius** — one bad query or migration can bring down all features

Federation directly addresses each of these by splitting along domain lines.

---

## Federation vs. Sharding

| Dimension | Federation | Sharding |
|---|---|---|
| **Split dimension** | By function/domain | By data (e.g., user_id range) |
| **Schema** | Different schema per DB | Same schema per shard |
| **Use case** | Different features | Same feature, more data |
| **Joins** | Cross-domain API calls | Cross-shard scatter-gather |
| **Ownership** | Per-team / per-service | Infrastructure-owned |
| **When to use** | Domain boundaries are clear | Single domain is too large |

> Federation and sharding are **complementary** — you can federate by domain first, then shard within a domain if one domain grows too large (e.g., sharding the Orders DB by region).

---

## Trade-offs

### ✅ Advantages

**Eliminates single write bottleneck**
- Each domain's database handles only its own writes
- No cross-domain write contention or lock conflicts

**Independent scaling**
- Scale each database according to its own load profile
- Orders DB can scale aggressively during peak sales without affecting Users DB

**Reduced connection pool pressure**
- Smaller, purpose-specific connection pools per database
- Easier to tune pool sizes per domain's latency/throughput profile

**Schema independence**
- Teams can evolve their schema without coordinating cross-team migrations
- Faster deployment cycles per domain

**Better fault isolation**
- A crashing Orders DB doesn't take down authentication
- Failures are bounded to a single domain

**Aligns with microservices**
- Natural fit for service-oriented architectures
- One service → one database → clear ownership boundary

**Performance tuning per domain**
- Read-heavy domains (catalog) can use aggressive caching and read replicas
- Write-heavy domains (orders) can be tuned for write throughput

---

### ❌ Disadvantages

**No cross-database joins**
- JOIN across the Users DB and Orders DB is impossible at the database level
- Must be done in application code, which is slower and more complex
- Risk of N+1 query patterns if not handled carefully

**Distributed transactions are hard**
- ACID guarantees don't span databases
- Cross-domain operations (e.g., create order + deduct inventory) require:
  - Two-phase commit (2PC) — complex and slow
  - Saga pattern — eventual consistency, more code
  - Compensating transactions — complex rollback logic

**Data consistency challenges**
- Referential integrity (foreign keys) cannot be enforced across databases
- Duplicate data (e.g., storing user_name in Orders DB) leads to sync complexity
- Must embrace eventual consistency for cross-domain data

**Increased operational complexity**
- More databases to provision, monitor, back up, and patch
- More connection strings, credentials, and failover configurations to manage
- Infrastructure cost increases

**Application-level complexity**
- Developers must manually aggregate data across databases
- Bugs in cross-domain aggregation are harder to detect and debug
- Caching strategies must span multiple data sources

**Latency on aggregated queries**
- A report spanning users + orders + products requires multiple DB round-trips
- Typically solved by a separate analytics/data warehouse that aggregates all domains

---

## When to Use Federation

**Use when:**
- Your application has clear domain boundaries (users, orders, products, payments)
- You're building or migrating to a microservices architecture
- A single database is becoming a write bottleneck
- Teams are blocking each other with schema migrations
- Different domains have wildly different scaling requirements

**Avoid when:**
- Your application requires frequent cross-domain joins (federation will hurt you)
- You're at early stages — premature federation adds complexity with little gain
- Your team lacks operational maturity to manage multiple databases
- Strong cross-domain transactional consistency is a hard requirement

---

## Practical Design Patterns

### Pattern 1: API-Based Cross-Domain Access
Services never query another domain's database directly. They call that domain's API.

```
OrderService needs user email:
  ❌ SELECT email FROM users_db.users WHERE id = 42
  ✅ GET /users/42  →  UserService  →  Users DB  →  { email: "..." }
```

### Pattern 2: Event-Driven Denormalization
Domains publish events. Consuming services cache the data they need locally.

```
UserService publishes:
  { event: "user.updated", user_id: 42, name: "Alice", email: "..." }

OrderService subscribes and stores locally:
  orders_db.user_cache: { user_id: 42, name: "Alice" }
  (accepts eventual consistency — avoids live cross-DB call)
```

### Pattern 3: Saga Pattern for Distributed Transactions
Break distributed transactions into a sequence of local transactions with compensating rollbacks.

```
PlaceOrder Saga:
  Step 1: Orders DB     → Create order (status: PENDING)
  Step 2: Inventory DB  → Reserve items
    ↳ Fail? → Compensate: Cancel order in Orders DB
  Step 3: Payments DB   → Charge card
    ↳ Fail? → Compensate: Release inventory + cancel order
  Step 4: Orders DB     → Update order (status: CONFIRMED)
```

### Pattern 4: Analytics Read Layer
Stand up a separate read-optimized store (data warehouse, Redshift, BigQuery) that aggregates all federated databases for cross-domain reporting.

```
Users DB  ──┐
Orders DB ──┼──→  ETL/CDC Pipeline  →  Data Warehouse  →  Analytics
Products DB─┘         (Debezium, Kafka)     (BigQuery, Redshift)
```

---

## Real-World Examples

### Amazon
Amazon pioneered federated databases as they decomposed their monolith into services. Each major business domain (catalog, orders, recommendations, payments, fulfillment) runs its own database. Cross-domain data needs are resolved via APIs — their famous "you must communicate through APIs only" mandate from Jeff Bezos made federation the default.

### Netflix
Netflix runs federated databases across its microservices. User profiles, content metadata, viewing history, billing, and recommendations are all managed by separate services with separate databases. Each domain is independently scaled — content metadata is read-heavy and cached aggressively, while billing runs strongly consistent transactions in isolation.

### Uber
Uber's platform is decomposed into domain-specific services (trips, drivers, payments, notifications, maps). Each domain owns its data store. Cross-domain consistency (e.g., completing a trip and charging a payment) is handled via sagas and event-driven patterns rather than distributed transactions.

### Shopify
Shopify's multi-tenant architecture federates databases at both the functional level (products, orders, customers, payments as separate domains) and across tenant "pods." Each shop's critical data is isolated, enabling independent failover and scaling per merchant.

### GitHub
GitHub federates along service boundaries — repositories, pull requests, CI/CD (Actions), packages, and identity are all separate systems with separate data stores. This allows, for example, GitHub Actions to scale independently of repository storage during large CI workloads.

---

## Federation in the System Design Interview

### When the Interviewer Says "Your DB is a Bottleneck"

**Decision flowchart:**
```
Is the bottleneck reads or writes?
├── Reads only?
│   └── Add read replicas → Caching (Redis) → CDN
└── Writes or both?
    └── Are there clear domain boundaries?
        ├── Yes → Federation (split by domain)
        └── No / Single domain is huge → Sharding (split by data key)
```

### Key Points to Mention
- Federation splits by **function**, sharding splits by **data**
- Cross-domain joins must move to **application code or event-driven denormalization**
- Distributed transactions require **Saga pattern** or eventual consistency
- Pair federation with a **data warehouse** for analytics queries
- Align federation boundaries with **microservice ownership**

### Common Pitfalls to Avoid (in interviews)
- Don't split too early — federation adds operational overhead
- Don't cross-call databases directly between services
- Don't assume ACID transactions work across federated databases

---

## Quick Reference Summary

| Property | Value |
|---|---|
| **Split strategy** | By business domain / function |
| **Schema** | Different per database |
| **Cross-domain joins** | Application-level only |
| **Transactions** | Local ACID only; Saga for distributed |
| **Consistency model** | Strong within domain; eventual across domains |
| **Best pairing** | Microservices, DDD, event-driven architecture |
| **Complements** | Sharding (within domain), read replicas, caching |
| **Main benefit** | Eliminates write bottleneck, enables independent scaling |
| **Main cost** | Complexity of cross-domain data access and consistency |