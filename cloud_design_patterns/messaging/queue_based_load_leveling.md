# Queue-Based Load Leveling

> **Pattern Category:** Cloud Design Patterns → Messaging
> **Also Known As:** Buffer Pattern, Work Queue Pattern

---

## 1. Overview

**Queue-Based Load Leveling** introduces a message queue between producers (clients/services generating requests) and consumers (services processing those requests) to act as a buffer. This decouples the rate at which work arrives from the rate at which work is processed, smoothing out spikes in demand so that downstream services are never overwhelmed.

The core insight is that **availability and throughput are more important than instantaneous latency** in many workloads — it's better for a task to wait a few seconds in a queue than for the service to crash or degrade under burst load.

```
WITHOUT Queue-Based Load Leveling:

  [Clients] ──── burst of 10,000 req/s ────► [Service]  ← overwhelmed, errors, crashes


WITH Queue-Based Load Leveling:

  [Clients] ──── burst of 10,000 req/s ────► [Queue]  ──── steady 500 req/s ────► [Service]
                                               (buffer)                              (stable)
```

---

## 2. How It Works

```
┌─────────────┐     enqueue      ┌──────────────────┐     dequeue     ┌──────────────┐
│  Producers  │ ───────────────► │   Message Queue  │ ───────────────►│  Consumers   │
│  (Clients,  │                  │                  │                 │  (Workers,   │
│   Services) │                  │  ┌─┐┌─┐┌─┐┌─┐   │                 │   Services)  │
└─────────────┘                  │  └─┘└─┘└─┘└─┘   │                 └──────────────┘
                                 │  buffered msgs   │                        │
                                 └──────────────────┘                        │
                                          ▲                                  │
                                          │         ack / delete msg         │
                                          └──────────────────────────────────┘
```

**Step-by-step flow:**

1. **Producer** generates a task/request and places it as a message on the queue — fire and forget.
2. **Queue** persists the message durably (typically on disk), making it available to consumers.
3. **Consumer** polls or receives messages from the queue, processes them at its own pace.
4. On successful processing, the consumer **acknowledges** the message; it is then removed from the queue.
5. On failure, the message becomes visible again (visibility timeout) and is retried or routed to a **Dead Letter Queue (DLQ)**.

---

## 3. Key Concepts

| Concept | Description |
|---|---|
| **Queue Depth** | Number of messages currently sitting in the queue; the primary health signal |
| **Visibility Timeout** | Time a message is hidden after being picked up; prevents double-processing |
| **Dead Letter Queue (DLQ)** | Separate queue for messages that exceed max retry attempts |
| **Message TTL** | Maximum time a message survives in the queue before expiry |
| **Polling vs Push** | Consumer actively polls (SQS) or broker pushes messages (RabbitMQ, Kafka) |
| **Acknowledgment** | Explicit consumer signal that processing succeeded; triggers deletion |
| **Batch Size** | Number of messages a consumer fetches in a single poll; tuning knob for throughput |

---

## 4. When to Use

- **Bursty, unpredictable traffic** — flash sales, event-driven spikes, batch job submissions.
- **Producer and consumer have mismatched throughput** — producer is fast; consumer is slow (e.g., video encoding, ML inference).
- **Tasks are async by nature** — email sending, report generation, notification dispatch.
- **Downstream service has hard rate limits** — third-party APIs, licensed databases.
- **Workloads that can tolerate eventual processing** — not suitable for real-time, synchronous user-facing responses.

---

## 5. When NOT to Use

- When the client **requires a synchronous, low-latency response** (e.g., payment confirmation UI blocking on result).
- When **message ordering is critical** and your queue doesn't support FIFO semantics reliably.
- When the **queue itself becomes the bottleneck** — queues are not infinitely scalable without proper partitioning.
- When **tasks are very short-lived** — queueing overhead may exceed processing time.

---

## 6. Trade-offs

