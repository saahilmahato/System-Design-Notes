# CQRS — Command Query Responsibility Segregation

---

## 1. What Is CQRS?

CQRS is an architectural pattern that **separates the read (Query) path from the write (Command) path** of a system into distinct models, data stores, and processing pipelines. It rejects the CRUD assumption that a single model can optimally serve both reads and writes.

> Coined by Greg Young (2010), building on Bertrand Meyer's Command–Query Separation (CQS) principle:
> *"A method should either change state (command) or return a value (query) — never both."*
> CQRS scales this principle to the **architectural level**.

```
Traditional CRUD Model
──────────────────────
 Client ──▶ Single Model ──▶ Single DB
             (Read + Write)

CQRS Model
──────────
                   ┌──── Write Side ────┐
                   │  Command Handler   │
 Client ──▶ API ───┤  Domain Model      │──▶ Write DB (normalized)
                   │  Validation Logic  │         │
                   └────────────────────┘         │ Sync / Event
                                                  ▼
                   ┌──── Read Side ─────┐   Read DB (denormalized,
 Client ◀── API ───┤  Query Handler     │◀── projections, views)
                   │  Thin Read Model   │
                   └────────────────────┘
```

---

## 2. Core Concepts

### 2.1 Commands
- Represent **intent to change state**: `PlaceOrder`, `TransferFunds`, `UpdateProfile`
- Are **imperative** — named as verb phrases
- May be **rejected** (validation, business rules)
- Return **nothing** (or just an acknowledgment / command ID)
- Processed by **Command Handlers**
- Routed through a **command bus** (in-process or distributed)

### 2.2 Queries
- Represent **requests for data**: `GetOrderById`, `ListProductsByCategory`
- Are **side-effect free** — never mutate state
- Return **DTOs (Data Transfer Objects)** shaped for the consumer
- Processed by **Query Handlers**
- Read from a **dedicated read model** (optimized views, caches, projections)

### 2.3 The Write Model
- Contains **rich domain logic** — aggregates, entities, value objects
- Enforces all **invariants and business rules**
- Persists in a **normalized** relational schema or event log
- Optimized for **consistency and correctness**

### 2.4 The Read Model
- Contains **thin, anemic data structures** — no business logic
- Persists in a **denormalized** store — materialized views, document DBs, search indexes
- Optimized for **query performance and shape**
- May have **multiple projections** of the same data for different consumers
- Eventually consistent with the write model

### 2.5 Synchronization Mechanisms

| Method | Mechanism | Consistency |
|---|---|---|
| **Synchronous DB Views** | DB-level materialized views | Near-real-time |
| **Event-Driven Projection** | Domain events → projection workers | Eventually consistent |
| **Change Data Capture (CDC)** | Debezium / DB logs → read stores | Eventually consistent |
| **Dual Write** | App writes to both stores atomically | Risky without transactions |
| **Event Sourcing** | Events are the source of truth; projections rebuilt from log | Fully decoupled |

---

## 3. CQRS Architecture Patterns

### 3.1 Simple CQRS (Single DB, Separate Models)

```
┌──────────────────────────────────────────────┐
│                Application                    │
│                                               │
│  ┌─────────────┐       ┌──────────────────┐  │
│  │  Commands   │       │    Queries       │  │
│  │  Handler    │       │    Handler       │  │
│  └──────┬──────┘       └───────┬──────────┘  │
│         │                      │             │
│         └──────────┬───────────┘             │
│                    ▼                         │
│            ┌───────────────┐                 │
│            │  Single DB    │                 │
│            │ (shared store)│                 │
│            └───────────────┘                 │
└──────────────────────────────────────────────┘
```
- Simplest form — same DB, separate code paths
- Low operational overhead
- Good starting point before splitting stores

---

### 3.2 CQRS with Separate Read Store

```
 Commands ──▶ Domain Model ──▶ Write DB (PostgreSQL, normalized)
                                    │
                           Domain Events / CDC
                                    │
                                    ▼
 Queries  ◀── Query Handlers ◀── Read DB (Redis, Elasticsearch,
                                         Cassandra, MongoDB)
```
- Most common production form
- Read store is independently scalable
- Read model is purpose-built for each query pattern

---

### 3.3 CQRS + Event Sourcing (Full Pattern)

```
 Commands ──▶ Aggregate ──▶ Event Store (append-only log)
                                    │
                        ┌───────────┴────────────┐
                        ▼                        ▼
                Projection Worker A      Projection Worker B
                        │                        │
                   Read Store A             Read Store B
                 (Relational View)       (Search Index)
```
- The event log **is** the write model
- Read models are **derived projections** — fully rebuildable from the log
- Maximum auditability, temporal queries, replay capability
- Highest operational complexity

