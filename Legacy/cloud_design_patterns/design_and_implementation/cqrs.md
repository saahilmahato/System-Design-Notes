# CQRS — Command Query Responsibility Segregation

> **Category:** Cloud Design Pattern — Design & Implementation  
> **Related Patterns:** Event Sourcing, Materialized View, Domain-Driven Design (DDD)

---

## 1. What Is CQRS?

CQRS is an architectural pattern that **separates read (Query) operations from write (Command) operations** into distinct models, data stores, or services. It challenges the traditional CRUD model where a single unified interface handles both reads and writes.

```
Traditional CRUD                     CQRS
─────────────────                    ──────────────────────────────────────────
                                     
  Client ──► Single Model            Client ──► Command Model ──► Write DB
              (Read + Write)                 └──► Query Model  ──► Read DB
              │
              ▼
           Single DB
```

- **Command** — mutates state; returns no data (e.g., `PlaceOrder`, `UpdateProfile`)
- **Query** — reads state; causes no side effects (e.g., `GetOrderById`, `ListProducts`)

---

## 2. Core Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          CLIENT                                  │
└────────────┬──────────────────────────┬──────────────────────────┘
             │  Commands                │  Queries
             ▼                          ▼
┌────────────────────┐      ┌─────────────────────────┐
│  Command Handler   │      │     Query Handler        │
│  - Validates       │      │  - Reads from read DB    │
│  - Executes logic  │      │  - Returns flat DTOs     │
│  - Writes to DB    │      │  - No business logic     │
└────────┬───────────┘      └──────────────────────────┘
         │  Domain Events               ▲
         ▼                              │ sync (async or sync)
┌─────────────────┐           ┌─────────────────────┐
│   Write Store   │ ─────────►│    Read Store(s)     │
│  (normalized,   │  Event /  │  (denormalized,      │
│   consistent)   │  Projector│   query-optimized)   │
└─────────────────┘           └─────────────────────┘
```

### Key Components

| Component | Responsibility |
|---|---|
| **Command** | Encapsulates intent to change state (`PlaceOrderCommand`) |
| **Command Handler** | Validates, applies business rules, persists to write store |
| **Domain Event** | Signals what happened (`OrderPlacedEvent`) |
| **Projector / Event Handler** | Listens to events, updates read models |
| **Query** | Encapsulates a read request (`GetOrderSummaryQuery`) |
| **Query Handler** | Reads from the read store, returns a DTO |
| **Read Store** | Denormalized, pre-aggregated views optimized for specific queries |
| **Write Store** | Normalized, consistent store optimized for writes and integrity |

---

## 3. CQRS Variants

### 3a. Simple CQRS (Same Database)
Both command and query models use **the same underlying database**, but through separate code paths (separate repositories, services, or classes).

```
Command Service ──► DB ◄── Query Service
```
- Lowest complexity, good starting point
- No eventual consistency concerns
- Minimal performance gain

### 3b. CQRS with Separate Read Stores
Write DB and Read DB are **physically separated**.

```
Write DB (PostgreSQL) ──[sync]──► Read DB (Elasticsearch / Redis)
```
- Read store can be a different technology optimized for queries
- Introduces eventual consistency

### 3c. CQRS + Event Sourcing
Commands produce **domain events** that are the source of truth. The write store is an **event log**. Read models are **projections** built from events.

```
Commands ──► Event Store (append-only log)
                 │
                 ├──► Projection A (Order Summary View)
                 ├──► Projection B (Analytics Dashboard)
                 └──► Projection C (Notification Service)
```
- Strongest form of CQRS
- Full audit trail and temporal queries
- Highest complexity

---

## 4. Implementation: Step-by-Step

### Step 1 — Define Commands & Queries

```python
# Commands (intent to mutate)
@dataclass
class PlaceOrderCommand:
    user_id: str
    items: List[OrderItem]
    shipping_address: Address