| Dimension | Benefit | Cost |
|---|---|---|
| **Availability** | Producer never blocks on consumer downtime | Queue must itself be highly available (adds infra complexity) |
| **Scalability** | Consumers can auto-scale based on queue depth | Consumer fleet management and scaling lag adds operational burden |
| **Resilience** | Burst traffic absorbed; no cascading overload failures | DLQ handling and poison message management required |
| **Latency** | Producer responds immediately (fast enqueue) | End-to-end latency increases (queue wait time added) |
| **Decoupling** | Producer and consumer evolve independently | Harder to trace request flows; distributed debugging complexity |
| **Throughput** | Steady, predictable processing rate for consumers | Peak consumer throughput still bounded by single-service capacity |
| **Ordering** | FIFO queues preserve order if needed | FIFO throughput is lower than standard queues; partitioning required at scale |
| **Durability** | Messages persisted; survive consumer crashes | Storage cost, serialization overhead |
| **Cost** | Cheaper than over-provisioning compute for peak load | Queue storage and message-count costs; egress costs at scale |
| **Idempotency** | Retry-safe processing if consumers are idempotent | Requires explicit idempotency design (deduplication IDs, DB upserts) |

---

## 7. Architecture Patterns & Variations

### 7.1 Competing Consumers (Fan-Out to Workers)
Multiple consumer instances read from the same queue; each message processed by exactly one consumer. Classic horizontal scaling pattern.

```
           ┌─────────────┐
           │    Queue    │
           └──────┬──────┘
        ┌─────────┼─────────┐
        ▼         ▼         ▼
   [Worker 1] [Worker 2] [Worker 3]   ← each processes a unique message
```

### 7.2 Priority Queue
Multiple queues with different priorities; consumers drain high-priority queue first.

```
[High-Priority Queue]  ──► [Consumer] (checked first)
[Low-Priority Queue]   ──► [Consumer] (checked when high-prio is empty)
```

### 7.3 Chained Queues (Pipeline)
Output of one processing stage enqueues into the next queue — pipeline of transformations.

```
[Ingest Queue] → [Validator Workers] → [Transform Queue] → [Enrichment Workers] → [Output Queue]
```

### 7.4 Dead Letter Queue (DLQ)
Poison messages that repeatedly fail are routed to a DLQ for manual inspection or automated alerting.

```
[Main Queue] ──► [Consumer] ──► (failure × maxRetries) ──► [Dead Letter Queue] ──► [Alerting]
```

### 7.5 Auto-Scaling Based on Queue Depth
Consumers scale out when queue depth exceeds a threshold; scale in when queue drains.

```
Queue Depth > 1000  →  Scale Out consumers
Queue Depth < 100   →  Scale In consumers
```

---

## 8. Implementation

### 8.1 AWS SQS (Python)

```python
import boto3
import json

sqs = boto3.client('sqs', region_name='us-east-1')
QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue'

# Producer: enqueue a job
def enqueue_job(payload: dict):
    response = sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps(payload),
        MessageDeduplicationId=payload['job_id'],  # FIFO queue dedup
        MessageGroupId='default'
    )
    return response['MessageId']

# Consumer: poll and process
def process_messages():
    while True:
        response = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            MaxNumberOfMessages=10,       # batch receive
            WaitTimeSeconds=20,           # long polling
            VisibilityTimeout=60          # 60s to process before retry
        )
        messages = response.get('Messages', [])
        for msg in messages:
            try:
                body = json.loads(msg['Body'])
                handle_job(body)
                # Delete on success
                sqs.delete_message(
                    QueueUrl=QUEUE_URL,
                    ReceiptHandle=msg['ReceiptHandle']
                )
            except Exception as e:
                # Don't delete — message becomes visible again after VisibilityTimeout
                log_error(e)
```

### 8.2 RabbitMQ (Go)

```go
conn, _ := amqp.Dial("amqp://guest:guest@localhost:5672/")
ch, _ := conn.Channel()

// Declare durable queue
q, _ := ch.QueueDeclare("jobs", true, false, false, false, nil)

// Producer
ch.Publish("", q.Name, false, false, amqp.Publishing{
    DeliveryMode: amqp.Persistent,         // survive broker restart
    ContentType:  "application/json",
    Body:         []byte(`{"job_id":"123"}`),
})

// Consumer with manual ack
msgs, _ := ch.Consume(q.Name, "", false, false, false, false, nil)
for msg := range msgs {
    if err := processJob(msg.Body); err != nil {
        msg.Nack(false, true) // requeue
    } else {
        msg.Ack(false)        // remove from queue
    }
}
```

