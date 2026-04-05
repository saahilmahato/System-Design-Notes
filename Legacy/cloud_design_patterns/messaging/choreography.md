# Cloud Design Patterns — Messaging: Choreography

## Overview

**Choreography** is a distributed coordination pattern where each service involved in a workflow makes its own decisions about what to do next, reacting to events published by other services — without a central coordinator telling them what to do.

Each service is autonomous: it subscribes to relevant events, performs its work, and then publishes new events to trigger downstream participants. The overall business process emerges from the collective behaviour of all participants.

> **Core Principle:** Intelligence lives in the services themselves, not in a central orchestrator. No single service knows the full workflow.

---

## How It Works

```
[Order Service] ──publishes──▶ OrderPlaced
                                    │
              ┌─────────────────────┼──────────────────────┐
              ▼                     ▼                       ▼
    [Payment Service]     [Inventory Service]     [Notification Service]
    subscribes to         subscribes to           subscribes to
    "OrderPlaced"         "OrderPlaced"           "OrderPlaced"
         │                       │
         │ publishes              │ publishes
         ▼                       ▼
    PaymentProcessed        StockReserved
         │                       │
         └──────────┬────────────┘
                    ▼
         [Fulfillment Service]
         subscribes to both
         PaymentProcessed + StockReserved
              │
              │ publishes
              ▼
         OrderFulfilled
              │
              ▼
    [Notification Service]
    sends shipping confirmation
```

Each arrow represents an event on a message bus/broker — no direct service-to-service calls.

---

## Key Concepts

| Concept | Description |
|---|---|
| **Event Bus / Message Broker** | The shared communication backbone (Kafka, RabbitMQ, SNS/SQS, EventBridge) |
| **Event** | An immutable record of something that happened: `OrderPlaced`, `PaymentFailed` |
| **Publisher** | The service that emits events after completing its work |
| **Subscriber** | The service that reacts to events it cares about |
| **Event Schema** | The contract between producers and consumers; must be stable and versioned |
| **Saga (Choreography-based)** | A distributed transaction implemented via a chain of events and compensating actions |

---

## Choreography vs. Orchestration

| Dimension | Choreography | Orchestration |
|---|---|---|
| **Control** | Decentralised — each service decides | Centralised — orchestrator directs all services |
| **Coupling** | Services coupled to events, not each other | Services coupled to the orchestrator |
| **Visibility** | Hard — workflow is implicit, spread across services | Easy — workflow is explicit in the orchestrator |
| **Failure handling** | Complex — compensating events per service | Simpler — orchestrator can retry/rollback |
| **Scalability** | High — services scale independently | Moderate — orchestrator can become a bottleneck |
| **Testability** | Harder — requires full event chain integration tests | Easier — orchestrator logic is in one place |
| **Ownership** | Each team owns their service's reaction | One team owns the workflow |
| **Best for** | Simple, well-understood workflows; highly decoupled teams | Complex workflows with many branches and rollbacks |

---

## Trade-offs

### ✅ Advantages

- **Loose coupling** — Services have no direct dependency on each other; they only depend on event contracts. Teams can deploy independently.
- **High scalability** — Each service scales on its own. The message broker absorbs load spikes through buffering.
- **Fault isolation** — A failure in one service does not directly crash others. Events remain in the broker until the consumer recovers.
- **Resilience** — Services can be taken down and redeployed without disrupting the chain, as long as the broker persists events.
- **Flexibility** — New services can be added to the workflow simply by subscribing to existing events — no changes to existing services required.
- **Avoids single point of failure** — No central orchestrator that, if it fails, halts the entire workflow.

### ❌ Disadvantages

