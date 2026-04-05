# Cloud Design Patterns: Publisher / Subscriber (Pub/Sub)

---

## 1. Overview

The **Publisher/Subscriber** pattern decouples the producers of messages (publishers) from the consumers (subscribers) through an intermediary called a **message broker** or **event bus**. Publishers emit events without any knowledge of who (if anyone) is listening. Subscribers express interest in categories of events (topics/channels) and receive only those they care about — without knowing who published them.

This is fundamentally a **one-to-many** or **many-to-many** communication model, contrasting with direct point-to-point messaging.

```
                        ┌─────────────────────────────────────────────┐
                        │              Message Broker / Bus            │
                        │                                              │
  ┌───────────┐  event  │  ┌──────────┐    ┌──────────┐               │
  │ Publisher │────────►│  │ Topic A  │    │ Topic B  │               │
  │   (A)     │         │  └──────────┘    └──────────┘               │
  └───────────┘         │       │               │                      │
                        │       │               │                      │
  ┌───────────┐  event  │       ▼               ▼                      │
  │ Publisher │────────►│  ┌─────────────────────────────────────┐     │
  │   (B)     │         │  │         Subscription Registry        │     │
  └───────────┘         │  └─────────────────────────────────────┘     │
                        │       │         │          │                  │
                        └───────┼─────────┼──────────┼──────────────────┘
                                │         │          │
                                ▼         ▼          ▼
                          ┌──────────┐ ┌────────┐ ┌────────┐
                          │   Sub 1  │ │  Sub 2 │ │  Sub 3 │
                          └──────────┘ └────────┘ └────────┘
```

---

## 2. Core Concepts

### 2.1 Components

| Component | Role |
|---|---|
| **Publisher** | Emits events/messages to a topic. Has zero knowledge of subscribers. |
| **Subscriber** | Registers interest in one or more topics and receives matching messages. |
| **Topic / Channel** | Logical named channel that categorizes messages (e.g., `order.created`). |
| **Message Broker** | Infrastructure layer that routes messages from publishers to the correct subscribers. |
| **Subscription** | A registered binding between a subscriber and a topic, optionally with filter rules. |
| **Message** | The payload — can be an event notification, a command, or raw data. |

### 2.2 Delivery Semantics

| Semantic | Description | Guarantee |
|---|---|---|
| **At-most-once** | Fire and forget. Message may be lost. | No duplicates, possible loss |
| **At-least-once** | Retry on failure. Message may be delivered multiple times. | No loss, possible duplicates |
| **Exactly-once** | Guaranteed single delivery. Highest cost. | No loss, no duplicates |

Most real-world Pub/Sub systems default to **at-least-once** delivery. Idempotency on the subscriber side is the recommended safeguard.

### 2.3 Push vs. Pull Delivery

| Mode | How It Works | Best For |
|---|---|---|
| **Push** | Broker proactively delivers to subscriber endpoints (webhooks, queues). | Low-latency, event-driven consumers |
| **Pull** | Subscriber polls the broker for new messages. | Consumers that need rate control and backpressure |

Brokers like **Google Pub/Sub** support both. **Kafka** is pull-only. **SNS** is push-only (to SQS, Lambda, HTTP).

---

## 3. Architecture Variants

### 3.1 Fan-Out (1 Publisher → N Subscribers)

One event triggers parallel processing across multiple independent consumers.

```
                          ┌────────────────────┐
                          │  Order Service      │
                          │  publishes:         │
                          │  order.placed       │
                          └────────┬───────────┘
                                   │
                     ┌─────────────┼──────────────┐
                     ▼             ▼               ▼
             ┌──────────────┐ ┌──────────┐ ┌──────────────┐
             │ Notification │ │ Inventory│ │  Analytics   │
             │   Service    │ │ Service  │ │  Service     │
             └──────────────┘ └──────────┘ └──────────────┘
```

### 3.2 Topic Filtering / Content-Based Routing

Subscribers register with filter predicates; only matching messages are delivered.

