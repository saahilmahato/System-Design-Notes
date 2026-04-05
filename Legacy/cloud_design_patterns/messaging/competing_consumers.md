# Competing Consumers Pattern

## Overview

The **Competing Consumers** pattern enables multiple concurrent consumers to process messages from the same message queue simultaneously. Each message is delivered to exactly one consumer, allowing the system to process many messages in parallel, increase throughput, and improve scalability without coordinating consumers explicitly.

This pattern is a foundational building block for **asynchronous, distributed workload processing** — it decouples producers from consumers and lets the system absorb bursts of load by scaling consumers horizontally.

---

## Core Concepts

### The Problem It Solves

A single consumer processing a queue sequentially becomes a bottleneck as message volume grows. Scaling vertically (bigger machine) has limits and introduces a single point of failure. The system needs a way to distribute work across multiple workers automatically and safely.

### How It Works

```
Producers
  │
  ▼
┌─────────────────────────────────┐
│         Message Queue           │  ← Single logical queue (or topic)
│  [M1] [M2] [M3] [M4] [M5] ...  │
└─────────┬──────────┬────────────┘
          │          │
    ┌─────▼──┐  ┌────▼───┐  ┌─────────┐
    │Consumer│  │Consumer│  │Consumer │  ← Competing consumers
    │   A    │  │   B    │  │    C    │
    └────────┘  └────────┘  └─────────┘
       M1, M4      M2, M5       M3
```

- **Producers** push messages to a shared queue without knowing which consumer will handle them.
- The **message broker** distributes messages to idle/available consumers (typically round-robin or first-available).
- Each message is consumed by **exactly one** consumer (at-least-once or exactly-once depending on broker guarantees).
- Consumers **compete** for messages — whichever is free first claims the next message.

### Message Lifecycle

```
Producer → Enqueue → [Queue] → Dequeue (lock/ack) → Consumer Processing → Acknowledge (delete)
                                                                         ↘ Failure → Requeue / DLQ
```

1. **Enqueue** — Producer sends message.
2. **Dequeue + Lock** — Consumer polls; broker marks message as "in-flight" (invisible to others).
3. **Processing** — Consumer handles the work.
4. **Acknowledge** — Consumer sends ACK; broker permanently deletes message.
5. **Failure / Timeout** — If no ACK within visibility timeout, broker makes message visible again for re-delivery.

---

## Architecture Components

| Component | Role |
|---|---|
| **Message Broker** | Manages the queue, handles durability, delivery guarantees, and routing |
| **Producer** | Generates work items; decoupled from consumers |
| **Consumer Pool** | N worker processes/threads pulling from the same queue |
| **Dead Letter Queue (DLQ)** | Captures messages that repeatedly fail processing |
| **Visibility Timeout** | Duration a message is hidden after being dequeued; prevents duplicate processing |
| **Heartbeat / Lease Renewal** | Allows long-running consumers to extend their lock before timeout |

---

## Delivery Guarantees

| Guarantee | Description | Implication for Consumers |
|---|---|---|
| **At-Least-Once** | Message delivered one or more times | Consumer logic must be **idempotent** |
| **At-Most-Once** | Delivered once; may be lost on failure | Acceptable only for non-critical, lossy workloads |
| **Exactly-Once** | Delivered exactly once | Requires broker + consumer coordination (expensive); supported by Kafka with transactions, SQS FIFO with dedup IDs |

**Most systems default to at-least-once.** Design consumers to be idempotent.

---

## Scaling Behavior

```
Low Load                         High Load
┌────────┐                       ┌────────┐
│Queue   │ [M1][M2]              │Queue   │ [M1][M2][M3]...[M100]
└───┬────┘                       └──┬──┬──┘
    │                               │  │  │
┌───▼───┐                      ┌────▼┐┌▼──┐┌▼────┐
│C1     │                      │C1   ││C2  ││C3   │  ... auto-scale
└───────┘                      └─────┘└────┘└─────┘
```

- Scale **out** (add consumers) when queue depth grows.
- Scale **in** (remove consumers) when queue drains.
- Scaling decisions are driven by **queue depth** and **message age** metrics.
- Consumers are stateless — any consumer can handle any message.

---

## Idempotency Design

Since at-least-once delivery means duplicate messages are possible, consumer logic **must be idempotent**.

### Strategies

