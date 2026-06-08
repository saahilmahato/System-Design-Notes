# Event-Driven Architecture (EDA)

## What Is Event-Driven Architecture?

Event-Driven Architecture is a design paradigm where **components communicate by producing and consuming events** rather than calling each other directly. A component doesn't call `OrderService.process()`; it emits an `OrderPlaced` event and moves on. Any interested consumer reacts independently.

**Core shift:** From "tell the other service what to do" → "announce what happened; let others decide what to do."

---

## Foundational Concepts

### Event
A **fact that something happened** — immutable, past-tense, timestamped.

```
{
  "eventId": "evt_01HX...",
  "type": "order.placed",
  "occurredAt": "2024-11-01T10:23:00Z",
  "payload": {
    "orderId": "ord_9821",
    "userId": "usr_4421",
    "total": 149.99
  }
}
```

- Events are **immutable** — they record what happened, not instructions
- Events are **self-contained** — carry enough data for consumers to act without further lookups (or carry a reference ID to fetch more)
- Events are **past-tense by convention**: `OrderPlaced`, not `PlaceOrder`

### Three Core Roles

| Role | Responsibility |
|---|---|
| **Producer** | Detects a state change; publishes an event. Has no knowledge of consumers. |
| **Event Broker** | Receives, stores (durably), and routes events to consumers. Decouples producers from consumers. |
| **Consumer** | Subscribes to event types; reacts by executing business logic. |

### Commands vs. Events vs. Queries

| | Command | Event | Query |
|---|---|---|---|
| **Intent** | Do something | Something happened | Give me data |
| **Direction** | Directed at a specific service | Broadcast to any interested party | Directed at a specific service |
| **Coupling** | Tight (sender knows receiver) | Loose (producer is unaware of consumers) | Tight |
| **Example** | `ProcessPayment(orderId)` | `PaymentProcessed` | `GetOrder(orderId)` |
| **Handling** | Usually exactly one handler | Zero or more handlers | Exactly one handler |

---

## Why Event-Driven?

| Problem with Synchronous / Direct Calls | EDA Solution |
|---|---|
| Caller blocked while callee processes | Caller publishes and moves on; fully async |
| Tight coupling — caller must know callee's API | Producer knows nothing about consumers |
| Cascading failures — callee down means caller fails | Broker buffers events; consumers catch up on recovery |
| Hard to add new consumers without touching producer | New service subscribes; zero producer changes |
| Thundering herd — sudden load spikes overwhelm downstream | Broker absorbs spike; consumers process at their pace |
| Audit trail requires separate instrumentation | Events are an inherent, immutable log of what happened |

---

## EDA Topology Types

### Simple Queue (Point-to-Point)

```
Producer  →  Queue  →  Single Consumer Group
```

- One logical consumer processes each message
- Multiple instances of the consumer can compete for messages (competing consumers pattern)
- No fan-out — message consumed once
- **Use when:** work distribution to a pool of workers (job queue, task offloading)

### Pub/Sub (Publish-Subscribe)

```
Producer  →  Topic  →  Subscription A  →  Consumer A
                    →  Subscription B  →  Consumer B
                    →  Subscription C  →  Consumer C
```

- Message delivered to **all subscribers independently**
- Each subscriber maintains its own offset/position; one slow consumer doesn't block others
- **Use when:** one event needs to fan out to multiple independent services (e.g., `OrderPlaced` → inventory, billing, notifications, analytics)

### Event Streaming

```
Producer  →  Partitioned Log (Kafka / Kinesis)  →  Consumer Group A (reads from offset)
                                                →  Consumer Group B (independent offset)
```

- Events persisted in an **ordered, immutable log** for a configurable retention period
- Consumers maintain their own offsets — can replay, reprocess, or catch up independently
- Supports **time-travel**: replay from any past offset
- **Use when:** high-throughput streams, audit logs, event sourcing, ML pipelines, reprocessing historical data

### Event Mesh / Event Bus

```
Service A  ←→  Event Mesh  ←→  Service B
               ↕
            Service C
```

- Dynamic routing, protocol translation, filtering across distributed environments (multi-cloud, hybrid)
- More infrastructure overhead
- **Use when:** large organizations with heterogeneous environments

---

