# Event Sourcing — Cloud Design Pattern: Data Management

---

## 1. Overview

**Event Sourcing** is a data management pattern where **state changes are stored as an immutable, append-only sequence of events** rather than persisting only the current state of an entity. Instead of updating a row in a database, you record the *fact that something happened*. The current state of any entity is derived by **replaying** all past events from the beginning (or from a snapshot).

> **Core Insight:** Traditional systems store *current state* (what things look like now). Event Sourcing stores *history* (what happened, in order). Current state becomes a derived, computed artifact.

### Analogy

| Approach | Real-World Equivalent |
|---|---|
| Traditional CRUD | Bank balance: only see current balance |
| Event Sourcing | Bank ledger: every debit/credit recorded; balance derived by summing all entries |

---

## 2. Core Concepts

### 2.1 Events

- **Immutable facts** — past tense, describing what happened: `OrderPlaced`, `ItemShipped`, `PaymentFailed`
- Carry enough data to reconstruct state without querying other sources
- Have a **timestamp**, **event type**, **aggregate ID**, **sequence number**, and **payload**

```json
{
  "eventId": "uuid-123",
  "aggregateId": "order-456",
  "eventType": "OrderPlaced",
  "version": 1,
  "occurredAt": "2024-11-01T10:00:00Z",
  "payload": {
    "customerId": "cust-789",
    "items": [{ "sku": "BOOK-001", "qty": 2, "price": 29.99 }],
    "totalAmount": 59.98
  }
}
```

### 2.2 Event Store

The **append-only database** where events are persisted. Key properties:

- **Append-only:** events are never updated or deleted
- **Ordered:** events within an aggregate have a strict sequence
- **Addressable:** query by aggregate ID or global event stream

### 2.3 Aggregate

A domain object (e.g., `Order`, `Account`, `Cart`) whose state is rebuilt by replaying its event history. The aggregate is the **unit of consistency**.

### 2.4 Projections / Read Models

**Derived views** built by processing the event stream. They are:
- Optimized for specific query patterns
- Rebuilt from scratch at any time (events are the source of truth)
- Eventually consistent with the event store

### 2.5 Event Stream

```
Global Event Stream:
──────────────────────────────────────────────────────────▶ time
  [OrderPlaced] [PaymentProcessed] [OrderShipped] [Delivered]
       v=1             v=2               v=3          v=4
       └──────────── Aggregate: order-456 ──────────────┘
```

---

## 3. Architecture

### 3.1 High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                          WRITE SIDE                                │
│                                                                    │
│  Client  ──▶  Command Handler  ──▶  Aggregate (load + apply)       │
│                                          │                         │
│                                          ▼                         │
│                                   [ Event Store ]                  │
│                                   (append-only)                    │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ Event Stream
                           ▼
┌────────────────────────────────────────────────────────────────────┐
│                          READ SIDE                                 │
│                                                                    │
│  Event Bus / Message Broker                                        │
│       │                                                            │
│       ├──▶  Projection A (orders-by-customer view)                 │
│       ├──▶  Projection B (inventory-summary view)                  │
│       ├──▶  Projection C (analytics dashboard)                     │
│       └──▶  Process Manager / Saga (cross-aggregate workflows)     │
│                                                                    │
│  Read DB (SQL / NoSQL / Search Index / Cache)                      │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 Command → Event → State Flow

```
1. Command Arrives          2. Load Aggregate           3. Validate & Decide
   PlaceOrder(items, price)    Replay past events           Business rules pass?
         │                     from Event Store              │
         ▼                          │                        ▼
   Command Handler   ◀─────────────┘              4. Emit New Event(s)
                                                     OrderPlaced { ... }
                                                          │
                                              5. Append to Event Store
                                                          │
                                              6. Publish to Event Bus
                                                          │
                                    ┌─────────────────────┴──────────────────┐
                                    ▼                                        ▼
                             Projection Handler                    Downstream Services
                             (update read model)                   (send email, reserve stock)
```

### 3.3 Event Store Schema

```sql
CREATE TABLE event_store (
    id            UUID         PRIMARY KEY,
    aggregate_id  UUID         NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    event_type    VARCHAR(100) NOT NULL,
    version       BIGINT       NOT NULL,
    payload       JSONB        NOT NULL,
    metadata      JSONB,
    occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    UNIQUE (aggregate_id, version)   -- optimistic concurrency
);

CREATE INDEX idx_aggregate ON event_store (aggregate_id, version);
CREATE INDEX idx_global_seq ON event_store (occurred_at, id);
```