---

## 4. Command Flow — Step by Step

```
1. Client sends Command (e.g., PlaceOrderCommand { userId, items[] })
       │
2. Command Bus routes to Command Handler
       │
3. Command Handler:
   a. Loads Aggregate from Write DB / Event Store
   b. Calls domain logic (validates, applies business rules)
   c. Aggregate emits Domain Event (e.g., OrderPlacedEvent)
       │
4. Write DB persists state change (or appends event)
       │
5. Domain Event published to Message Bus (Kafka, RabbitMQ)
       │
6. Projection Workers consume events → update Read DB
       │
7. Read DB reflects new state (eventually)
```

---

## 5. Query Flow — Step by Step

```
1. Client sends Query (e.g., GetOrderSummary { orderId })
       │
2. Query Handler receives request
       │
3. Query Handler reads directly from Read DB (NO domain logic)
       │
4. Returns DTO shaped for client — no mapping needed
```

---

## 6. Data Store Selection by Side

### Write Side
| Requirement | Recommended Store |
|---|---|
| Strong consistency, ACID | PostgreSQL, MySQL |
| Event Sourcing | EventStoreDB, Kafka (log-compacted), DynamoDB Streams |
| High write throughput | Cassandra (with care), DynamoDB |

### Read Side
| Query Pattern | Recommended Store |
|---|---|
| Key lookups, counters | Redis |
| Full-text search | Elasticsearch, OpenSearch |
| Flexible document queries | MongoDB, Couchbase |
| Complex joins / reporting | Redshift, BigQuery, ClickHouse |
| API response caching | Redis, Memcached |
| Graph traversal | Neo4j |

---

## 7. Trade-offs

### 7.1 Advantages

| Advantage | Detail |
|---|---|
| **Independent scalability** | Read and write sides scale independently; most systems are read-heavy (10:1–100:1 ratio) |
| **Query optimization** | Read model shaped exactly for the consumer; no N+1, no joins at query time |
| **Domain model purity** | Write side free from read concerns; richer, expressive domain logic |
| **Technology flexibility** | Each side can use the best-fit database for its workload |
| **Event-driven enablement** | Natural integration with event sourcing, audit logs, and async workflows |
| **Fault isolation** | Read store outage doesn't affect writes; command processing continues |
| **Temporal / audit queries** | When combined with event sourcing, full history is replayable |

### 7.2 Disadvantages

| Disadvantage | Detail |
|---|---|
| **Eventual consistency** | Reads may return stale data after a write; lag is typically ms–seconds |
| **Increased complexity** | Two models, two stores, synchronization infrastructure, projection workers |
| **Operational overhead** | More services, more deployments, more failure surfaces |
| **Synchronization bugs** | Projection failures can desync read and write models |
| **Stale read UX** | "Read-your-writes" scenarios require compensation strategies |
| **Overkill for simple domains** | CRUD apps with no scaling needs gain nothing from CQRS |
| **Eventual consistency debugging** | Harder to reason about system state at a given point in time |

### 7.3 When to Use CQRS

```
✅ USE CQRS WHEN:
   - Read:Write ratio is highly asymmetric (>5:1)
   - Read and write workloads have very different performance requirements
   - The domain is complex with rich business rules
   - You need multiple read models / projections of the same data
   - Event sourcing or audit log is a requirement
   - You need independent scalability of read and write paths
   - Multiple teams own different bounded contexts

❌ AVOID CQRS WHEN:
   - Simple CRUD domain with no complex business logic
   - Team is small and operational complexity is a constraint
   - Strong consistency is required for reads immediately after writes
   - Data model is simple and read/write shapes are the same
   - Early-stage product where simplicity > scalability
```

---

## 8. Handling Eventual Consistency

### 8.1 Read-Your-Writes Problem
After a user submits a command, the read model may not yet reflect the change.

**Strategies:**

| Strategy | Implementation |
|---|---|
| **Optimistic UI** | Client assumes success and updates UI immediately; rollback on failure |
| **Wait for projection** | Poll read model until updated (with timeout) |
| **Version tokens** | Command returns a version; query waits until read model reaches that version |
| **Read from write side** | For the user who just wrote, read from the write DB for a brief window |
| **Sticky sessions** | Route user reads to a replica with guaranteed freshness |