### 8.3 Kubernetes HPA Based on Queue Depth (KEDA)

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-scaler
spec:
  scaleTargetRef:
    name: worker-deployment
  minReplicaCount: 1
  maxReplicaCount: 50
  triggers:
    - type: aws-sqs-queue
      metadata:
        queueURL: https://sqs.us-east-1.amazonaws.com/123456789/my-queue
        queueLength: "100"       # scale up when >100 msgs per replica
        awsRegion: us-east-1
```

---

## 9. Critical Design Decisions

### 9.1 Idempotency
Queues deliver at-least-once; consumers **must** be idempotent.

```
Strategies:
  - Deduplication ID in message header → check DB before processing
  - Upsert semantics in DB writes (INSERT ON CONFLICT DO NOTHING)
  - Idempotency key stored in Redis with TTL
```

### 9.2 Message Schema & Versioning
- Always include a `version` field in message payload.
- Use schema registry (Confluent, AWS Glue) for Avro/Protobuf schemas.
- Consumers should be backward-compatible — ignore unknown fields.

### 9.3 Poison Message Handling
- Set `maxReceiveCount` (SQS) or `x-max-retries` (RabbitMQ).
- Route to DLQ after max retries.
- Alert and monitor DLQ depth — it signals systematic failures.

### 9.4 Visibility Timeout Tuning
- Must be longer than the **P99 processing time**.
- Too short → duplicate processing.
- Too long → failure recovery is slow.

---

## 10. Real-World Systems & Applications

### 10.1 Stripe — Payment Processing
- Stripe uses internal queues to buffer payment webhook delivery to merchants.
- If a merchant endpoint is slow or down, messages accumulate in the queue; retries are backed off exponentially.
- Guarantees **at-least-once delivery** with idempotency keys to prevent double-charging.

### 10.2 Netflix — Video Encoding Pipeline
- When a video is uploaded, a message is placed on a queue.
- Encoding workers (transcoding service "Archer") consume jobs at their capacity regardless of upload spikes.
- Multiple encoding jobs (4K, 1080p, 720p) fan out across separate queues/workers in parallel.
- Queue depth is monitored to auto-scale the encoding fleet.

### 10.3 Uber — Dispatch & Trip Events
- Driver location updates and trip state changes are queued (via Kafka topics acting as queues) before being consumed by downstream services (ETA computation, surge pricing, notifications).
- Kafka's consumer group model implements competing consumers — multiple instances of a service share the load from a topic partition.

### 10.4 Amazon — Order Processing
- When a customer places an order, an order event is enqueued.
- Downstream consumers handle inventory reservation, payment capture, fulfillment, and notification independently and asynchronously.
- Decoupling means a slowdown in the fulfillment system does not block order acceptance.

### 10.5 GitHub — CI/CD Job Scheduling
- GitHub Actions queues workflow run requests when submitted.
- Runner agents (consumers) pick up jobs as capacity is available.
- During push-time spikes (e.g., end of sprint), jobs queue up rather than timing out.

### 10.6 Discord — Message Fanout
- When a user sends a message to a large server (100k+ members), Discord queues fanout tasks.
- Rather than synchronously pushing to all online members, tasks are enqueued and processed by notification workers.

### 10.7 Shopify — Flash Sale Traffic
- During high-traffic events (Black Friday), Shopify queues checkout requests.
- Customers are shown a "virtual waiting room" while their checkout task waits in queue.
- Backend processes at a stable, safe throughput rather than collapsing under burst.

---

## 11. Monitoring & Observability

| Metric | Description | Alert Threshold |
|---|---|---|
| **Queue Depth** | Messages waiting to be processed | > X messages (business SLA-dependent) |
| **Queue Depth Growth Rate** | Is the queue draining or growing? | Positive slope sustained > 5 min |
| **Consumer Lag** | Age of oldest unprocessed message | > processing SLA (e.g., > 30s) |
| **Message Processing Time (P50/P99)** | Consumer processing duration | P99 approaching visibility timeout |
| **DLQ Depth** | Poison/failed messages accumulated | > 0 (alert immediately) |
| **Throughput (msgs/sec)** | Producer enqueue rate vs consumer dequeue rate | Sustained imbalance |
| **Error Rate** | Nack / requeue rate | > 1% of messages |
| **Consumer Count** | Active workers processing | Drops to 0 |

```
# Prometheus / Grafana Alerting Example (SQS via CloudWatch Exporter)