# Queries (intent to read)
@dataclass
class GetOrderSummaryQuery:
    order_id: str
    user_id: str
```

### Step 2 — Command Handler (Write Side)

```python
class PlaceOrderCommandHandler:
    def __init__(self, order_repo, event_bus):
        self.order_repo = order_repo
        self.event_bus = event_bus

    def handle(self, cmd: PlaceOrderCommand):
        # 1. Validate
        if not cmd.items:
            raise ValueError("Order must have items")

        # 2. Apply business logic
        order = Order.create(cmd.user_id, cmd.items, cmd.shipping_address)
        
        # 3. Persist to write store
        self.order_repo.save(order)
        
        # 4. Publish domain event
        self.event_bus.publish(OrderPlacedEvent(
            order_id=order.id,
            user_id=order.user_id,
            total=order.total,
            timestamp=now()
        ))
        # Returns nothing — commands don't return data
```

### Step 3 — Projector (Sync Read Store)

```python
class OrderSummaryProjector:
    def __init__(self, read_db):
        self.read_db = read_db

    def on_order_placed(self, event: OrderPlacedEvent):
        # Build a denormalized read model
        self.read_db.upsert("order_summaries", {
            "order_id": event.order_id,
            "user_id": event.user_id,
            "total": event.total,
            "status": "PLACED",
            "created_at": event.timestamp,
        })
```

### Step 4 — Query Handler (Read Side)

```python
class GetOrderSummaryQueryHandler:
    def __init__(self, read_db):
        self.read_db = read_db

    def handle(self, query: GetOrderSummaryQuery) -> OrderSummaryDTO:
        # Simple, fast read — no joins, no business logic
        row = self.read_db.find_one("order_summaries", {
            "order_id": query.order_id,
            "user_id": query.user_id
        })
        return OrderSummaryDTO(**row)
```

### Step 5 — Wire Up (Dispatcher Pattern)

```python
class CommandBus:
    def __init__(self):
        self._handlers = {}

    def register(self, command_type, handler):
        self._handlers[command_type] = handler

    def dispatch(self, command):
        handler = self._handlers.get(type(command))
        if not handler:
            raise Exception(f"No handler for {type(command)}")
        return handler.handle(command)
```

---

## 5. Technology Choices

| Layer | Options |
|---|---|
| **Write Store** | PostgreSQL, MySQL, MongoDB, DynamoDB |
| **Read Store** | Redis, Elasticsearch, Cassandra, DynamoDB, MongoDB, Materialized Views |
| **Event Bus / Message Broker** | Kafka, RabbitMQ, AWS SNS/SQS, Azure Service Bus |
| **Event Store** | EventStoreDB, Apache Kafka (log compaction), DynamoDB Streams |
| **API Layer** | REST, gRPC — commands via POST/PUT, queries via GET |

---

## 6. Consistency Model

```
User places order (Command)
        │
        ▼
  Write DB updated ──────────────────────────────► T=0ms
        │
        ▼ (async event published)
  Message broker ─────────────────────────────────► T=5ms
        │
        ▼ (projector consumes event)
  Read DB updated ─────────────────────────────────► T=20-50ms
        │
        ▼ (user queries order summary)
  Stale read possible if queried before T=50ms
