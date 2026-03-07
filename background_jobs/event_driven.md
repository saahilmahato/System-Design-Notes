# Background Jobs: Event-Driven

---

## What Is It?

An **event-driven background job** is a unit of work that is triggered by an **event** (a message, a signal, or a state change) rather than a schedule or a direct synchronous call. A producer emits an event; one or more consumers pick it up asynchronously and process it independently of the original request.

The system does not wait for the job to finish — the producer fires and forgets, and the job runs in the background.

---

## Core Concepts

### Event
A discrete, immutable record that something happened.
- **Domain event**: `order.placed`, `user.registered`, `payment.failed`
- **Command event**: `send_email`, `resize_image`, `sync_inventory`
- Typically serialized as JSON or Avro/Protobuf

### Event Broker / Message Queue
The intermediary that decouples producers from consumers.
- **Queue** (point-to-point): One consumer processes each message. e.g. RabbitMQ, Amazon SQS
- **Log / Stream** (pub-sub): Multiple consumers can replay events independently. e.g. Apache Kafka, AWS Kinesis, Google Pub/Sub

### Producer
The service that emits the event. It has **no knowledge** of who consumes it or when.

### Consumer / Worker
The service that subscribes to and processes the event. Runs in the background, often as a separate process or pod.

### Dead Letter Queue (DLQ)
A queue where messages land after repeated processing failures. Used for debugging, alerting, and reprocessing.

---

## How It Works (Flow)

```
User Action / System Trigger
        |
        v
  [ Producer Service ]
        |
     publishes event
        |
        v
  [ Message Broker ]  <--- persists event
        |
     delivers message
        |
        v
  [ Consumer / Worker ]
        |
   processes job (async)
        |
        v
  [ Acknowledge / DLQ ]
```

---

## Key Design Decisions

### 1. At-Least-Once vs. Exactly-Once Delivery
| Delivery Guarantee | Behavior | Implication |
|---|---|---|
| At-least-once | Message may be delivered multiple times | Consumer must be **idempotent** |
| At-most-once | Message may be lost | Acceptable only for non-critical jobs |
| Exactly-once | Delivered precisely once | Expensive; requires transactional brokers (Kafka transactions) |

**Rule of thumb**: Design consumers to be idempotent. Exactly-once is hard to guarantee end-to-end.

### 2. Event Schema Design
- Use a **versioned schema** (e.g. `v1`, `v2`) to allow backward compatibility
- Include: `event_id`, `event_type`, `timestamp`, `source_service`, `payload`
- Avoid fat events (huge payloads); prefer **event notification** + fetch pattern when payload is large

### 3. Consumer Concurrency & Scaling
- Scale consumers independently of producers
- Use **competing consumers** pattern: multiple workers on the same queue share the load
- Be careful of race conditions when multiple consumers process related events

### 4. Ordering
- Queues typically do **not** guarantee ordering under concurrency
- Kafka guarantees ordering **within a partition** (partition by entity ID for ordered processing)
- Ask: does this job *require* strict ordering? Often it doesn't

### 5. Backpressure
- If consumers are slower than producers, the queue fills up
- Solutions: auto-scale consumers, rate-limit producers, use bounded queues with rejection policies

---

## Retry & Failure Strategy

```
Attempt 1 → fail
    ↓  (wait: 1s)
Attempt 2 → fail
    ↓  (wait: 4s)
Attempt 3 → fail
    ↓  (wait: 16s)
Max retries exceeded → Dead Letter Queue (DLQ)
    ↓
Alert / Manual review / Reprocess
```

- Use **exponential backoff with jitter** to avoid retry storms
- Set a **max retry count** (e.g. 3–5 attempts)
- Monitor DLQ size as a health signal
- Build a **reprocessing tool** to replay DLQ messages after a fix is deployed

---

## Idempotency

Since at-least-once delivery is the norm, consumers **must** handle duplicate events gracefully.

**Strategies:**
- **Idempotency key**: Store `event_id` in a DB; skip if already processed
- **Upsert operations**: `INSERT ... ON CONFLICT DO NOTHING`
- **State checks**: Only act if the entity is still in the expected state (`if order.status == 'pending'`)

---

## Transactional Outbox Pattern

**Problem**: How do you atomically write to your DB *and* publish an event without a distributed transaction?

**Solution:**
1. In the same DB transaction, write the business record **and** an outbox row
2. A separate poller (or CDC tool like Debezium) reads the outbox table and publishes to the broker
3. Mark the outbox row as published

```
[ Service ] ---(DB transaction)---> [ orders table ]
                                    [ outbox table ]  <--- poller reads this
                                          |
                                          v
                                   [ Message Broker ]
```

This guarantees no event is lost due to a crash between the DB write and the broker publish.

---

## Trade-offs

### ✅ Advantages