## Messaging Semantics — Delivery Guarantees

The guarantee a broker provides about whether a message reaches a consumer.

| Guarantee | What It Means | Trade-off |
|---|---|---|
| **At-most-once** | Message sent once; may be lost if consumer crashes | No duplicates, but potential data loss |
| **At-least-once** | Message redelivered until acknowledged; may be received multiple times | No loss, but consumers must be idempotent |
| **Exactly-once** | Message delivered precisely once, even through failures | Highest correctness; requires coordination overhead (2PC or transactional outbox) |

**In practice:** most systems use **at-least-once** and enforce idempotency at the consumer. True exactly-once is expensive and often achievable only within a single broker (e.g., Kafka transactions within the same cluster).

---

## Consumer Patterns

### Competing Consumers

```
Queue  →  Consumer Instance 1
       →  Consumer Instance 2   (only one receives each message)
       →  Consumer Instance 3
```

- Multiple worker instances pull from a shared queue
- Natural load balancing and horizontal scaling
- Each message processed by exactly one instance
- **Key concern:** messages should not be order-sensitive across consumers

### Consumer Groups (Kafka-style)

```
Topic (3 partitions)  →  Consumer Group A: [Instance 1 reads P0, Instance 2 reads P1, Instance 3 reads P2]
                      →  Consumer Group B: [Instance 1 reads all partitions independently]
```

- Within a group: each partition assigned to one consumer instance (parallelism = partition count)
- Across groups: all groups receive all messages independently
- **Key constraint:** `consumers_in_group ≤ partitions`. Extra consumers sit idle.

### Fan-Out (Multiple Independent Consumers)

```
Event: OrderPlaced
  → InventoryService   (reserve stock)
  → BillingService     (charge card)
  → NotificationService (send email)
  → AnalyticsService   (record event)
```

- Each consumer is fully independent — failure of one doesn't affect others
- Producers remain unchanged as new consumers are added

### Event Aggregation / Join

Multiple event types combined into a richer event:

```
UserCreated + ProfileCompleted + EmailVerified  →  AggregateProcessor  →  AccountReadyEvent
```

- Requires stateful processing (hold partial state until all conditions met)
- Can be implemented with a stream processor (Kafka Streams, Flink) or a stateful consumer with external store

---

## Ordering Guarantees

**Global ordering** (across all producers/partitions) is expensive and limits throughput. Most systems offer **partition-level ordering** instead.

### Kafka Partition-Level Ordering

```
All events for orderId=123  →  always route to Partition 2  →  consumed in order by one instance
All events for orderId=456  →  always route to Partition 5  →  consumed in order by one instance
```

- Use a consistent **partition key** (e.g., `orderId`, `userId`) to route related events to the same partition
- Events for the same key are strictly ordered within that partition
- Events across different keys may be processed concurrently and out of order relative to each other

### When Ordering Doesn't Matter
Design consumers to be **order-independent** where possible:
- Use state-machine transitions (`PENDING → PROCESSING → DONE`) — only valid transitions accepted, regardless of order
- Use idempotent writes — duplicate or out-of-order events produce the same final state

---

## Schema Management and Evolution

Events are **contracts between producers and consumers**. Schema changes are a breaking change risk.

### Schema Registry
Central store of event schemas. Producers serialize against a registered schema; consumers deserialize using the same registry.

```
Producer → serialize(event, schemaId=42) → Broker
Consumer → fetch schema 42 from registry → deserialize → process
```

Benefits:
- Enforces compatibility at publish time (reject incompatible events early)
- Consumers know exactly what shape to expect
- Version history and diff tracking

### Schema Compatibility Modes

| Mode | Rule | Safe For |
|---|---|---|
| **Backward** | New schema can read data written by old schema | Upgrading consumers before producers |
| **Forward** | Old schema can read data written by new schema | Upgrading producers before consumers |
| **Full** | Both backward and forward compatible | Rolling deployments where order is unknown |
| **None** | No compatibility enforced | Rapid development only; dangerous in production |

### Safe Schema Evolution Rules
- **Add optional fields** — safe in all directions
- **Provide defaults for new fields** — allows old consumers to skip unknown fields
- **Never remove or rename required fields** — breaking change
- **Never change field types** — breaking change
- Use **Avro, Protobuf, or JSON Schema** — not raw JSON (no enforcement)