---

## 4. Implementation Patterns

### 4.1 Aggregate with Event Sourcing (Python)

```python
from dataclasses import dataclass, field
from typing import List
from datetime import datetime
import uuid

# ─── Events ───────────────────────────────────────────────────────────
@dataclass
class OrderPlaced:
    aggregate_id: str
    customer_id: str
    total_amount: float
    occurred_at: datetime = field(default_factory=datetime.utcnow)
    version: int = 1

@dataclass
class PaymentProcessed:
    aggregate_id: str
    payment_id: str
    occurred_at: datetime = field(default_factory=datetime.utcnow)
    version: int = 0

@dataclass
class OrderShipped:
    aggregate_id: str
    tracking_number: str
    occurred_at: datetime = field(default_factory=datetime.utcnow)
    version: int = 0

# ─── Aggregate ────────────────────────────────────────────────────────
class Order:
    def __init__(self):
        self.id = None
        self.customer_id = None
        self.total_amount = 0.0
        self.status = "UNINITIALIZED"
        self.payment_id = None
        self.tracking_number = None
        self._version = 0
        self._pending_events: List = []

    # ── Command Handlers ──────────────────────────────────────────────
    def place(self, customer_id: str, total_amount: float):
        if self.status != "UNINITIALIZED":
            raise Exception("Order already placed")
        event = OrderPlaced(
            aggregate_id=str(uuid.uuid4()),
            customer_id=customer_id,
            total_amount=total_amount,
            version=self._version + 1
        )
        self._apply(event)
        self._pending_events.append(event)

    def process_payment(self, payment_id: str):
        if self.status != "PENDING":
            raise Exception("Cannot process payment in state: " + self.status)
        event = PaymentProcessed(
            aggregate_id=self.id,
            payment_id=payment_id,
            version=self._version + 1
        )
        self._apply(event)
        self._pending_events.append(event)

    # ── Event Applicators (pure state transitions) ─────────────────────
    def _apply(self, event):
        if isinstance(event, OrderPlaced):
            self.id = event.aggregate_id
            self.customer_id = event.customer_id
            self.total_amount = event.total_amount
            self.status = "PENDING"
        elif isinstance(event, PaymentProcessed):
            self.payment_id = event.payment_id
            self.status = "PAID"
        elif isinstance(event, OrderShipped):
            self.tracking_number = event.tracking_number
            self.status = "SHIPPED"
        self._version = event.version

    # ── Reconstitution from Event Store ───────────────────────────────
    @classmethod
    def load_from_history(cls, events: List) -> "Order":
        order = cls()
        for event in events:
            order._apply(event)
        return order
```

### 4.2 Event Store Repository (Python)

```python
import json
from typing import List, Optional

class EventStore:
    def __init__(self, db_conn):
        self.db = db_conn

    def append(self, aggregate_id: str, events: List, expected_version: int):
        """Append events with optimistic concurrency check."""
        for i, event in enumerate(events):
            try:
                self.db.execute("""
                    INSERT INTO event_store
                        (id, aggregate_id, aggregate_type, event_type, version, payload, occurred_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    str(uuid.uuid4()),
                    aggregate_id,
                    type(event).__module__,
                    type(event).__name__,
                    expected_version + i + 1,
                    json.dumps(event.__dict__),
                    event.occurred_at
                ))
            except UniqueViolationError:
                raise ConcurrencyConflict(
                    f"Version conflict on aggregate {aggregate_id}"
                )

    def load(self, aggregate_id: str, from_version: int = 0) -> List:
        """Load all events for an aggregate, optionally from a version."""
        rows = self.db.query("""
            SELECT event_type, payload, version
            FROM event_store
            WHERE aggregate_id = %s AND version > %s
            ORDER BY version ASC
        """, (aggregate_id, from_version))
        return [self._deserialize(row) for row in rows]

    def _deserialize(self, row):
        EVENT_MAP = {
            "OrderPlaced": OrderPlaced,
            "PaymentProcessed": PaymentProcessed,
            "OrderShipped": OrderShipped,
        }
        cls = EVENT_MAP[row["event_type"]]
        return cls(**json.loads(row["payload"]))
```

### 4.3 Projection Builder (TypeScript)