- **Difficult to track workflow state** — The overall progress of a business transaction is spread across multiple services and event logs. Debugging is hard.
- **Cyclic dependency risk** — Services can inadvertently create event loops if event schemas are poorly designed.
- **Complex failure recovery** — Compensating transactions must be designed for every failure scenario. There is no central rollback mechanism.
- **Event schema governance** — Changing an event schema (adding/removing fields) can silently break downstream consumers. Requires strict versioning.
- **Testing complexity** — Integration tests must simulate the full event chain to verify end-to-end behaviour.
- **Observability overhead** — Requires distributed tracing (correlation IDs, trace propagation) to reconstruct a workflow timeline across services.
- **Eventual consistency** — The system is inherently eventually consistent; intermediate states may be briefly visible to users.

---

## Failure Handling: Compensating Transactions

Since there is no central rollback, each service must be able to undo its own work by emitting a compensating event.

```
OrderPlaced ──▶ PaymentService
                  │
                  │ Payment fails
                  ▼
             PaymentFailed ──▶ InventoryService
                                    │
                                    │ Releases reserved stock
                                    ▼
                               StockReleased ──▶ OrderService
                                                    │
                                                    ▼
                                               OrderCancelled ──▶ NotificationService
                                                                      │
                                                                      ▼
                                                              Sends cancellation email
```

> **Rule:** Every action in a choreography-based saga must have a corresponding compensating action.

---

## Implementation Patterns

### 1. Idempotent Event Consumers
Events may be delivered more than once (at-least-once delivery). Each consumer must handle duplicate events gracefully — typically by storing a processed event ID.

```
Consumer receives event
       │
       ▼
Check if event_id already processed
       │
  ┌────┴────┐
  │ Yes     │ No
  ▼         ▼
Discard   Process + mark event_id as done
```

### 2. Event Envelope / Schema
Every event should carry:
- `eventId` — unique identifier for deduplication
- `eventType` — e.g., `OrderPlaced`
- `timestamp` — when the event occurred
- `correlationId` — ties all events in one business transaction together
- `payload` — the domain data

### 3. Correlation ID Propagation
Every service must forward the `correlationId` from the triggering event to all events it publishes. This enables distributed tracing across the full workflow.

### 4. Dead Letter Queue (DLQ)
Events that fail processing repeatedly are moved to a DLQ for inspection and manual reprocessing — preventing poison messages from blocking the queue.

---

## Observability Requirements

Choreography-based systems demand strong observability because the workflow is invisible without it.

| Signal | What to track |
|---|---|
| **Distributed Tracing** | Full event chain per `correlationId` across services |
| **Event Lag** | Time between event publication and consumption |
| **DLQ Depth** | Number of events failing processing — a leading indicator of breakage |
| **Saga Completion Rate** | Percentage of business transactions that reach a terminal state |
| **Compensating Event Rate** | Frequency of rollback events — indicates failure rates |
| **Consumer Group Lag** | How far behind a consumer is from the head of the queue |

**Tools:** Jaeger, Zipkin, AWS X-Ray, Datadog APM, OpenTelemetry

---

## When to Use Choreography

```
Is your workflow simple with a clear linear sequence?
        │
   ┌────┴────┐
   │ Yes     │ No
   ▼         ▼
Either works  Are failure rollbacks complex and multi-branching?
              │
         ┌────┴────┐
         │ Yes     │ No
         ▼         ▼
   Orchestration  Do teams own separate services independently?
                  │
             ┌────┴────┐
             │ Yes     │ No
             ▼         ▼
       Choreography  Either works; prefer
                     Orchestration for visibility
```

**Prefer Choreography when:**
- Teams are fully autonomous and independently deployable
- Workflow is a simple linear or fan-out chain
- High throughput and scalability are required
- You want to add new workflow participants without modifying existing services

**Prefer Orchestration when:**
- Workflow has complex branching logic and conditional steps
- Rollback/compensation logic is intricate
- Workflow visibility and auditability are mandatory (compliance, finance)
- A single team owns the entire workflow

---

## Real-World Systems & Applications