---

## Event Sourcing

A persistence model where **state is derived from a log of events**, not stored directly.

```
Traditional:   DB stores current state   { orderId: 123, status: "shipped" }

Event Sourcing:
  EventLog stores:
    OrderPlaced      { orderId: 123, ... }
    PaymentProcessed { orderId: 123, ... }
    OrderShipped     { orderId: 123, ... }

  Current state = replay(all events for orderId 123)
```

### Benefits
- **Complete audit trail** — every state change recorded with timestamp and context
- **Time travel** — reconstruct state at any past point in time
- **Event replay** — fix bugs by reprocessing historical events with corrected logic
- **Temporal decoupling** — downstream consumers can process events whenever, from any offset

### Challenges
- **Snapshot requirement** — replaying thousands of events per entity is slow; take periodic snapshots
- **Schema evolution complexity** — old events in the log must still be deserializable by new code
- **Eventual consistency** — read models (projections) lag behind the event log
- **Query complexity** — can't query current state directly; must build and maintain read-side projections (see CQRS)

### When to Use Event Sourcing
- Domain requires full audit trail (finance, healthcare, compliance)
- Business value in replaying and reprocessing history
- Complex aggregate behavior where understanding *how* state changed matters

### When NOT to Use
- Simple CRUD domains — massive overhead for no benefit
- When team isn't prepared for the operational complexity
- When you need simple, direct queries on current state

---

## CQRS (Command Query Responsibility Segregation)

Separate the **write model** (commands → events) from the **read model** (projections optimized for queries).

```
Write Side:
  Command → Aggregate → Event stored in Event Store → Event published

Read Side:
  Event consumed → Projection updated → Read model (DB/cache) optimized for query patterns

Client:
  Writes → Command API (write side)
  Reads  → Query API (read side)
```

### Why CQRS?
- Write model optimized for consistency and invariant enforcement
- Read model optimized for query performance (denormalized, pre-aggregated, cached)
- Each side scales independently
- Read models can be rebuilt at any time by replaying events

### CQRS Without Event Sourcing
CQRS and Event Sourcing are independent patterns, often combined but not required together.
- Can use CQRS with a regular DB write side: writes go to normalized tables; events published via CDC or outbox; projections built from those events
- Event Sourcing naturally produces events to feed CQRS projections

### Challenges
- **Eventual consistency** — read model lags behind writes (seconds to minutes in practice)
- **Projection staleness** — clients may read slightly stale data after a write
- Requires explicit handling of "read your own writes" scenarios

---

## The Outbox Pattern — Reliable Event Publishing

**Problem:** Writing to the DB and publishing an event are two separate operations. Either can fail independently.

```
Naive approach (broken):
  1. Write order to DB        ← success
  2. Publish OrderPlaced      ← CRASH → event never published

Also broken:
  1. Publish OrderPlaced      ← success
  2. Write order to DB        ← CRASH → event published for an order that doesn't exist
```

**Solution — Transactional Outbox:**

```
Within a single DB transaction:
  1. Write order to orders table
  2. Write event to outbox table { eventType, payload, published: false }
  → Transaction commits atomically

Separate relay process:
  3. Polls outbox for unpublished events
  4. Publishes each to the broker
  5. Marks event as published: true
```

- DB transaction is the atomicity boundary — both writes succeed or both fail
- The relay process may re-publish (at-least-once) — consumers must be idempotent
- For low latency: use **CDC** (Change Data Capture) on the outbox table instead of polling (e.g., Debezium watching Postgres WAL → publishes to Kafka immediately on commit)

---

## Sagas — Distributed Transactions Without 2PC

A **saga** is a sequence of local transactions, each publishing an event that triggers the next step. If any step fails, compensating transactions undo prior work.

### Choreography-Based Saga

```
OrderService  →  OrderPlaced          → PaymentService
PaymentService → PaymentProcessed     → InventoryService
InventoryService → StockReserved      → ShippingService
ShippingService → OrderFulfilled

On failure:
InventoryService → StockReservationFailed → PaymentService (compensate: refund)
PaymentService → PaymentRefunded          → OrderService (compensate: cancel order)
```