| Strategy | Approach |
|---|---|
| **Natural idempotency** | Operation is inherently safe to repeat (e.g., `SET balance = X`, not `balance += X`) |
| **Deduplication store** | Track processed message IDs in Redis/DB with TTL |
| **Conditional writes** | Use database constraints or optimistic locking to reject duplicate updates |
| **Idempotency keys** | Producer assigns a unique key per logical operation; consumer checks before processing |

```
Consumer receives M1 (id: "order-123-payment")
  → Check Redis: EXISTS "processed:order-123-payment"?
    YES → Skip (already processed)
    NO  → Process → SET "processed:order-123-payment" EX 86400 → ACK
```

---

## Message Ordering

Competing consumers **break FIFO ordering** by default — multiple consumers process in parallel at different speeds.

| Need | Solution |
|---|---|
| **No ordering required** | Standard competing consumers (maximum throughput) |
| **Per-entity ordering** | Partition by entity ID (e.g., Kafka partition by `user_id`; SQS FIFO message groups) |
| **Global strict ordering** | Single consumer (sacrifices parallelism); rarely needed |

---

## Poison Messages and DLQ

A **poison message** is one that consistently causes consumer failures (bad format, unhandleable content).

```
Message → Consumer → FAIL
       → Requeue (attempt 1)
       → Consumer → FAIL
       → Requeue (attempt 2)
       → Consumer → FAIL
       → After N retries → Dead Letter Queue (DLQ)
```

- **DLQ** holds failed messages for inspection, debugging, and manual replay.
- Set a **max delivery count** (e.g., 3–5 retries) before routing to DLQ.
- Alert on DLQ depth to detect systemic processing failures.

---

## Backpressure and Queue Depth

Queue depth is the primary signal for both scaling and health.

```
Producer Rate > Consumer Rate  →  Queue grows  →  Scale out consumers
Producer Rate < Consumer Rate  →  Queue drains →  Scale in consumers
Queue depth > SLA threshold    →  Alert        →  Potential processing lag
Messages age > SLA threshold   →  Alert        →  Consumers may be stuck or undersized
```

Metrics to track:
- `ApproximateNumberOfMessages` — queue depth
- `ApproximateAgeOfOldestMessage` — oldest unprocessed message age
- `NumberOfMessagesSent` — producer rate
- `NumberOfMessagesDeleted` — consumer throughput

---

## Trade-offs

### Advantages

| Benefit | Detail |
|---|---|
| **Horizontal scalability** | Add consumers linearly to increase throughput |
| **High availability** | Consumer failure doesn't drop messages; another consumer picks up |
| **Load leveling** | Queue absorbs traffic spikes; consumers work at steady rate |
| **Producer-consumer decoupling** | Producers don't block on consumer availability |
| **Fault isolation** | A slow or crashed consumer doesn't affect others |
| **Operational simplicity** | No explicit work assignment logic needed — queue handles distribution |

### Disadvantages

| Drawback | Detail |
|---|---|
| **No guaranteed ordering** | Parallel consumers destroy message sequence (mitigate with partitioning) |
| **At-least-once complexity** | Idempotency required everywhere; adds development overhead |
| **Visibility timeout tuning** | Too short → duplicates; too long → slow re-delivery after failure |
| **Message loss risk** | At-most-once brokers or improper ACK handling can silently drop work |
| **DLQ management overhead** | Poison messages require monitoring and replay infrastructure |
| **Latency floor** | Async processing introduces inherent latency vs. synchronous handling |
| **Debugging difficulty** | Distributed consumers, non-sequential processing makes tracing harder |

---

## Common Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **ACK before processing** | Message deleted before work completes; data loss on crash | ACK only after successful processing |
| **No idempotency** | Duplicate messages cause double-processing (double charges, duplicate records) | Deduplication store or natural idempotency |
| **Unbounded retries** | Poison messages loop forever, clogging the queue | Set max delivery count → DLQ |
| **Long processing without heartbeat** | Visibility timeout expires; message re-delivered while original is still processing | Extend lease periodically for long jobs |
| **Shared mutable state** | Consumers race on shared data structures | Use atomic DB operations or distributed locks |
| **Processing without logging** | Can't trace which consumer processed which message | Log consumer ID, message ID, and outcome |
| **Scaling by CPU alone** | Queue depth not factored into autoscaling | Drive autoscaling by queue depth + message age |

---

## Real-World Systems and Applications