### 8.2 Projection Failure Recovery
```
Event Log (immutable) ──▶ Projection Worker ──▶ Read Store
                               │
                         Dead Letter Queue
                               │
                         Retry / Replay
```
- Since events are **immutable and replayable**, projections can always be **rebuilt from scratch**
- Store the last processed event offset per projection
- Use idempotent projection handlers

---

## 9. CQRS + Event Sourcing Relationship

CQRS and Event Sourcing are **complementary but independent**:

```
┌────────────────┬──────────────────────────────────────────────────┐
│ Combination    │ Description                                       │
├────────────────┼──────────────────────────────────────────────────┤
│ CQRS alone     │ Separate read/write models; write side uses       │
│                │ traditional state-based persistence               │
├────────────────┼──────────────────────────────────────────────────┤
│ Event Sourcing │ All state changes stored as events; no CQRS;      │
│ alone          │ queries hit the event store directly (rare)       │
├────────────────┼──────────────────────────────────────────────────┤
│ CQRS + ES      │ Write side = event log; read side = projections   │
│ (full pattern) │ built from events. Most powerful, most complex.   │
└────────────────┴──────────────────────────────────────────────────┘
```

---

## 10. Implementation Patterns

### 10.1 Command Bus (in-process)

```python
# Python example — Mediatr-style
class PlaceOrderCommand:
    def __init__(self, user_id: str, items: list):
        self.user_id = user_id
        self.items = items

class PlaceOrderHandler:
    def handle(self, cmd: PlaceOrderCommand) -> str:
        order = Order.create(cmd.user_id, cmd.items)  # domain logic
        self.repo.save(order)
        self.event_bus.publish(OrderPlacedEvent(order.id))
        return order.id  # command ID only

# Query Handler — no domain logic
class GetOrderSummaryHandler:
    def handle(self, query: GetOrderSummaryQuery) -> OrderSummaryDTO:
        return self.read_repo.find_summary(query.order_id)  # thin read
```

### 10.2 Projection Worker

```python
# Kafka consumer projecting events into a read store
class OrderProjection:
    def on_order_placed(self, event: OrderPlacedEvent):
        self.read_db.upsert("orders_summary", {
            "id": event.order_id,
            "user_id": event.user_id,
            "total": event.total,
            "status": "PLACED",
            "placed_at": event.timestamp
        })

    def on_order_shipped(self, event: OrderShippedEvent):
        self.read_db.update("orders_summary",
            where={"id": event.order_id},
            set={"status": "SHIPPED", "shipped_at": event.timestamp}
        )
```

### 10.3 API Layer Separation

```
POST /orders          ──▶  Command API  ──▶  Command Bus
GET  /orders/{id}     ──▶  Query API   ──▶  Read Store
GET  /orders?userId=  ──▶  Query API   ──▶  Read Store (indexed)
```

---

## 11. Framework & Library Support

| Language | Library / Framework |
|---|---|
| .NET | MediatR, NServiceBus, Axon Framework |
| Java | Axon Framework, Spring CQRS, Lagom |
| Python | eventsourcing lib, custom mediator |
| Node.js | NestJS CQRS module, node-cqrs |
| Go | Custom (idiomatic); watermill for messaging |
| Kotlin | Axon Framework, Ktor with custom CQRS |

---

## 12. Real-World Systems & Applications

### 12.1 Microsoft Azure — Reservation & Billing Systems
- Azure's internal billing pipeline separates command processing (usage events) from read projections (billing dashboards)
- The Azure CQRS pattern is documented as a **first-class cloud design pattern** in Azure Architecture Center
- Azure Cosmos DB and Azure Service Bus are commonly used for the read/write split

### 12.2 Uber — Trip Lifecycle
```
Command Side:
  RequestTrip, AcceptTrip, StartTrip, EndTrip
  ──▶ Trip Aggregate (enforces state machine)
  ──▶ Write DB + Event Kafka topic

Read Side:
  GetTripStatus, GetTripHistory, DriverDashboard
  ──▶ Separate Cassandra / Redis projections
  ──▶ No joins, no domain logic — pure read models
```
- Uber's system handles millions of concurrent trips; read:write ratio is extreme
- Multiple read projections (driver view, rider view, ops dashboard) from same event stream

### 12.3 Netflix — Content Catalog & Streaming Events
- Content metadata writes go through a command pipeline (content ingestion, encoding jobs)
- Read side: **Elasticsearch** for search, **EVCache (Redis)** for fast catalog lookups
- Viewing events (play, pause, stop) are commands → written to Kafka → projected into personalization models and billing
- The recommendation system consumes projections, never writes