```typescript
// Read model for "orders by customer"
interface OrderSummary {
  orderId: string;
  customerId: string;
  totalAmount: number;
  status: string;
  trackingNumber?: string;
}

class OrdersByCustomerProjection {
  private store: Map<string, OrderSummary[]> = new Map();

  handle(event: DomainEvent): void {
    switch (event.eventType) {
      case "OrderPlaced": {
        const { aggregateId, customerId, totalAmount } = event.payload;
        const orders = this.store.get(customerId) ?? [];
        orders.push({ orderId: aggregateId, customerId, totalAmount, status: "PENDING" });
        this.store.set(customerId, orders);
        break;
      }
      case "PaymentProcessed": {
        this.updateStatus(event.aggregateId, "PAID");
        break;
      }
      case "OrderShipped": {
        this.updateStatusAndTracking(
          event.aggregateId,
          "SHIPPED",
          event.payload.trackingNumber
        );
        break;
      }
    }
  }

  private updateStatus(orderId: string, status: string): void {
    // Scan all customer buckets — in prod this would be indexed
    for (const [customerId, orders] of this.store.entries()) {
      const order = orders.find(o => o.orderId === orderId);
      if (order) { order.status = status; return; }
    }
  }

  getOrdersForCustomer(customerId: string): OrderSummary[] {
    return this.store.get(customerId) ?? [];
  }
}
```

### 4.4 Snapshots (Performance Optimization)

For aggregates with thousands of events, replaying from the beginning is expensive. **Snapshots** checkpoint the state periodically.

```
Without Snapshots:
  Replay events 1..1000 → current state   (slow)

With Snapshots:
  Load snapshot at v=900 → replay events 901..1000  (fast)

Snapshot Strategy:
  - Every N events (e.g., every 100 events)
  - After specific domain events (e.g., OrderClosed)
  - Time-based (e.g., nightly for active aggregates)
```

```python
class SnapshotStore:
    def save(self, aggregate_id: str, state: dict, version: int):
        self.db.upsert("snapshots", {
            "aggregate_id": aggregate_id,
            "state": json.dumps(state),
            "version": version,
            "created_at": datetime.utcnow()
        })

    def load(self, aggregate_id: str) -> Optional[dict]:
        return self.db.query_one("""
            SELECT state, version FROM snapshots
            WHERE aggregate_id = %s
            ORDER BY version DESC LIMIT 1
        """, (aggregate_id,))


class OrderRepository:
    def load(self, aggregate_id: str) -> Order:
        snapshot = self.snapshot_store.load(aggregate_id)
        from_version = 0
        order = Order()

        if snapshot:
            order = Order.from_snapshot(snapshot["state"])
            from_version = snapshot["version"]

        events = self.event_store.load(aggregate_id, from_version)
        for event in events:
            order._apply(event)

        return order
```

---

## 5. Event Sourcing + CQRS

Event Sourcing is almost always paired with **CQRS (Command Query Responsibility Segregation)** — the write model is the event store; read models are projections.

```
┌──────────────────────────────────────────────────────────────────┐
│                        CQRS + Event Sourcing                     │
│                                                                  │
│   COMMANDS                          QUERIES                      │
│   (Write Side)                      (Read Side)                  │
│                                                                  │
│  PlaceOrder ──▶ Aggregate           GET /orders/:id              │
│  CancelOrder ──▶ Aggregate          GET /customers/:id/orders    │
│  ShipOrder ──▶ Aggregate                  │                      │
│       │                             Read Model DB                │
│       ▼                             (PostgreSQL / Redis /        │
│  [ Event Store ]  ──────────▶        Elasticsearch)             │
│  (append-only,      Event            │                           │
│   single source     Stream           └── Projection rebuilds     │
│   of truth)                              from event store        │
└──────────────────────────────────────────────────────────────────┘
```

| | Commands (Write) | Queries (Read) |
|---|---|---|
| **Storage** | Event Store (append-only) | Denormalized read DB |
| **Consistency** | Strong (within aggregate) | Eventual |
| **Schema** | Normalized event structure | Query-optimized |
| **Scalability** | Write throughput | Read throughput |

---

## 6. Trade-offs

### 6.1 Advantages

| Advantage | Description |
|---|---|
| **Complete Audit Trail** | Every state change is recorded; full history is always available — critical for finance, healthcare, compliance |
| **Temporal Queries** | Reconstruct the state of any entity at any point in time ("what did this order look like at 3pm yesterday?") |
| **Event Replay** | Reprocess historical events to fix bugs, populate new projections, or migrate data — without data loss |
| **Decoupled Consumers** | New projections or services can be added without modifying the write path; subscribe to the event stream |
| **Debugging & Root Cause** | Full causal chain available — reproduce any bug by replaying the exact event sequence |
| **Concurrency Safety** | Optimistic concurrency with version numbers prevents lost updates |
| **Natural Fit for DDD** | Aligns with Domain-Driven Design aggregates, bounded contexts, and domain events |
| **Resilience** | Events are the source of truth; read models can be fully rebuilt if corrupted |