### Amazon SQS
- Standard queues: at-least-once, unordered — classic competing consumers.
- FIFO queues: exactly-once within message groups, preserves per-group order.
- Visibility timeout mechanism is the lock primitive.
- Native integration with Lambda (Lambda scales consumers automatically based on queue depth).

### Apache Kafka (Consumer Groups)
- Competing consumers implemented via **consumer groups**: each partition assigned to one consumer in the group.
- Add consumers up to the number of partitions for horizontal scaling.
- Per-partition ordering preserved; global ordering not guaranteed.
- Used by: LinkedIn (activity feeds), Uber (trip events), Confluent ecosystem.

### RabbitMQ
- Work queues with multiple consumers are the canonical competing consumers implementation.
- Supports `basicQos` (prefetch count) to prevent a single consumer from hoarding messages.
- Used by: Instagram (notification delivery), Mailchimp (email dispatch pipelines).

### Azure Service Bus
- Competing consumers via queues and topic subscriptions.
- Message lock duration = visibility timeout equivalent.
- Dead-letter sub-queue built in.
- Used widely in Azure-native enterprise workloads.

### Google Cloud Pub/Sub
- Pull subscriptions with multiple subscribers compete for messages.
- Ack deadline = visibility timeout.
- Used by: Spotify (event pipelines), Snapchat (analytics ingestion).

### Industry Use Cases

| Company | Use Case | Pattern Detail |
|---|---|---|
| **Uber** | Surge pricing recalculation | Trip events enqueued; multiple pricing workers compete to compute fares |
| **Netflix** | Video encoding pipeline | Upload events enqueued; competing encoder workers claim and transcode videos |
| **Shopify** | Order processing at peak (BFCM) | Checkout events queued; competing order workers process payments and inventory |
| **Stripe** | Webhook delivery | Webhook events enqueued; competing delivery workers attempt HTTP dispatch with retry |
| **GitHub** | CI/CD job dispatch | Build jobs enqueued; competing runner agents claim and execute builds |
| **Airbnb** | Email/notification delivery | Notification events enqueued; competing mailer workers send emails via SES/SendGrid |

---

## When to Use

✅ **Use Competing Consumers when:**
- Workload is parallelizable and messages are independent.
- You need horizontal scaling of processing capacity.
- You want fault-tolerant processing (consumer failure shouldn't drop work).
- You have bursty traffic and want to smooth out processing load.
- Tasks are fire-and-forget or async from the producer's perspective.

❌ **Avoid Competing Consumers when:**
- Strict global message ordering is required (use a single consumer or ordered partitioning).
- Tasks have complex dependencies on each other (use a workflow orchestrator — Temporal, AWS Step Functions).
- Response must be synchronous and low-latency (use request-reply pattern instead).
- Exactly-once semantics are critical and your broker doesn't support it natively.

---

## Decision Framework

```
Is the workload parallelizable?
  └── NO  → Single consumer or orchestrator (e.g., Temporal)
  └── YES → Does ordering matter?
              └── Global strict order → Single consumer + queue
              └── Per-entity order   → Partitioned queue (Kafka, SQS FIFO groups)
              └── No ordering        → Standard competing consumers ✅
                                        └── At-least-once delivery?
                                              └── YES → Implement idempotency
                                              └── NO  → Validate broker's exactly-once support
```

---

## Monitoring & Observability

| Metric | Alert Condition | Meaning |
|---|---|---|
| `queue_depth` | > threshold (e.g., 10k) | Consumers falling behind; scale out |
| `oldest_message_age` | > SLA (e.g., 5 min) | Processing stalled or too slow |
| `consumer_error_rate` | Spike | Systemic processing failures; check DLQ |
| `dlq_depth` | > 0 | Poison messages present; investigate |
| `consumer_processing_time` | P99 spike | Performance regression in consumer logic |
| `consumer_count` | Drops unexpectedly | Consumer crash; check autoscaling |

---

## Quick Reference Cheat Sheet

| Concern | Recommendation |
|---|---|
| Delivery guarantee | Default to **at-least-once**; design idempotent consumers |
| Ordering | Partition by entity key if needed; skip if truly independent |
| Visibility timeout | Set to **2–3× max expected processing time** |
| Retry policy | **3–5 retries** with exponential backoff → DLQ |
| Scaling signal | **Queue depth + message age** (not CPU) |
| Consumer design | **Stateless** — any message handleable by any consumer |
| DLQ | Always configure; alert on any depth > 0 |
| Poison messages | Cap retries; log failure reason; alert on DLQ growth |