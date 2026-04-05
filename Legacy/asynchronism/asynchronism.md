# Asynchronism

## Table of Contents
1. [Overview](#overview)
2. [Why Asynchronism?](#why-asynchronism)
3. [Core Patterns](#core-patterns)
   - [Message Queues](#1-message-queues)
   - [Task Queues](#2-task-queues)
   - [Event Streaming](#3-event-streaming)
   - [Publish/Subscribe (Pub/Sub)](#4-publishsubscribe-pubsub)
   - [Request/Reply (Async RPC)](#5-requestreply-async-rpc)
4. [Workflow Patterns](#workflow-patterns)
   - [Fan-Out / Fan-In](#fan-out--fan-in)
   - [Saga Pattern](#saga-pattern)
   - [Outbox Pattern](#outbox-pattern)
   - [Competing Consumers](#competing-consumers)
5. [Message Delivery Semantics](#message-delivery-semantics)
6. [Backpressure](#backpressure)
7. [Trade-offs](#trade-offs)
8. [Real-World Systems and Applications](#real-world-systems-and-applications)
9. [Technology Comparison](#technology-comparison)
10. [Decision Framework](#decision-framework)
11. [Anti-Patterns](#anti-patterns)
12. [Monitoring and Observability](#monitoring-and-observability)

---

## Overview

**Asynchronism** is an architectural approach where work is decoupled in time — a caller submits work and moves on without waiting for the result. The work is executed independently, typically by a separate process or service, at some future point.

Contrast with **synchronous communication**, where the caller blocks until the callee responds:

```
Synchronous:
Client ──request──► Service
Client ◄──response── Service     (client blocked the whole time)

Asynchronous:
Client ──enqueue──► Queue
Client ◄──ack──── Queue           (client free to continue)
Worker ◄──poll/push── Queue
Worker ──result──► Storage/Callback
```

Asynchronism is a foundational lever for achieving **scalability**, **resilience**, and **throughput** in distributed systems.

---

## Why Asynchronism?

| Problem (Synchronous World) | Asynchronous Solution |
|---|---|
| Slow downstream service blocks upstream | Decouple via queue; upstream returns immediately |
| Thundering herd crushes downstream | Queue absorbs bursts; consumers process at sustainable rate |
| One service crash cascades | Queue acts as buffer; messages survive crashes |
| Tight temporal coupling between services | Producer and consumer operate on independent schedules |
| Scaling bottleneck at the critical path | Offload expensive work off the hot path |
| Retry logic clutters business code | Queue infrastructure handles retries and DLQs |

**Fundamental principle:** You trade **immediacy** for **resilience, throughput, and decoupling.**

---

## Core Patterns

### 1. Message Queues

A **message queue** is a durable, ordered buffer that decouples producers from consumers. Producers push messages; consumers pull and process them.

```
Producer A ─┐
Producer B ─┼──► [Queue] ──► Consumer A
Producer C ─┘              └──► Consumer B
```

**Key properties:**
- **Point-to-point:** Each message is delivered to exactly one consumer (competing consumers)
- **Durability:** Messages persisted to disk, survive restarts
- **Acknowledgment:** Consumer explicitly ACKs a message after successful processing; unACKed messages are redelivered
- **Visibility timeout:** Message is hidden from other consumers while being processed

**Typical flow:**
1. Producer sends message to queue with a payload
2. Queue persists message (optionally with TTL)
3. Consumer polls or receives push notification
4. Consumer processes message, ACKs on success
5. On failure, message becomes visible again (or moved to DLQ after N retries)

**Use cases:** Order processing, email/notification dispatch, image/video transcoding jobs, async API calls.

**Examples:** Amazon SQS, RabbitMQ, ActiveMQ

---

### 2. Task Queues

A **task queue** is a higher-level abstraction over message queues, specifically for dispatching **units of work** (tasks/jobs) to a pool of workers. Task queues typically include:
- Worker management
- Result storage
- Task scheduling (delayed, periodic)
- Task priority
- Rate limiting per worker

```
Web Server ──enqueue task──► [Task Queue] ──► Worker Pool
                                               ├── Worker 1
                                               ├── Worker 2
                                               └── Worker N
                                                    └──► Result Store
```

**Celery** (Python) is the canonical task queue framework, typically backed by Redis or RabbitMQ as the broker and Redis or a database as the result backend.

**Use cases:** ML inference jobs, PDF generation, bulk email, report generation, webhook delivery.

---

### 3. Event Streaming

**Event streaming** platforms treat messages as an **immutable, ordered log**. Unlike traditional queues where messages are deleted after consumption, the log is retained and multiple consumers can independently read from any offset.

```
Producer ──append──► [Partitioned Log: Topic]
                        Partition 0: [e1, e2, e3, e4, e5 ...]
                        Partition 1: [e1, e2, e3, e4, e5 ...]
                            │
                    Consumer Group A (offset: 3)
                    Consumer Group B (offset: 5)
```

**Key concepts:**
- **Topic:** Named, ordered stream of records
- **Partition:** Unit of parallelism within a topic; messages within a partition are strictly ordered
- **Offset:** Position of a consumer within a partition; managed by consumer
- **Consumer Group:** Multiple consumers sharing the workload of a topic; each partition consumed by exactly one consumer within the group
- **Log Retention:** Messages retained for a configured period (hours/days/forever), enabling replay

**Use cases:** Real-time analytics pipelines, event sourcing, change data capture (CDC), audit logs, activity streams, stream processing.

**Examples:** Apache Kafka, AWS Kinesis, Apache Pulsar, Redpanda

---

### 4. Publish/Subscribe (Pub/Sub)

In **Pub/Sub**, producers publish messages to a **topic** without knowledge of who the subscribers are. Any number of subscribers receive a copy of every message. This is a **broadcast** model.

```
Publisher ──publish──► [Topic]
                           ├── Subscriber A (gets copy)
                           ├── Subscriber B (gets copy)
                           └── Subscriber C (gets copy)
```

**Distinction from streaming:** Pub/Sub is typically push-based with no replay; streaming logs retain messages and allow consumer-controlled offset seeking.

**Use cases:** Notification fan-out, real-time feeds, configuration change broadcasts, cross-service event notifications, IoT telemetry distribution.

**Examples:** Google Cloud Pub/Sub, AWS SNS, Redis Pub/Sub, NATS

---

### 5. Request/Reply (Async RPC)

An **async RPC** pattern decouples the request from the response using a correlation ID. The caller sends a request and provides a callback endpoint or polls for results.

```
Client ──request (correlationId: X)──► [Request Queue]
                                              └──► Worker
Worker ──result (correlationId: X)──► [Reply Queue]
Client ◄──polls or receives notification── [Reply Queue]
```

**Use cases:** Long-running computation where the client needs the result eventually (e.g., ML model inference, report generation with callback webhook, checkout with async payment verification).

---

## Workflow Patterns

### Fan-Out / Fan-In

**Fan-Out:** A single message triggers parallel execution across multiple workers/queues.

**Fan-In:** Results from multiple parallel tasks are aggregated into a single result.

```
                    ┌──► Worker A ──┐
Task ──► Dispatcher ├──► Worker B ──┼──► Aggregator ──► Final Result
                    └──► Worker C ──┘
```

**Example:** A video upload fans out to: thumbnail generation, transcoding (multiple resolutions), metadata extraction, CDN upload. Fan-in waits for all to complete before marking the upload as processed.

**Challenge:** Partial failures — one branch fails while others succeed. Solutions: idempotent retries, compensating transactions, or marking partial success.

---

### Saga Pattern

For **distributed transactions** across services, the Saga pattern replaces ACID transactions with a sequence of local transactions, each publishing an event/message to trigger the next step. On failure, compensating transactions roll back completed steps.

**Choreography-based Saga (event-driven):**
```
Order Service ──OrderCreated──► Payment Service
Payment Service ──PaymentProcessed──► Inventory Service
Inventory Service ──InventoryReserved──► Shipping Service
                                           └── failure ──► CompensateInventory ──► CompensatePayment
```

**Orchestration-based Saga:**
A central orchestrator sends commands to each participant service and awaits events in response, coordinating the overall flow explicitly.

| | Choreography | Orchestration |
|---|---|---|
| **Coupling** | Low (event-driven) | Higher (orchestrator knows participants) |
| **Visibility** | Harder to trace overall flow | Flow explicit in orchestrator |
| **Complexity** | Grows with service count | Complexity centralized |
| **Failure handling** | Distributed | Centralized |

**Use cases:** E-commerce order fulfillment, bank transfers, hotel/flight booking workflows.

---

### Outbox Pattern

The **Transactional Outbox** solves the dual-write problem: ensuring a database write and a message publish happen atomically.

**Problem:** If you write to DB then publish to queue, the process can crash between the two, leading to an inconsistent state (DB updated, no message sent — or vice versa).

**Solution:**
1. In the same DB transaction, write the business entity AND an outbox record to an `outbox` table.
2. A separate **relay process** (or CDC connector) reads uncommitted outbox records and publishes them to the message broker.
3. After successful publish, mark outbox record as processed.

```
Service ─── TX begin ─────────────────────────────────
             ├── INSERT INTO orders (...)
             └── INSERT INTO outbox (event_type, payload)
           TX commit

Relay ──read outbox──► Publish to Kafka/SQS ──ACK──► Mark as processed
```

**Guarantees:** At-least-once delivery (relay may re-publish if it crashes after publish but before marking processed — consumers must be idempotent).

---

### Competing Consumers

Multiple consumer instances read from the same queue, each grabbing a message, processing it, and ACKing. This enables horizontal scaling of consumer throughput.

```
[Queue] ──► Consumer Instance 1
       ──► Consumer Instance 2
       ──► Consumer Instance 3
```

**Key concerns:**
- **Ordering:** Messages processed in parallel — no ordering guarantees unless partitioning is used (e.g., Kafka partitions, SQS FIFO with message group IDs)
- **Idempotency:** Duplicate delivery is possible; consumer logic must handle it
- **Poison pill:** A message that consistently causes consumer crashes — handled via DLQ after max retries

---

## Message Delivery Semantics

| Semantic | Guarantee | Risk | Requirement |
|---|---|---|---|
| **At-most-once** | Message delivered 0 or 1 times | Message loss | Acceptable for non-critical events (metrics, logs) |
| **At-least-once** | Message delivered 1 or more times | Duplicates | Consumer must be **idempotent** |
| **Exactly-once** | Message delivered precisely once | Complex, expensive | Idempotency key + deduplication OR transactional APIs |

**Exactly-once in practice:**
- Kafka transactions + idempotent producers achieve exactly-once within Kafka
- End-to-end exactly-once requires idempotent consumers as well
- Most systems settle for at-least-once + idempotent consumers — cheaper and nearly as safe

**Achieving idempotency:**
- Include a unique message/event ID in the payload
- Consumer checks a deduplication store (Redis SET, DB unique constraint) before processing
- Use natural idempotency where possible (e.g., `UPDATE SET status='paid' WHERE status='pending'`)

---

## Backpressure

**Backpressure** is the mechanism by which a slow consumer signals to a fast producer to slow down, preventing memory exhaustion or queue overflow.

### Strategies

| Strategy | Description | Drawback |
|---|---|---|
| **Queue-based (natural)** | Queue depth grows; producer slows if queue has a max depth | Latency increases |
| **Rate limiting on producer** | Producer throttles based on consumer throughput signal | Requires coordination |
| **Load shedding** | Producer drops messages when queue is full | Data loss |
| **Bounded queues with blocking** | Producer blocks when queue is full | Producer stalls |
| **Reactive Streams** | Formal protocol (demand-driven) — consumer requests N items from producer | Requires framework support |

**Monitoring backpressure:** Track queue depth, consumer lag (especially in Kafka), and message age. Rising consumer lag is the primary signal that consumers cannot keep up.

---

## Trade-offs

### Asynchronism vs. Synchronous Communication

| Dimension | Synchronous | Asynchronous |
|---|---|---|
| **Latency** | Low end-to-end latency (if fast) | Added latency; result not immediate |
| **Coupling** | Temporal coupling (both must be up) | Temporal decoupling (producer/consumer independent) |
| **Throughput** | Bottlenecked by slowest service | High; queue absorbs bursts |
| **Fault tolerance** | Downstream failure = upstream failure | Downstream failure doesn't affect producer |
| **Consistency** | Easier to reason about | Eventual consistency; harder to reason about ordering |
| **Simplicity** | Simple request/response | Complexity in infrastructure and failure modes |
| **Backpressure** | Natural (caller waits) | Must be explicitly managed |
| **Debuggability** | Easy to trace | Distributed tracing required; harder to follow flow |

### Message Queues vs. Event Streaming

| Dimension | Message Queue | Event Streaming |
|---|---|---|
| **Message retention** | Deleted after consumption | Retained for configured period |
| **Consumer model** | Competing consumers (point-to-point) | Multiple independent consumer groups |
| **Replay** | Not supported | Supported (seek to any offset) |
| **Ordering** | Within queue (FIFO) | Per-partition strict ordering |
| **Throughput** | Moderate | Very high (millions of events/sec) |
| **Use case** | Task dispatch, job queues | Event sourcing, CDC, analytics pipelines |
| **Operational complexity** | Lower (SQS, RabbitMQ) | Higher (Kafka clusters, Zookeeper/KRaft) |

### Key Asynchronism Trade-offs

- **Complexity overhead:** Async systems require DLQs, retry policies, idempotency, distributed tracing, and monitoring consumer lag — significantly more operational surface area than synchronous APIs.
- **Eventual consistency:** The system is eventually consistent during the window between message enqueue and consumption. Business logic must tolerate this.
- **Error handling is non-trivial:** Failures don't propagate back to the caller. A message may fail silently and land in a DLQ without anyone noticing.
- **Ordering guarantees require design:** Achieving strict ordering in parallel consumers requires partitioning strategies, which limit parallelism.
- **Testing is harder:** Async flows are harder to test end-to-end; requires test harnesses that drain queues or consume events.

---

## Real-World Systems and Applications

### Uber — Async Dispatch and Surge

Uber's dispatch system uses async messaging to match riders with drivers. When a ride request is made, it's placed in a queue. Matching algorithms run asynchronously. This decouples the API response (instant acknowledgment) from the computationally expensive matching work. During surge, queue depth increases but the API remains responsive — backpressure is absorbed by the queue.

### Airbnb — Task Queue for Search Index Updates

When a host updates listing data, Airbnb enqueues an indexing job via a task queue (Celery + Redis) rather than synchronously updating the search index on the hot path. The API response is immediate; search reflects the change within seconds.

### Netflix — Kafka for Event Streaming

Netflix processes hundreds of billions of events per day through Apache Kafka. Key use cases:
- **Viewing history:** Each play event streamed to Kafka; consumed by recommendation engines, billing, and analytics pipelines independently.
- **Error monitoring:** Client-side errors streamed in real-time to Kafka topics, consumed by alerting systems.
- **CDC:** Database changes replicated to Kafka via Debezium, fanning out to downstream services without direct DB coupling.

### Stripe — Async Webhook Delivery

When an event occurs (e.g., `payment_intent.succeeded`), Stripe enqueues a webhook delivery task. Workers attempt delivery with exponential backoff, retrying for up to 3 days. This decouples event generation from delivery latency/reliability of merchant endpoints. Stripe exposes delivery status and allows manual replay — a direct analog of the DLQ/requeue pattern.

### Shopify — Job Queue for Flash Sales

During high-traffic events (e.g., a celebrity merchandise drop), Shopify's checkout flow uses async job queues to process orders. The API ACKs the checkout immediately; inventory reservation, payment processing, and fulfillment are handled by background workers. This prevents timeouts and allows horizontal scaling of workers independently from the web layer.

### Amazon — Order Fulfillment Saga

Amazon's order fulfillment pipeline is a classic Saga: payment authorization, warehouse reservation, shipping label generation, and carrier hand-off are orchestrated as a sequence of async steps. Each step publishes to an SNS topic; downstream services subscribe. Compensating transactions handle partial failures (e.g., payment succeeded but inventory unavailable → refund triggered).

### Discord — Message Fan-Out

When a user sends a message to a large server (e.g., 100k members), Discord fans out the message delivery asynchronously via a queue. Direct delivery to all online members' connections happens in parallel via a pub/sub system (backed by Elixir processes and Cassandra for persistence). Without async fan-out, a single message send to a large server would block for seconds.

### GitHub — CI/CD Job Queue

GitHub Actions uses a task queue to dispatch CI/CD jobs to available runner pools. Jobs are enqueued on push/PR events; runners pick them up as capacity is available. This decouples the Git event from runner availability and supports burst capacity without blocking the Git API.

---

## Technology Comparison

| Technology | Type | Throughput | Retention | Ordering | Best For |
|---|---|---|---|---|---|
| **Apache Kafka** | Event streaming log | Very high (millions/s) | Configurable (days/forever) | Per-partition | CDC, event sourcing, analytics pipelines |
| **Amazon SQS** | Managed queue | High | Up to 14 days | FIFO (standard has best-effort) | Simple task queues, AWS-native workloads |
| **RabbitMQ** | Message broker | Moderate-high | Until consumed | Per-queue | Complex routing, task queues, RPC patterns |
| **Amazon SNS** | Pub/sub fanout | High | No retention | No ordering | Notification broadcast, trigger fan-out |
| **Google Pub/Sub** | Managed pub/sub | High | 7 days | No global ordering | GCP-native event delivery |
| **Redis Streams** | Lightweight streaming | High | Configurable | Per-stream | Low-latency, lightweight event streaming |
| **Celery** | Task queue framework | Depends on broker | Depends on broker | Priority-based | Python async tasks, scheduled jobs |
| **Apache Pulsar** | Unified messaging | Very high | Tiered storage | Per-partition | Multi-tenant, geo-replicated streams |

---

## Decision Framework

### When to use Asynchronism

```
Is the result needed immediately by the caller?
├── Yes → Is the operation fast (< ~200ms)?
│   ├── Yes → Synchronous is fine
│   └── No → Can the UX tolerate "pending" state + polling/webhook?
│       ├── Yes → Async (queue + callback)
│       └── No → Must optimize the synchronous path
└── No → Async (always prefer for non-immediate work)

Is the workload bursty?
└── Yes → Queue to absorb bursts; async consumer scales independently

Does the operation need to be durable (survive crashes)?
└── Yes → Durable async queue (not in-memory)

Do multiple consumers need the same event independently?
├── Yes → Pub/Sub or Event Streaming
└── No → Point-to-point Queue

Does consumer need to replay past events?
├── Yes → Event Streaming (Kafka, Kinesis)
└── No → Message Queue (SQS, RabbitMQ)

Is this a multi-step distributed transaction?
└── Yes → Saga pattern (choreography or orchestration)

Is the cross-service boundary crossing a DB write?
└── Yes → Outbox Pattern for atomic dual-write
```

### Queue vs. Streaming Decision

| Use Streaming (Kafka) if... | Use Queue (SQS/RabbitMQ) if... |
|---|---|
| Multiple independent consumers need same events | Single consumer per message (task dispatch) |
| Replay / event sourcing needed | Fire-and-forget job processing |
| Very high throughput (> 100k events/s) | Moderate throughput sufficient |
| Building an event-driven audit log | Simple work distribution to workers |
| CDC / database change propagation | Scheduled background jobs |

---

## Anti-Patterns

**1. Async Everything**
Not every operation benefits from asynchronism. Adding a queue to a fast, non-critical path introduces latency, complexity, and operational overhead for no gain.

**2. Ignoring the Dead Letter Queue (DLQ)**
A DLQ collects messages that failed repeatedly. If nobody monitors or processes the DLQ, failures are silently swallowed. Always have an alerting rule on DLQ depth and an operational runbook for reprocessing.

**3. Non-Idempotent Consumers with At-Least-Once Delivery**
Any queue with at-least-once semantics will deliver duplicates. If the consumer charges a credit card or sends an email on every delivery without idempotency checks, you will double-charge or double-send.

**4. Giant Messages**
Queues are optimized for high-throughput small payloads. Putting large binary blobs (images, PDFs) directly in messages causes serialization overhead and hits message size limits (SQS: 256KB, Kafka: 1MB default). Use the **claim-check pattern**: store large payloads in S3/blob storage, include only the reference URL in the message.

**5. Unbounded Queue Growth (Missing Backpressure)**
If producers outpace consumers indefinitely, queue depth grows unbounded, leading to memory exhaustion, increased message age, and SLA violations. Monitor consumer lag and implement autoscaling or load shedding.

**6. Synchronous Fallback Hidden in Async Wrapper**
An async wrapper that internally blocks on a synchronous call gives you the worst of both worlds: async complexity without the throughput benefits. Ensure the async boundary actually decouples execution.

**7. Overloading a Single Topic/Queue**
Routing all event types through a single topic creates noisy, hard-to-manage consumers. Partition topics by domain/event type so consumers can subscribe selectively and schema evolution is manageable.

**8. Chained Synchronous Calls Within an Async Worker**
A worker that processes a message by making 10 synchronous downstream HTTP calls negates the benefits of async. Long chains of sync calls within a worker are fragile; consider breaking them into further async steps.

---

## Monitoring and Observability

### Key Metrics

| Metric | What it Signals | Alert Threshold |
|---|---|---|
| **Queue depth / consumer lag** | Consumers falling behind producers | Growing trend over time |
| **Message age (oldest message)** | SLA violations if messages sit too long | Exceeds SLA window |
| **DLQ depth** | Silent failures in consumer processing | Any non-zero growth |
| **Consumer throughput (msgs/s)** | Worker capacity and scaling need | Drop below baseline |
| **Producer throughput (msgs/s)** | Traffic spikes, producer failures | Sudden drop or spike |
| **Processing latency (p99)** | Worker slowness | Exceeds SLA |
| **Retry rate** | Systemic consumer errors | High % of messages retried |
| **Ack/Nack ratio** | Consumer failure rate | Nack rate above threshold |

### Distributed Tracing for Async Systems

Propagate trace context (e.g., W3C Trace Context headers) in message payloads. Without it, a trace ends at the producer and you cannot correlate the downstream worker execution to the originating request.

```json
{
  "event_type": "order.created",
  "order_id": "ord_123",
  "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "payload": { ... }
}
```

Tools: Jaeger, Zipkin, Datadog APM, AWS X-Ray, OpenTelemetry.

### Operational Runbooks

Every async system should have documented runbooks for:
- **DLQ reprocessing:** How to inspect, triage, and replay DLQ messages
- **Consumer lag remediation:** How to scale consumers and identify root cause
- **Queue overflow:** What to shed, what to preserve
- **Poison pill removal:** How to skip and quarantine a message causing repeated consumer crashes