### 6.2 Disadvantages

| Disadvantage | Description |
|---|---|
| **Accidental Complexity** | Significantly more moving parts than CRUD — event store, projections, sagas, event bus |
| **Eventual Consistency** | Read models lag behind writes; requires tolerance for stale reads |
| **Event Schema Evolution** | Changing event shapes is painful; requires upcasting, versioning, or migration strategies |
| **Steep Learning Curve** | Teams unfamiliar with DDD/CQRS/ES face a long ramp-up period |
| **Query Complexity** | Ad-hoc queries on current state require pre-built projections; no simple `SELECT * WHERE` |
| **Growing Event Store** | Event log grows unboundedly; archiving and compaction strategies required at scale |
| **Idempotency Required** | Projection handlers and downstream consumers must handle duplicate event delivery |
| **Debugging Overhead** | Tracing a bug across events, projections, sagas adds complexity vs. direct DB inspection |

### 6.3 When to Use vs. Avoid

```
USE Event Sourcing when:                AVOID Event Sourcing when:
──────────────────────────────────      ──────────────────────────────────
✔ Audit log is a hard requirement       ✘ Simple CRUD with no history needs
✔ Temporal queries needed               ✘ Small team, tight timeline
✔ Complex domain with DDD aggregates    ✘ No eventual consistency tolerance
✔ Multiple downstream consumers        ✘ Heavy ad-hoc reporting on current state
✔ Undo / redo / replay needed           ✘ Team unfamiliar with the pattern
✔ Event-driven microservices            ✘ Data that changes extremely frequently
                                          with no historical value
```

---

## 7. Event Schema Evolution

One of the hardest operational challenges in Event Sourcing.

### Strategies

```
Strategy 1: Upcasting (Lazy Migration)
  ─ Old events are read and transformed on-the-fly to the new schema
  ─ Event store remains unchanged; transformation applied in the reader
  ─ Good for small schema changes

  v1 Event: { "name": "John Doe" }
  Upcaster: split "name" → { "firstName": "John", "lastName": "Doe" }
  v2 Event: { "firstName": "John", "lastName": "Doe" }


Strategy 2: Versioned Event Types
  ─ New event type introduced: OrderPlacedV2
  ─ Old events remain as OrderPlacedV1
  ─ Projection handles both versions
  ─ Clean but adds type proliferation


Strategy 3: Copy-Transform Migration
  ─ Read all old events, transform, write new events to a new store
  ─ Expensive but produces a clean event log
  ─ Appropriate for major domain model redesigns


Strategy 4: Weak Schema (JSON/Avro with optional fields)
  ─ Use additive-only changes; new optional fields with defaults
  ─ Simplest approach; breaks down for structural changes
```

---

## 8. Sagas and Process Managers

For workflows that span **multiple aggregates**, Event Sourcing uses **Sagas** (choreography) or **Process Managers** (orchestration).

```
Order Fulfillment Saga:

  [OrderPlaced]
       │
       ▼
  Reserve Inventory  ──▶ [InventoryReserved] ──▶ Process Payment
                     ──▶ [InventoryFailed]   ──▶ Cancel Order

  [PaymentProcessed] ──▶ Ship Order
  [PaymentFailed]    ──▶ Release Inventory → Cancel Order
```

```python
class OrderFulfillmentSaga:
    """Process Manager: orchestrates cross-aggregate workflow."""

    def handle(self, event):
        if isinstance(event, OrderPlaced):
            self.command_bus.send(ReserveInventory(
                order_id=event.aggregate_id,
                items=event.payload["items"]
            ))

        elif isinstance(event, InventoryReserved):
            self.command_bus.send(ProcessPayment(
                order_id=event.aggregate_id,
                amount=event.payload["total_amount"]
            ))

        elif isinstance(event, InventoryReservationFailed):
            self.command_bus.send(CancelOrder(
                order_id=event.aggregate_id,
                reason="OUT_OF_STOCK"
            ))

        elif isinstance(event, PaymentProcessed):
            self.command_bus.send(ShipOrder(
                order_id=event.aggregate_id
            ))

        elif isinstance(event, PaymentFailed):
            self.command_bus.send(ReleaseInventory(
                order_id=event.aggregate_id
            ))
            self.command_bus.send(CancelOrder(
                order_id=event.aggregate_id,
                reason="PAYMENT_FAILED"
            ))
```