alert: QueueDepthHigh
expr: aws_sqs_approximate_number_of_messages_visible > 5000
for: 5m
labels:
  severity: warning
annotations:
  summary: "Queue {{ $labels.queue_name }} depth is high"

alert: DLQNotEmpty
expr: aws_sqs_approximate_number_of_messages_visible{queue_name=~".*dlq.*"} > 0
for: 1m
labels:
  severity: critical
```

---

## 12. Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Non-idempotent consumers** | At-least-once delivery causes duplicate side effects (double charge, double email) | Design consumers to be idempotent; use deduplication IDs |
| **Ignoring DLQ** | Silent data loss — failed messages disappear | Monitor DLQ depth; alert on > 0; build replay tooling |
| **Synchronous producer blocking on enqueue** | Defeats the purpose of async buffering | Fire-and-forget enqueue; handle enqueue failure separately |
| **Single massive queue for all task types** | Head-of-line blocking; slow jobs starve fast jobs | Separate queues per task type or priority tier |
| **Visibility timeout too short** | Duplicate processing under normal load | Set timeout to P99 processing time + buffer |
| **Unbounded queue growth** | Queue becomes a memory/storage sink; infinite delay | Set message TTL; alert on queue growth rate |
| **No message schema versioning** | Consumer breaks on producer schema changes | Version all message schemas; use schema registry |
| **Processing order assumed** | Standard queues are unordered; correctness breaks | Use FIFO queues only when ordering is required; design for out-of-order delivery |

---

## 13. Decision Framework

```
Is the workload async-safe (client can tolerate delayed response)?
├── NO  → Use synchronous request/response (REST, gRPC); do NOT queue
└── YES → Is producer throughput bursty / unpredictable?
          ├── NO (steady traffic) → Direct consumer call may suffice; queue optional
          └── YES → Does consumer have limited / fixed throughput?
                    ├── NO (consumer auto-scales elastically) → Queue still beneficial for resilience
                    └── YES → APPLY Queue-Based Load Leveling
                              ├── Need strict ordering? → FIFO Queue (SQS FIFO, Kafka single partition)
                              ├── Need fan-out (multiple consumers per message)? → Pub/Sub (SNS → SQS, Kafka consumer groups)
                              └── Standard unordered tasks? → Standard Queue (SQS Standard, RabbitMQ)
```

---

## 14. Technology Comparison

| Technology | Model | Ordering | Retention | Best For |
|---|---|---|---|---|
| **AWS SQS Standard** | Pull, at-least-once | Best-effort | Up to 14 days | Simple async task queues |
| **AWS SQS FIFO** | Pull, exactly-once | Strict FIFO | Up to 14 days | Order-sensitive workflows |
| **RabbitMQ** | Push (AMQP), at-least-once | Per-queue FIFO | Until consumed | Complex routing, priorities |
| **Apache Kafka** | Pull, at-least-once | Per-partition | Configurable (days–forever) | High-throughput event streaming, replay |
| **Azure Service Bus** | Push/Pull | Per-session | Up to 14 days | Enterprise messaging, sessions |
| **Google Cloud Pub/Sub** | Push/Pull | No guarantee | Up to 7 days | GCP-native fan-out |
| **Redis Streams** | Pull | Strict per-stream | Configurable | Low-latency, in-memory queuing |

---

## 15. Summary

```
Core Purpose:     Absorb burst traffic; protect consumers from overload
Key Mechanism:    Durable message queue as buffer between producers and consumers
Critical Design:  Idempotent consumers + DLQ + visibility timeout tuning + queue depth alerting
Best Fit:         Async workloads, bursty producers, rate-limited consumers
Avoid When:       Synchronous user-facing responses, strict real-time requirements
Primary Benefit:  Resilience + decoupling + horizontal scalability of consumer fleet
Primary Cost:     Added latency, distributed system complexity, idempotency burden
```