### 1. **Amazon — Order Fulfilment Pipeline**
Amazon's order processing system is a textbook choreography implementation. When an order is placed, events flow through payment verification, inventory reservation, warehouse picking, shipping partner assignment, and notification — each service reacting to events from the previous stage. No central orchestrator could scale to Amazon's transaction volume.

### 2. **Uber — Trip Lifecycle**
Uber's trip events (DriverMatched, TripStarted, TripCompleted, PaymentCollected) propagate through their event backbone. Each microservice (pricing, payments, driver scoring, notifications) subscribes independently. This allows Uber to add new downstream features (e.g., carbon tracking) without touching existing services.

### 3. **Shopify — Checkout and Fulfilment**
Shopify uses choreography to handle post-checkout workflows across fraud detection, payment capture, inventory update, and third-party fulfilment apps. App developers subscribe to Shopify's event webhooks, which is choreography at the platform boundary.

### 4. **Netflix — Content Processing Pipeline**
When a new video is uploaded, Netflix fires a `VideoUploaded` event. Downstream services independently handle transcoding into multiple resolutions, thumbnail generation, metadata extraction, content ID registration, and CDN warming — all triggered by that single event.

### 5. **Stripe — Payment and Webhook System**
Stripe's internal processing and its external webhook delivery model are both choreography-based. `PaymentIntent` state transitions (`created → processing → succeeded/failed`) emit events that downstream systems (fraud detection, reporting, customer notifications) subscribe to independently.

### 6. **Airbnb — Booking Workflow**
Airbnb's booking flow uses event-driven choreography to coordinate between availability locking, payment processing, host notifications, calendar sync, and review scheduling — services owned by entirely different teams.

---

## Anti-Patterns to Avoid

| Anti-Pattern | Description | Fix |
|---|---|---|
| **Event as Command** | Publishing an event that only one specific service should handle, essentially a point-to-point call disguised as an event | Use direct RPC/HTTP for point-to-point; reserve events for broadcast |
| **Fat Events** | Embedding the full domain object in every event, creating tight coupling to the data model | Publish minimal event data; consumers fetch additional detail via API if needed |
| **Missing Idempotency** | Consumers that process the same event twice, causing duplicate side effects | Store and check event IDs before processing |
| **No DLQ** | Failing events block the queue or are silently dropped | Always configure a Dead Letter Queue |
| **Implicit Ordering Assumption** | Consumers that assume events arrive in the order they were published | Design consumers to handle out-of-order delivery |
| **No Correlation ID** | Events published without a shared transaction identifier | Always propagate `correlationId` through the full event chain |
| **Undocumented Event Schema** | Producers change event shape without a versioning contract | Maintain a schema registry (Confluent Schema Registry, AWS Glue) |

---

## Technology Stack Reference

| Component | Options |
|---|---|
| **Message Broker** | Apache Kafka, RabbitMQ, AWS SNS/SQS, Google Pub/Sub, Azure Service Bus, AWS EventBridge |
| **Schema Registry** | Confluent Schema Registry, AWS Glue Schema Registry, Apicurio |
| **Distributed Tracing** | OpenTelemetry, Jaeger, Zipkin, AWS X-Ray, Datadog APM |
| **Dead Letter Queue** | Built-in to Kafka (via separate topic), SQS DLQ, RabbitMQ dead-letter exchange |
| **Event Sourcing (companion)** | Axon Framework, EventStoreDB, Kafka (as log) |

---

## Quick Reference Cheat Sheet

```
Choreography = Services react to events; no central brain

Key rules:
  ✓ Every service publishes events after completing work
  ✓ Every service is idempotent (handles duplicate events)
  ✓ Every action has a compensating action
  ✓ Every event carries a correlationId
  ✓ Always configure a DLQ
  ✓ Version your event schemas

Signs you need Orchestration instead:
  ✗ Rollback logic is too complex to model as compensating events
  ✗ You can't answer "what's the current state of this order?" without querying 6 services
  ✗ Workflow has many conditional branches
```