- No central coordinator — each service reacts to events and publishes the next
- **Pros:** fully decoupled; no single point of failure
- **Cons:** hard to trace the full saga flow; compensating logic spread across services; difficult to reason about global state

### Orchestration-Based Saga

```
SagaOrchestrator:
  1. Send ProcessPayment command  →  PaymentService
  2. Receive PaymentProcessed event
  3. Send ReserveStock command    →  InventoryService
  4. Receive StockReserved event
  5. Send ShipOrder command       →  ShippingService
  ...

On failure at step 3:
  Orchestrator sends RefundPayment command → PaymentService
```

- Central coordinator drives the saga and handles failures
- **Pros:** saga flow visible in one place; easier to debug and monitor
- **Cons:** orchestrator is a potential bottleneck/SPOF; tighter coupling to orchestrator

### Saga Comparison

| | Choreography | Orchestration |
|---|---|---|
| **Coupling** | Low — services only know about events | Medium — services know the orchestrator |
| **Visibility** | Low — flow is implicit across services | High — flow defined in one place |
| **Failure handling** | Distributed; compensation logic in each service | Centralized; orchestrator manages rollback |
| **Scalability** | Scales well — no central bottleneck | Orchestrator can become bottleneck |
| **Debugging** | Hard — need distributed tracing | Easier — orchestrator logs full state |
| **Best for** | Simple, well-defined flows | Complex flows with many failure paths |

---

## Event Streaming: Kafka Deep Dive

Kafka is the most widely used event streaming platform and worth understanding at depth.

### Core Concepts

| Concept | Description |
|---|---|
| **Topic** | Named, ordered log of events. Logically equivalent to a table or stream. |
| **Partition** | Sub-division of a topic. Unit of parallelism and ordering. Each partition is an independent ordered log. |
| **Offset** | Integer index of a message within a partition. Monotonically increasing. |
| **Consumer Group** | Set of consumers that jointly consume a topic. Each partition assigned to one member. |
| **Broker** | Kafka server. A cluster has multiple brokers. |
| **Leader / Follower** | Each partition has one leader broker (handles all reads/writes) and N follower replicas. |
| **ISR** | In-Sync Replicas — followers that are caught up to the leader. `acks=all` requires all ISR members to confirm. |

### Producer Acknowledgment Modes

| `acks` Setting | Meaning | Durability | Throughput |
|---|---|---|---|
| `0` | Fire and forget — no ack waited | Lowest | Highest |
| `1` | Leader acknowledges write | Medium | Medium |
| `all` / `-1` | All ISR replicas acknowledge | Highest | Lowest |

For critical data: `acks=all` + `min.insync.replicas=2`.

### Consumer Offset Management

```
Partition: [msg0, msg1, msg2, msg3, msg4, msg5]
Consumer committed offset: 3
→ On restart, consumer resumes from msg3
```

- **Auto-commit** (`enable.auto.commit=true`): offset committed periodically; risk of data loss if consumer crashes between processing and commit
- **Manual commit**: commit only after successful processing; safer; risk of duplicate processing if crash after processing but before commit
- **At-least-once** is the practical default with manual commit + idempotent consumers

### Partition Assignment and Rebalancing

When consumers join or leave a group, Kafka triggers a **rebalance** — reassigning partitions to consumers. During rebalance, consumption pauses.

- Minimize rebalances: use `static group membership` for stable consumers
- Cooperative rebalancing (incremental): only reassign partitions that need to move; reduces pause window
- Rebalance storm: many instances joining simultaneously → repeated rebalances; stagger startup

### Log Compaction

Kafka can compact a topic: for each key, **retain only the latest event**.

```
Key: orderId=123
Events: [created, updated, updated, cancelled]
After compaction: [cancelled]
```

- Useful for maintaining "current state" in a topic (changelog topics)
- Consumers reading the compacted topic get the latest state per key, not full history
- Used by Kafka Streams and ksqlDB for materializing state stores

### Retention Policies

| Policy | Behavior |
|---|---|
| **Time-based** | Delete messages older than N days (e.g., `retention.ms=604800000` = 7 days) |
| **Size-based** | Delete oldest messages when partition exceeds N bytes |
| **Compaction** | Keep only latest value per key; no time-based deletion |
| **Compact + Delete** | Compact and apply time/size retention — combines both |