```
Topic: payments.transaction

  Sub A filter: amount > 10000         → receives high-value alerts
  Sub B filter: status = "failed"      → receives failure events
  Sub C filter: region = "EU"          → receives EU-only transactions
```

### 3.3 Competing Consumers (Consumer Groups)

Multiple instances of the same service share a subscription for horizontal scaling. Only one instance in the group processes each message.

```
              Topic: order.placed
                     │
          ┌──────────▼──────────┐
          │  Consumer Group:    │
          │  fulfilment-workers │
          └──────┬──────┬───────┘
                 │      │
            ┌────▼──┐ ┌─▼─────┐
            │Worker1│ │Worker2│   ← Only one processes each message
            └───────┘ └───────┘
```

### 3.4 Dead Letter Queue (DLQ)

Messages that repeatedly fail processing are routed to a DLQ for inspection and replay.

```
  Topic → Subscriber → (fails 3x) → Dead Letter Queue → Alerting / Manual Replay
```

---

## 4. Message Anatomy

```json
{
  "id":          "evt_01HXYZ9A3B",          // Unique event ID (for deduplication)
  "type":        "order.placed",             // Event type (topic routing key)
  "source":      "order-service",            // Publisher identity
  "timestamp":   "2025-03-15T12:00:00Z",    // When the event was created
  "version":     "1.0",                      // Schema version
  "data": {
    "orderId":   "ord_992",
    "userId":    "usr_441",
    "amount":    149.99,
    "currency":  "USD"
  },
  "metadata": {
    "correlationId": "req_8823",             // Trace ID for distributed tracing
    "region":        "us-east-1"
  }
}
```

---

## 5. Trade-offs

### 5.1 Benefits

| Benefit | Detail |
|---|---|
| **Decoupling** | Publishers and subscribers evolve independently. New consumers can be added without touching the publisher. |
| **Scalability** | Consumers scale horizontally behind a subscription. Load is distributed across instances. |
| **Resilience** | Broker buffers messages if a subscriber is temporarily down; no data loss on the publisher side. |
| **Flexibility** | Multiple unrelated services can react to the same event, enabling cross-cutting concerns (audit, analytics, notifications) without code coupling. |
| **Temporal decoupling** | Publisher and subscriber don't need to be available simultaneously. |

### 5.2 Drawbacks

| Drawback | Detail |
|---|---|
| **Operational complexity** | Adds broker infrastructure that must be provisioned, monitored, and scaled. |
| **Message ordering** | Global ordering across partitions is difficult. Ordering is typically guaranteed only within a partition/key. |
| **Eventual consistency** | Downstream services see state changes with delay. Cross-service reads may be stale. |
| **Duplicate delivery** | At-least-once semantics means subscribers must be idempotent. |
| **Debugging difficulty** | Asynchronous flows are harder to trace than synchronous call stacks. Requires distributed tracing. |
| **Schema evolution** | Changing message schemas can break subscribers. Requires a schema registry and versioning strategy. |
| **Backpressure management** | A slow subscriber can fall behind; must monitor lag and provision appropriately. |

### 5.3 Trade-off Summary Table

| Dimension | Pub/Sub | Direct RPC / REST |
|---|---|---|
| Coupling | Loose | Tight |
| Latency | Higher (broker hop) | Lower (direct) |
| Throughput | Very high | Moderate |
| Reliability | High (buffered) | Depends on caller retry logic |
| Observability | Complex | Simpler |
| Request-Response | Not native | Native |
| Fan-out | Native, cheap | Expensive (N calls) |
| Schema enforcement | Needs extra tooling | Contract per API |

---

## 6. When to Use Pub/Sub

### Use Pub/Sub When:
- Multiple services need to react to the **same event** independently
- The publisher should not know or care about downstream consumers
- You need **fan-out** without N synchronous API calls
- Consumers need to scale **independently** of the publisher
- Temporary consumer unavailability should not cause data loss
- You need to **decouple release cycles** across services