```

**Mitigation strategies for stale reads:**
- Return the command result (order ID) to the client; client polls or waits
- Use a **read-your-writes** pattern: after write, redirect query to write DB for that user's session only
- Use **version tokens** / **etags**: if query result version < expected version, wait or retry
- Use **synchronous projections** for critical paths (at cost of coupling)

---

## 7. Trade-offs

### ✅ Advantages

| Benefit | Detail |
|---|---|
| **Independent scaling** | Read and write services can scale independently; read-heavy systems scale reads without touching write infrastructure |
| **Query optimization** | Read models can be tailored exactly to UI needs — no impedance mismatch |
| **Simplified query logic** | No complex JOINs or aggregations on read path; data is pre-computed |
| **Write model clarity** | Command handlers focus purely on business invariants and domain logic |
| **Multiple read models** | Same write events can produce N different read projections for different use cases |
| **Resilience** | Read side continues working even if write side is temporarily down (serves stale data) |
| **Audit trail** | Combined with Event Sourcing, you get a full history of all state changes |

### ❌ Disadvantages

| Drawback | Detail |
|---|---|
| **Eventual consistency** | Reads may be stale; not suitable for scenarios requiring strong consistency |
| **Increased complexity** | Two models, two stores, event propagation, projectors — significantly more moving parts |
| **Synchronization overhead** | Projectors must be maintained; bugs can cause read/write divergence |
| **Debugging difficulty** | Tracing a bug across command → event → projector → read model is harder |
| **Overkill for simple CRUD** | For basic create-read-update-delete with low traffic, CQRS adds unnecessary overhead |
| **Duplicate data** | Write data is duplicated into read stores; storage cost and sync complexity |
| **Schema migration complexity** | Changes to domain events require projector updates and potentially rebuilding read models |

---

## 8. When to Use / Avoid

### ✅ Use CQRS When:
- Read and write workloads have **very different scaling requirements** (e.g., 100:1 read-to-write ratio)
- The domain is **complex** with rich business logic on the write side
- You need **multiple different views** of the same data (dashboard, mobile, analytics)
- The system requires an **audit trail** (combine with Event Sourcing)
- You're using **collaborative domains** where multiple users modify overlapping data (conflict resolution via domain events)
- Building **event-driven microservices** where services communicate via events

### ❌ Avoid CQRS When:
- The domain is **simple CRUD** with no significant business logic
- **Strong consistency** is required and stale reads are not acceptable
- The team is **small or unfamiliar** with event-driven architectures
- **Low traffic** — the operational overhead isn't justified
- Early-stage product — premature optimization; start with a simple model and migrate later

---

## 9. Real-World Systems & Applications

### 9a. Microsoft Azure — Reference Architecture
Azure's official CQRS + Event Sourcing reference uses:
- **Azure Cosmos DB** as the write store (strongly consistent, per-partition)
- **Azure Service Bus** to propagate domain events
- **Azure Cognitive Search / Redis Cache** as read stores
- Used in their booking and reservation reference apps

### 9b. Uber — Dispatch & Trip Service
Uber's dispatch system processes **write commands** (request ride, update driver location) on a highly consistent write path, while **read queries** (show nearby drivers on map) are served from a separate, eventually consistent read layer (geospatial index).
- Commands: trip creation, driver assignment
- Queries: map display, ETA computation served from replicated geospatial stores

### 9c. Netflix — Viewing History & Recommendations
Netflix separates:
- **Write side**: Recording playback events (`VideoWatchedCommand`) into Kafka
- **Read side**: Recommendation engine and "Continue Watching" reads from pre-computed Cassandra stores populated by stream processors (Apache Flink/Spark consuming Kafka events)

### 9d. Shopify — Order Management
Shopify uses CQRS-like patterns in their order processing:
- **Write path**: Order placement goes through strict domain logic (inventory check, fraud detection, payment)
- **Read path**: Merchant dashboards, storefront product listings served from Elasticsearch / caching layers that are asynchronously updated

### 9e. Stack Overflow — Questions & Answers
- **Write path**: Posting a question, editing, voting are strongly consistent operations against SQL Server
- **Read path**: Question listings, search results served from Elasticsearch indexes updated asynchronously

### 9f. Banking & Financial Systems
Many core banking platforms (e.g., Monzo, Starling Bank) use CQRS + Event Sourcing:
- **Commands**: `DebitAccountCommand`, `TransferFundsCommand` processed with strong consistency
- **Events**: `MoneyDebited`, `TransferCompleted` form an immutable ledger
- **Read models**: Account balance projections, transaction history views, fraud detection models — all separate projections from the same event stream

---

## 10. CQRS vs. Related Patterns

| Pattern | Relationship to CQRS |
|---|---|
| **Event Sourcing** | Natural complement; the event log becomes the write store; CQRS doesn't require ES but they're often paired |
| **Materialized View** | The read store in CQRS IS a materialized view — pre-computed, denormalized, query-optimized |
| **Saga / Process Manager** | Used on the command side to coordinate multi-step distributed transactions across command handlers |
| **Domain-Driven Design (DDD)** | CQRS aligns with DDD's Aggregates (write side) and Read Models / Projections (read side) |
| **API Gateway** | Routes commands to write service, queries to read service; natural entry point in CQRS microservices |

---

## 11. Anti-Patterns

| Anti-Pattern | Problem |
|---|---|
| **Returning data from commands** | Violates CQS principle; couples write and read concerns |
| **Querying write store for reads** | Defeats the purpose of CQRS; read store exists to be optimized for queries |
| **Sharing domain models between command and query** | Creates tight coupling; query models should be separate flat DTOs |
| **Skipping event validation** | Events must be versioned and validated; unversioned events cause projector failures on schema change |
| **Projectors with side effects** | Projectors should only update read models — no sending emails, no triggering payments |
| **Synchronous projections everywhere** | Re-introduces coupling; only use sync projections for critical read-your-writes paths |
| **Applying CQRS to simple CRUD** | Overengineering; not every service in a system needs CQRS — apply selectively |

---

## 12. Decision Framework

```
Is the domain complex with rich
business logic on write path?
         │
    No ──┤
         │                   ──────────────────────────────────────
         │                   Don't use CQRS. Standard CRUD is fine.
         │                   ──────────────────────────────────────
        Yes
         │
         ▼