| Advantage | Detail |
|---|---|
| **Decoupling** | Producer and consumer evolve independently; no direct service-to-service calls |
| **Resilience** | Broker buffers work; consumers can go down and catch up when they restart |
| **Scalability** | Workers scale horizontally based on queue depth |
| **Responsiveness** | User-facing requests return fast; heavy work is deferred |
| **Auditability** | Event log is a natural audit trail of what happened and when |
| **Fan-out** | One event can trigger multiple independent consumers |

### ❌ Disadvantages

| Disadvantage | Detail |
|---|---|
| **Eventual consistency** | Data is not immediately consistent across services |
| **Debugging complexity** | Tracing a request across async hops requires distributed tracing |
| **Operational overhead** | Requires running, monitoring, and scaling a broker |
| **Duplicate processing** | At-least-once delivery mandates idempotency everywhere |
| **Ordering challenges** | Hard to guarantee strict ordering at high throughput |
| **Latency unpredictability** | Queue depth affects how fast a job actually runs |

---

## When to Use Event-Driven Background Jobs

**Use when:**
- The work does not need to complete before responding to the user
- The work is slow (e.g. sending email, resizing images, running ML inference)
- Multiple downstream systems need to react to the same event
- You want to decouple services to allow independent scaling/deployment
- You need to absorb traffic bursts without dropping work

**Avoid when:**
- The result is needed synchronously in the same request
- Ordering is critical and partitioning is too complex
- The system is very small and the overhead of a broker isn't justified (use a simple task queue or cron instead)

---

## Real-World Systems & Applications

### E-Commerce (Amazon, Shopify)
- `order.placed` → triggers: inventory reservation, payment processing, warehouse notification, email confirmation, fraud check — all as independent consumers on the same event
- Order status updates fan out to multiple downstream services via Kafka topics

### Ride-Sharing (Uber, Lyft)
- Driver location updates streamed via Kafka; background workers update geospatial indexes, calculate ETA, and trigger surge pricing models
- Trip completion event triggers: billing, rating prompt, driver payout calculation

### Social Media (LinkedIn, Twitter/X)
- `post.created` → fan-out service distributes the post to followers' feeds as a background job (fan-out on write)
- LinkedIn uses Kafka at massive scale to power activity feeds and notifications

### Payment Processing (Stripe)
- Webhook delivery is an event-driven background job: an internal event triggers a worker that delivers the webhook to the merchant's endpoint with retries and a DLQ
- Failed payment events trigger retry workers with exponential backoff

### Media Platforms (Netflix, YouTube)
- Video upload triggers a pipeline of background jobs: transcoding, thumbnail generation, virus scanning, CDN distribution — each as an independent consumer
- Netflix uses Apache Kafka extensively for their encoding pipeline and data pipelines

### Notifications (Slack, PagerDuty)
- Notification service subscribes to events from dozens of internal services and fans out to email, push, SMS, and in-app channels
- PagerDuty's alerting is fundamentally an event-driven background system

### Banking & Fintech
- Transaction events trigger: fraud detection (ML scoring), ledger update, statement generation, customer notification — all async consumers
- Event sourcing: the ledger *is* the event log

---

## Technology Choices

| Tool | Type | Best For |
|---|---|---|
| **Apache Kafka** | Log/Stream | High throughput, replay, ordered partitions, event sourcing |
| **AWS SQS** | Queue | Simple async decoupling, managed, at-least-once |
| **AWS SNS + SQS** | Pub-Sub + Queue | Fan-out to multiple queues |
| **RabbitMQ** | Queue + Pub-Sub | Flexible routing, complex topologies |
| **Google Pub/Sub** | Stream | GCP-native, auto-scaled, global |
| **Redis Streams** | Stream | Lightweight, low-latency, co-located with cache |
| **Celery + Redis/RabbitMQ** | Task Queue | Python-native worker framework |
| **Sidekiq** | Task Queue | Ruby/Rails background jobs |
| **BullMQ** | Task Queue | Node.js, Redis-backed |

---

## Observability Checklist

- [ ] **Queue depth** — is it growing? Are consumers keeping up?
- [ ] **Consumer lag** (Kafka) — time between event publish and consumption
- [ ] **Job duration** — p50, p95, p99 processing times
- [ ] **Error rate & retry rate** — spikes indicate broken consumers
- [ ] **DLQ size** — non-zero is a red flag requiring immediate investigation
- [ ] **Distributed tracing** — trace ID propagated through event payload (e.g. via OpenTelemetry)
- [ ] **Alerting** — alert on DLQ growth, consumer lag exceeding SLA thresholds

---

## Key Principles Summary

1. **Design consumers to be idempotent** — always
2. **Use the Transactional Outbox** to avoid dual-write problems
3. **Partition by entity ID** when ordering matters (Kafka)
4. **Monitor DLQ size** as a primary health signal
5. **Propagate trace IDs** through events for end-to-end observability
6. **Version your event schemas** before you need to
7. **Prefer thin events** (notification + fetch) for large payloads