---

## Back-Pressure

When consumers are slower than producers, the system must handle the growing backlog.

### Strategies

| Strategy | Description | Trade-off |
|---|---|---|
| **Queue buffering** | Broker absorbs the difference; consumers catch up | Works until queue fills (memory/disk limit) |
| **Consumer scaling** | Add more consumer instances to increase throughput | Limited by partition count in Kafka |
| **Rate limiting producers** | Slow down or throttle producers | May not be acceptable for user-facing flows |
| **Load shedding** | Drop low-priority events under extreme load | Acceptable only for non-critical events |
| **Reactive streams** | Propagate demand signals upstream (RxJava, Project Reactor) | Complex; suits in-process pipelines |

**Key insight:** queue depth growing = back-pressure manifesting. Monitor queue age (time oldest message has waited), not just depth. A deep queue of fast messages is fine; a shallow queue where the oldest message is 10 minutes old is a problem.

---

## Temporal Coupling vs. Spatial Coupling

| Coupling Type | Definition | Sync | Async |
|---|---|---|---|
| **Temporal** | Both parties must be available at the same time | ✅ Required | ❌ Not required |
| **Spatial** | Caller must know the network address of the callee | ✅ Required | ❌ Not required (broker is intermediary) |

EDA eliminates both forms of coupling:
- Producer doesn't care if consumers are up or down at publish time
- Producer doesn't know consumer addresses
- This is the core durability and decoupling advantage of EDA

---

## Consistency Models in EDA

EDA systems are inherently **eventually consistent**. Understanding the trade-offs is critical.

### Eventual Consistency in Practice

```
User places order  →  OrderPlaced event published
                    →  t+50ms: InventoryService reserves stock
                    →  t+100ms: BillingService charges card
                    →  t+200ms: NotificationService sends email

Between t=0 and t=200ms: system is in an intermediate state
```

- The system **will** converge to a consistent state if all components process successfully
- During the window, different services may have different views of the world
- Compensating transactions handle the case where convergence fails

### Read-Your-Own-Writes Problem

```
1. User updates profile (write)   → OrderService processes
2. User reads profile (read)      → Read replica hasn't caught up yet
3. User sees old data             → Confusing UX
```

Solutions:
- Route reads to the write leader immediately after a write (for a short window)
- Include version/timestamp in response; read model refuses to serve stale data
- Accept the inconsistency with appropriate UX (e.g., "changes may take a few moments to reflect")

---

## Reliability Considerations

### At-Least-Once + Idempotency (The Standard Pair)

Brokers guarantee at-least-once delivery. Consumers must be idempotent.

```
Processing order for message with messageId = "msg_abc123":

1. Check: has messageId been processed?
   → Yes: skip (return success, don't reprocess)
   → No: process + record messageId in processed set

Processed set: Redis SET with TTL, or DB deduplication table
```

### Dead-Letter Queues in EDA

```
Consumer fails to process event after maxRetries:
  → Event moved to DLQ (e.g., orders.placed.dlq)
  → Alert fires on DLQ depth
  → Ops team inspects, fixes root cause
  → Resubmits events from DLQ back to main topic
```

DLQ is not optional in production. Without it, bad events either loop forever or are silently dropped.

### Exactly-Once Semantics (EOS)

Available in Kafka via transactional API:
- Producer uses a `transactional.id`
- Writes to multiple partitions are atomic — all committed or none
- Consumer reads only committed messages (`isolation.level=read_committed`)

**Cost:** ~20-30% throughput reduction. Use only where duplicate processing has real-world consequences (financial transactions, inventory deductions).

### Circuit Breaker at the Consumer

If a downstream dependency (DB, external API) fails, consumers should not keep processing events they cannot complete — they'll pile up in the DLQ or infinite retry loop.

```
Consumer → calls InventoryService
InventoryService → fails 5 consecutive times
Circuit opens → consumer stops attempting for T seconds
→ Messages remain in queue / visibility extended
→ After T seconds, circuit half-opens → test one request
→ If success: circuit closes, normal processing resumes
→ If failure: circuit reopens
```

---

## Observability in EDA

Standard application observability is insufficient for EDA — events flow through multiple services asynchronously. Need **distributed tracing + event-specific metrics**.