### Avoid Pub/Sub When:
- You need a **synchronous response** from the consumer (use RPC/REST)
- **Exactly-once** delivery is a hard requirement with no idempotency escape hatch
- The system is small enough that the operational overhead is not justified
- Message ordering is critical and you cannot partition by key

---

## 7. Failure Modes & Mitigations

| Failure Mode | Description | Mitigation |
|---|---|---|
| **Message loss** | Broker crashes before acknowledgment | Persistent storage + replication in broker |
| **Duplicate delivery** | At-least-once + retry → processed twice | Idempotency keys in consumers |
| **Poison message** | Malformed message causes consumer crash loop | Dead Letter Queue (DLQ) + alerting |
| **Consumer lag** | Slow consumer falls behind accumulating backlog | Monitor lag; auto-scale consumers; add backpressure |
| **Thundering herd** | All consumers restart simultaneously, flood broker | Staggered startup, exponential backoff |
| **Schema mismatch** | Publisher changes schema, breaks subscriber | Schema registry (Confluent), versioned event contracts |
| **Broker unavailability** | Broker is a single point of failure | Clustered, replicated broker; multi-AZ deployment |
| **Hot topic** | One topic receives disproportionate traffic | Partition by key; increase partition count; rate-limit publisher |

---

## 8. Real-World Systems and Applications

### 8.1 Netflix — Internal Event Bus

Netflix uses **Apache Kafka** as the central event streaming backbone.

- The `Keystone` pipeline ingests billions of events per day from all microservices
- Services like recommendations, monitoring, and A/B testing all subscribe independently
- Enables complete decoupling: the video-playback service emits `play.started` events, and 15+ downstream systems react without the player service knowing any of them exist

**Scale**: ~2 trillion events/day across Kafka clusters

### 8.2 Uber — Real-Time Dispatch

Uber's dispatch platform is Pub/Sub at its core:

- A driver location update is published every 4 seconds per active driver
- Multiple subscribers (ETA service, surge pricing, dispatch engine, analytics) consume the same stream independently
- Built on a custom platform (`uReplicator`) on top of Kafka to handle global fan-out

**Scale**: Millions of location events per second during peak hours

### 8.3 LinkedIn — Feed & Notifications

LinkedIn's `Kafka` origin story: LinkedIn built Kafka specifically to solve the Pub/Sub problem at scale.

- User actions (connection, post, reaction) are published to topics
- Feed ranking, notification, and analytics services subscribe independently
- Enables LinkedIn to add new features (e.g., LinkedIn Stories, Reactions) without touching the core action publishers

### 8.4 Shopify — Order Processing

When an order is placed:

- `OrderService` publishes `order.created` to Kafka / Google Pub/Sub
- Fraud detection, inventory reservation, email notifications, analytics, and fulfillment all subscribe
- Any service can be added or removed without changing the checkout flow

### 8.5 AWS — SNS + SQS Fan-Out Pattern

The canonical AWS architecture for fan-out:

```
Publisher → SNS Topic → ┌─ SQS Queue A → Lambda (email)
                        ├─ SQS Queue B → Lambda (inventory)
                        └─ SQS Queue C → Lambda (analytics)
```

SQS provides buffering and at-least-once delivery for each subscriber independently. This is the de facto pattern for microservices on AWS.

### 8.6 Google — Google Pub/Sub

GCP's managed Pub/Sub service powers:

- **YouTube**: Video processing pipeline — `video.uploaded` triggers transcoding, thumbnail generation, and content moderation in parallel
- **Cloud Logging**: Log entries from all GCP services are published to topics for routing to BigQuery, Cloud Storage, or alerting sinks

---

## 9. Key Technologies & Platforms