---

## 9. Technology Choices

### 9.1 Event Store Options

| Technology | Type | Best For | Notes |
|---|---|---|---|
| **EventStoreDB** | Purpose-built event store | Native ES projects | Built-in projections, subscriptions, competing consumers |
| **Apache Kafka** | Distributed log | High-throughput event streaming | Retention-based; not true event store but widely used |
| **PostgreSQL** | RDBMS with append table | Teams with existing PG expertise | Simple, ACID, optimistic concurrency via `UNIQUE(agg_id, version)` |
| **Amazon DynamoDB** | NoSQL | AWS-native, serverless ES | Use Streams for CDC; partition by aggregate ID |
| **Apache Pulsar** | Distributed messaging | Multi-tenant, tiered storage | Geo-replication built-in |
| **Azure Cosmos DB** | Multi-model NoSQL | Azure-native, change feed | Change Feed acts as event stream |

### 9.2 Frameworks

| Framework | Language | Notes |
|---|---|---|
| **Axon Framework** | Java | Most mature; full ES+CQRS+Saga support |
| **Marten** | .NET (C#) | PostgreSQL as event store; excellent ergonomics |
| **EventFlow** | .NET (C#) | Lightweight ES/CQRS framework |
| **Commanded** | Elixir | Production-grade ES for Phoenix/Elixir |
| **Sequent** | Ruby | Rails-friendly ES framework |
| **esdbclient** | Python | EventStoreDB client |

---

## 10. Real-World Systems and Applications

### 10.1 Financial Services — Banking Ledger

**How:** Every transaction (deposit, withdrawal, transfer, fee) is an immutable event. Account balance is derived by summing all events. Regulatory audits are satisfied by default.

```
Events:                 Derived State:
AccountOpened           balance: $0
MoneyDeposited($1000)   balance: $1000
TransferSent($200)      balance: $800
InterestCredited($4)    balance: $804
```

**Real-world:** CQRS/ES is the architectural norm in core banking systems. Companies like **Monzo**, **Starling Bank**, and **Revolut** are built on event-sourced ledgers.

---

### 10.2 E-Commerce — Order Lifecycle (Amazon, Shopify)

**How:** An order aggregate accumulates events from placement through delivery. Each state transition (placed → paid → picked → packed → shipped → delivered → returned) is an event.

**Shopify:** Uses event-sourced patterns for order state machines internally. Every mutation to an order is captured as an event, enabling full order history replay and audit.

**Benefits realized:**
- Dispute resolution: replay exact order state at time of dispute
- Analytics: new projections built without re-querying orders
- A/B experiments: replay with modified business logic

---

### 10.3 Ride-Sharing — Trip State Machine (Uber)

**How:** A trip is an aggregate: `TripRequested → DriverMatched → TripStarted → TripEnded → PaymentProcessed`. Each event updates independent projections:

- **Pricing service:** calculates fare from trip events
- **Driver earnings:** aggregates payments per driver
- **Fraud detection:** real-time event stream analysis
- **Surge pricing:** consumer demand events drive price projections

**Uber's Schemaless** and downstream systems consume the event log to build specialized views.

---

### 10.4 Collaboration Tools — Document Editing (Figma, Google Docs)

**How:** Each user action (insert character, move element, change color) is an event. The document state is the reduction of all events. **Operational Transformation (OT)** and **CRDTs** are variants of event sourcing applied to collaborative real-time editing.

**Figma:** Their multiplayer engine is fundamentally event-sourced — operations are appended and applied deterministically to produce document state. Enables undo/redo, version history, and conflict resolution.

---

### 10.5 Supply Chain / Inventory (Walmart, Target)

**How:** Inventory changes (received, reserved, sold, returned, adjusted) are events. Stock levels are projections. Enables:
- Time-travel queries ("what was the stock level at 2pm before the flash sale?")
- Reprocessing events to fix inventory discrepancy bugs
- Multiple downstream consumers (warehouse system, front-end availability, analytics)

---

### 10.6 Gaming — Player Progression (Epic Games, Riot)

**How:** All player actions (quest completed, item acquired, level up, achievement unlocked) are events. Player state is replayed from event history.

**Benefits:**
- Anti-cheat: detect impossible event sequences
- Rollback: revert cheated state without losing legitimate history
- Analytics: replay for behavior analysis, recommendation engines

---

### 10.7 Payments (Stripe)

**How:** Every payment object in Stripe is modeled as an event stream: `PaymentIntentCreated → PaymentMethodAttached → PaymentIntentConfirmed → ChargeCreated → ChargeSucceeded`.

Stripe's **event log** is exposed directly to customers via webhooks — what Stripe calls "events" in its API *is* Event Sourcing surfaced at the product level. The entire Stripe API is effectively a projection of the internal event store.

---

## 11. Event Sourcing vs. Traditional CRUD

| Dimension | Event Sourcing | Traditional CRUD |
|---|---|---|
| **Storage** | Append-only event log | Current state only (rows updated in place) |
| **History** | Full history by default | Lost on update (unless audit tables added) |
| **Queries** | Requires pre-built projections | Ad-hoc SQL queries |
| **Temporal** | Native ("as-of" queries) | Hard (requires CDC or temporal tables) |
| **Complexity** | High | Low |
| **Debugging** | Full causal chain | Need audit logging bolted on |
| **Schema Evolution** | Event versioning / upcasting | ALTER TABLE migration |
| **Scalability** | Horizontal (per aggregate stream) | Requires sharding / replicas |
| **Consistency** | Eventual (read side) | Strong (single DB) |
| **Recovery** | Replay events → rebuild any projection | Point-in-time backup + restore |

---

## 12. Common Pitfalls and Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Storing commands, not events** | Commands can fail; recording `PlaceOrderCommand` instead of `OrderPlaced` breaks replay | Always record facts (past tense events), not intentions |
| **Events with too little data** | Projection can't be rebuilt without querying other services mid-replay | Events must be self-contained with all needed data at the time of occurrence |
| **Mutable events** | Defeats the purpose; breaks replay determinism | Treat event store as immutable; version new shapes instead |
| **No idempotency in projections** | Duplicate event delivery causes double-counting | Use event ID + processed-events table to deduplicate |
| **One giant stream** | All events in one partition → serialization bottleneck | Partition by aggregate ID; use stream-per-aggregate |
| **Synchronous projection rebuild** | Blocking queries during replay degrades live performance | Rebuild projections async in background; swap read model atomically |
| **Applying ES to simple CRUD** | No historical value, audit need, or complex domain → pure overhead | Only apply where the event history itself has business value |
| **Forgetting to version events** | First schema change breaks all replays | Add `schemaVersion` field to all events from day one |

---

## 13. Decision Framework

```
Start Here
    │
    ▼
Do you need full audit history       No ──▶ Traditional CRUD is likely sufficient
by requirement (compliance, legal)?  │
    │ Yes                             │
    ▼                                 │
Is the domain complex with           No ──▶ Consider append-only audit log (simpler)
multiple state transitions           │
and workflows?                        │
    │ Yes                             │
    ▼                                 │
Do you have multiple downstream      No ──▶ CQRS without Event Sourcing may suffice
consumers needing different           │
views of the same data?               │
    │ Yes                             │
    ▼                                 │
Can your team tolerate eventual      No ──▶ Explore synchronous projections
consistency in reads?                 │      (risk: write-path coupling)
    │ Yes                             │
    ▼                                 │
Consider Event Sourcing + CQRS ◀─────┘
```

---

## 14. Interview Cheat Sheet

| Question | Key Answer |
|---|---|
| **What is Event Sourcing?** | Storing state changes as an immutable sequence of events rather than current state |
| **How do you get current state?** | Replay all events for an aggregate (or load from snapshot + replay delta) |
| **What is a projection?** | A derived, query-optimized view built by processing the event stream |
| **Why pair ES with CQRS?** | Write side (event store) and read side (projections) have different scaling and consistency requirements |
| **How to handle schema changes?** | Upcasting (transform on read), versioned event types, or copy-transform migration |
| **How do you prevent concurrency issues?** | Optimistic concurrency: `UNIQUE(aggregate_id, version)` in the event store |
| **What are snapshots for?** | Avoid replaying thousands of events; checkpoint state at version N, replay only delta |
| **Trade-off vs. CRUD?** | Full audit trail + temporal queries + decoupled consumers at the cost of complexity + eventual consistency |
| **When NOT to use ES?** | Simple domains, no historical need, small teams, or no tolerance for eventual consistency |
| **Real-world example?** | Stripe's payment intents, Monzo's ledger, Figma's multiplayer, Uber's trip state machine |