### 12.4 Shopify — Orders & Inventory
- High-volume merchants generate write-heavy order streams during flash sales
- Shopify separates order command processing from merchant read dashboards
- Inventory counters use **optimistic locking on the write side**
- Merchant analytics are built from **read projections** over Kafka streams into data warehouses

### 12.5 Stack Overflow — Q&A Platform
- Votes, answers, and edits are commands processed through a write model
- The "question page" is a heavily denormalized read model — vote counts, answer counts, tags pre-joined
- Employs **read replicas** as the read side with periodic cache invalidation
- Traffic ratio: ~50:1 reads to writes during peak

### 12.6 Stripe — Payments
- Payment commands (`ChargeCard`, `RefundCharge`, `CreatePayout`) go through strict command handlers with idempotency keys
- The write model enforces financial invariants (balance checks, fraud rules)
- Read side: customer dashboards, reporting APIs, webhook delivery — all separate projections
- Event log is kept for **regulatory compliance and dispute resolution** — classic event sourcing use case

### 12.7 LinkedIn — Feed & Notifications
- Social graph writes (connections, likes, posts) are commands
- Feed generation is a read projection — pre-computed for each user
- LinkedIn's **Espresso** (write) and **Voldemort** (read cache) reflect the CQRS split at infra level

---

## 13. CQRS in Microservices

```
  Order Service                 Inventory Service
  ─────────────                 ─────────────────
  Commands:                     Subscribes to:
  PlaceOrder ──▶ Event Bus ──▶  OrderPlaced event
  CancelOrder                   ──▶ Reserve inventory
                                ──▶ Update read model
  Queries:
  GetOrder ──▶ Own Read DB      GetInventory ──▶ Own Read DB
```

- Each microservice owns its **command model and read model**
- Services communicate **via events**, never direct DB access
- Enables **independent deployment and scaling** per service
- Aligns with **database-per-service** and **event-driven architecture** patterns

---

## 14. Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Querying the write model** | Bypasses read optimization; couples concerns | Always route reads to read model |
| **Commands returning data** | Violates CQS; creates coupling | Return only command ID / status; query separately |
| **Synchronous projection** | Blocks command processing on read update | Make projection async; accept eventual consistency |
| **Single projection for all consumers** | One "fat" read model poorly serves all consumers | Build separate projections per consumer/view |
| **CQRS for simple CRUD** | Adds complexity with zero benefit | Use CQRS only when domain justifies it |
| **Skipping idempotency in handlers** | Duplicate events create duplicate state | Always make projection handlers idempotent |
| **Missing event versioning** | Schema changes break old projections | Version events; write migration handlers |

---

## 15. CQRS Decision Framework

```
Does your domain have complex business rules?
    │
    ├── NO  ──▶ Use simple CRUD. Skip CQRS.
    │
    └── YES
          │
          ▼
    Are read patterns significantly different from write shape?
          │
          ├── NO  ──▶ Single model with read replicas may suffice.
          │
          └── YES
                │
                ▼
          Is read:write ratio >5:1 or do they need independent scaling?
                │
                ├── NO  ──▶ Shared DB with separate code paths (Simple CQRS).
                │
                └── YES
                      │
                      ▼
                Do you need full audit trail or temporal queries?
                      │
                      ├── NO  ──▶ CQRS with separate read store (CDC/Events).
                      │
                      └── YES ──▶ CQRS + Event Sourcing (full pattern).
```

---

## 16. Interview Cheat Sheet

| Question | Key Answer |
|---|---|
| What problem does CQRS solve? | Mismatch between read/write models; read:write asymmetry; domain complexity |
| How does CQRS differ from CQS? | CQS is method-level; CQRS is architecture-level — separate models, separate stores |
| What is a projection? | A read model built by consuming domain events and denormalizing data for queries |
| What consistency guarantee does CQRS provide? | Eventual consistency for reads; strong consistency on the write side |
| How do you handle read-your-writes? | Optimistic UI, version tokens, read from write side temporarily, polling |
| Is CQRS always paired with Event Sourcing? | No — they are complementary but independent; CQRS can use state-based persistence |
| When should you avoid CQRS? | Simple CRUD, small teams, strong consistency requirements, homogeneous read/write shapes |
| How do you recover from projection failure? | Replay events from the event log; projections are always rebuildable |
| What's the biggest operational risk of CQRS? | Read/write model divergence due to projection lag or failure |
| How does CQRS relate to microservices? | Each service owns its command and read model; services integrate via events, never shared DBs |