Do reads and writes have significantly
different scale requirements OR
do you need multiple read models?
         │
    No ──┤
         │                   ──────────────────────────────────────────────
         │                   Consider Simple CQRS (same DB, separate models)
         │                   ──────────────────────────────────────────────
        Yes
         │
         ▼
Is eventual consistency acceptable
for reads?
         │
    No ──┤
         │                   ───────────────────────────────────────────────────────
         │                   Reconsider CQRS or use read-your-writes / sync projections
         │                   for critical paths only.
         │                   ───────────────────────────────────────────────────────
        Yes
         │
         ▼
Do you need a full audit trail /
ability to replay state?
         │
    No ──┤
         │                   ──────────────────────────────────────────────
         │                   Use CQRS with separate read/write stores.
         │                   Sync via domain events + projectors.
         │                   ──────────────────────────────────────────────
        Yes
         │
         ▼
         ──────────────────────────────────────────────────────────────────
         Use CQRS + Event Sourcing. Event log is the source of truth.
         Build multiple projections from the event stream.
         ──────────────────────────────────────────────────────────────────
```

---

## 13. Interview Cheat Sheet

| Question | Key Answer |
|---|---|
| **What problem does CQRS solve?** | Read/write workloads have different shapes, scale, and complexity. CQRS lets you optimize each independently. |
| **What is eventual consistency in CQRS?** | After a command, the read store may lag behind by ms-seconds. Reads may be stale during sync window. |
| **When would you NOT use CQRS?** | Simple CRUD apps, small teams, strong consistency requirements, early-stage products. |
| **How does CQRS differ from traditional CRUD?** | CRUD uses one model for all operations; CQRS uses separate models, handlers, and potentially stores for reads vs. writes. |
| **What's the relationship between CQRS and Event Sourcing?** | They're complementary but independent. CQRS separates reads/writes; ES stores state as events. Together: events power projections. |
| **How do you handle read-your-writes consistency?** | Route post-write queries to write store for that session, or use version tokens to detect stale reads and retry. |
| **What's a projection?** | A read model built by consuming domain events and materializing them into a query-optimized form. |