| Technology | Type | Strengths | Weaknesses |
|---|---|---|---|
| **Apache Kafka** | Distributed log | High throughput, durable, replay | Operationally complex, no built-in fan-out |
| **Google Cloud Pub/Sub** | Managed service | Global, auto-scaled, push+pull | No strict ordering without ordering keys |
| **AWS SNS + SQS** | Managed fan-out | Serverless-native, integrates with Lambda | SNS has no replay; SQS is not a log |
| **Azure Service Bus** | Managed broker | Sessions for ordering, dead-lettering | Lower throughput than Kafka |
| **Redis Pub/Sub** | In-memory | Ultra-low latency | No persistence; fire-and-forget only |
| **RabbitMQ** | AMQP broker | Flexible routing, plugin ecosystem | Lower throughput than Kafka at scale |
| **NATS JetStream** | Lightweight log | Fast, cloud-native, lightweight | Smaller ecosystem |

---

## 10. Schema & Versioning Strategy

A common failure mode in Pub/Sub systems is schema drift. Mitigations:

### Backward-Compatible Evolution
- **Add** new optional fields → safe; old subscribers ignore them
- **Remove** fields → breaking; subscribers may depend on them
- **Rename** fields → always breaking

### Schema Registry
Use **Confluent Schema Registry** (Avro/Protobuf) or **AWS Glue Schema Registry** to enforce schema compatibility at publish time.

```
Publisher → Schema Registry (validate) → Kafka Topic → Subscriber (deserialize via registry)
```

### Event Versioning Pattern
Include a `version` field in every message. Route by version to maintain parallel consumers:

```
order.placed.v1 → legacy fulfilment consumers
order.placed.v2 → new fulfilment consumers
```

---

## 11. Observability & Monitoring

### Key Metrics to Track

| Metric | Description | Alert Threshold |
|---|---|---|
| **Consumer lag** | Messages in topic not yet consumed | > X messages or > Y seconds |
| **Publish rate** | Events/sec per topic | Baseline deviation |
| **Processing rate** | Messages consumed/sec per subscriber | Drop relative to publish rate |
| **Error rate** | Failed message processing rate | > 1% of throughput |
| **DLQ depth** | Messages in dead letter queue | > 0 (any DLQ message warrants attention) |
| **Broker throughput** | Bytes in/out per broker node | Near capacity ceiling |
| **Replication lag** | Replica sync lag on Kafka | > 0 for ISR-out replicas |

### Distributed Tracing
Every message should carry a `correlationId` / `traceId`. Propagate it through all subscribers for end-to-end trace stitching in tools like **Jaeger**, **Zipkin**, or **AWS X-Ray**.

---

## 12. Interview Framework / Decision Cheat Sheet

```
Q: Should I use Pub/Sub?
│
├─ Do multiple services react to the same event?          → YES → Strong candidate
├─ Do you need fan-out without coupling?                  → YES → Strong candidate
├─ Does the publisher need a synchronous response?        → YES → Use REST/gRPC instead
├─ Is exactly-once delivery a hard requirement?
│    └─ Can consumers be made idempotent?                → YES → Proceed with at-least-once
│    └─ No idempotency possible                          → Consider transactional outbox
├─ Is ordering critical?
│    └─ Partition by entity key (e.g., orderId)          → Kafka partition key
│    └─ Global ordering required                         → Single partition (limits scale)
└─ Scale requirements?
     ├─ < millions/day, managed preferred                → Google Pub/Sub, AWS SNS+SQS
     └─ Billions/day, need replay, streaming analytics   → Apache Kafka / Confluent
```

---

## 13. Related Patterns

| Pattern | Relationship |
|---|---|
| **Event Sourcing** | Pub/Sub is the delivery mechanism; event sourcing uses the log as the system of record |
| **CQRS** | Commands go over queues; events are published via Pub/Sub to update read models |
| **Saga Pattern** | Choreography-based sagas use Pub/Sub events to coordinate distributed transactions |
| **Outbox Pattern** | Guarantees atomic publish of events alongside DB writes (solves dual-write problem) |
| **Competing Consumers** | Multiple subscriber instances share a subscription to scale consumption |
| **Dead Letter Queue** | Companion pattern for handling unprocessable messages |
| **Claim Check** | Store large payloads externally; publish only a reference token in the message |