### Correlation and Causation IDs

```json
{
  "eventId": "evt_001",
  "correlationId": "req_xyz",    // ties back to the originating request
  "causationId": "evt_000",      // the event that caused this event to be produced
  "type": "payment.processed"
}
```

- `correlationId`: propagated from the original user action through every downstream event
- `causationId`: the direct parent event that triggered this one
- Together they form a **causal chain** traceable across services

### Key EDA Metrics

| Metric | What It Indicates |
|---|---|
| **Consumer lag** | Number of messages behind the latest offset (Kafka) |
| **Message age / oldest message age** | Time the oldest unprocessed message has been waiting |
| **Processing rate vs. publish rate** | If publish rate > processing rate, lag will grow |
| **DLQ depth** | Failed events; indicates systemic processing problems |
| **Rebalance frequency** | Excessive rebalances indicate unstable consumer group |
| **End-to-end event latency** | Time from event produced → downstream effects visible |

### Alerting Rules

- Consumer lag growing consistently → consumers falling behind → scale up
- Oldest message age > SLA threshold → immediate alert
- DLQ receiving messages → alert; stop the bleeding before backlog grows
- Rebalance rate > N/hour → investigate consumer stability
- Publish rate spike without corresponding consumer scaling → pre-emptive alert

---

## EDA Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Event as command** | `ProcessOrder` published as an event — assumes exactly one consumer and specific behavior | Use commands for directed instructions; events for facts |
| **Fat events (over-payload)** | Stuffing full entity state in every event — huge messages, tight coupling to producer's data model | Thin events with reference ID; consumers fetch details if needed |
| **Thin events (under-payload)** | Event with only an ID — consumer must query producer synchronously, defeating the purpose | Include enough context for consumers to act without callbacks |
| **No schema registry** | Producers change event shape freely; consumers break silently | Enforce schema with a registry; fail at publish time |
| **Consumers coupling to producer's internal schema** | Consumer breaks when producer refactors internals | Event schema is a public contract; version it explicitly |
| **Ignoring consumer lag** | No alerts on lag growth — backlog builds silently until SLA breach | Alert on lag + oldest message age |
| **Choreography for complex flows** | 10-step saga with compensation via choreography — undebuggable | Use orchestration for complex sagas |
| **No DLQ** | Bad events retry forever; workers stall | Always configure DLQ + alerting |
| **Temporal ordering assumptions** | Consumer assumes events arrive in order they were produced | Never assume global ordering; design for out-of-order delivery |
| **Synchronous call inside a consumer** | Consumer calls another service synchronously — re-introduces coupling and fragility | Publish another event instead; or accept dependency with circuit breaker |

---

## When to Use EDA (and When Not To)

### Use EDA When
- Multiple services need to react to the same state change independently
- Producer and consumer lifecycles are independent (different teams, different deploy cadences)
- High-throughput event streams (millions/sec) need to be processed reliably
- Full audit history or event replay is required
- System needs to scale consumers independently from producers

### Don't Use EDA When
- Simple CRUD with one service — massive overhead for no benefit
- Strong consistency is required (two-phase operations with atomic rollback)
- The workflow is simple enough that synchronous calls are clear and reliable
- Team isn't prepared to handle eventual consistency, schema evolution, and distributed tracing complexity

---

## Design Checklist

```
□ Events are named as past-tense facts, not commands
□ Events are self-contained with sufficient context for consumers to act
□ Schema registry in place — breaking changes caught at publish time
□ Schema backward/forward compatibility enforced for all consumer-facing events
□ Outbox pattern (or CDC) used for reliable event publishing from DB writes
□ Consumers are idempotent — safe to process the same event N times
□ DLQ configured for all queues/subscriptions
□ DLQ depth and oldest message age alerting in place
□ Consumer lag monitored and alerted on
□ Correlation ID and causation ID propagated through all events
□ Partition key chosen to ensure related events land in the same partition (if ordering matters)
□ Rebalance strategy chosen (cooperative incremental preferred)
□ Circuit breaker on consumers calling external dependencies
□ Saga compensation logic defined and tested for every failure path
□ Schema evolution tested: old consumer + new event, new consumer + old event
□ EOS (exactly-once) only used where duplicate processing has real consequences
```