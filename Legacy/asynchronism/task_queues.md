# Asynchronism: Task Queues

---

## 1. What Are Task Queues?

A **task queue** (also called a job queue or work queue) is a data structure that holds units of work — **tasks** — to be processed asynchronously by one or more **workers**. The producer of a task does not wait for its completion; it enqueues the task and moves on. Workers pull tasks from the queue, execute them independently, and report results through a separate channel if needed.

Task queues are the backbone of **asynchronous processing** in distributed systems, enabling decoupling of task production from task execution across time, space, and resources.

```
Producer(s)  ──►  [ Task Queue ]  ──►  Worker(s)
                        │
                  (persisted tasks,
                   retry state,
                   scheduling metadata)
```

---

## 2. Core Concepts

### 2.1 Task
A discrete unit of work — serialized (usually JSON or binary) — containing everything a worker needs to execute it: function name, arguments, metadata, priority, and retry policy.

### 2.2 Producer
Any application component that creates and enqueues a task. Producers are completely decoupled from execution and never block on task completion.

### 2.3 Queue
The buffer between producers and workers. May be in-memory (Redis list), persistent (database-backed), or a dedicated broker (RabbitMQ, SQS). Guarantees vary: at-least-once, at-most-once, or exactly-once delivery.

### 2.4 Worker
A process that dequeues tasks and executes them. Workers can be scaled horizontally. They are stateless with respect to the queue — all task state lives in the queue/broker.

### 2.5 Broker
The middleware that manages queue storage, task routing, delivery guarantees, and retry logic. Examples: Redis, RabbitMQ, Amazon SQS, Celery with broker backends.

### 2.6 Task States
```
PENDING → SCHEDULED → RECEIVED → STARTED → SUCCESS
                                         ↘ FAILURE → RETRY → (loop)
                                                    → DEAD LETTER
```

---

## 3. Why Task Queues? (The Motivation)

| Problem | Task Queue Solution |
|---|---|
| Slow operations blocking HTTP response | Offload to background worker, return 202 Accepted |
| Traffic spikes overwhelming downstream services | Queue absorbs burst; workers process at sustainable rate |
| Unreliable external services | Retry logic with backoff isolated in queue layer |
| Heterogeneous work taking variable time | Workers handle long-running jobs without timeout pressure |
| Fan-out (one event → many jobs) | Broadcast task to multiple queues/workers |
| Scheduled / deferred work | Enqueue with future execution timestamp |

---

## 4. Architecture Patterns

### 4.1 Single Queue, Multiple Workers
The simplest pattern. All workers compete to dequeue tasks. Work is distributed naturally.

```
Producer ──► [Queue] ──► Worker 1
                    ──► Worker 2
                    ──► Worker 3
```
**Use when:** Tasks are homogeneous, no priority differentiation needed.

---

### 4.2 Priority Queues
Multiple queues with different priority levels. Workers drain higher-priority queues first.

```
              [Critical Queue]  ──► Worker (polled first)
Producer ──►  [Normal Queue]   ──► Worker (polled second)
              [Bulk Queue]     ──► Worker (polled last)
```
**Use when:** Some tasks (payment processing, alerts) must not wait behind bulk jobs (reports, emails).

---

### 4.3 Fan-Out Pattern
One task enqueues into multiple queues for parallel processing by different worker types.

```
Producer ──► [Order Queue]    ──► Fulfillment Worker
         ──► [Email Queue]   ──► Notification Worker
         ──► [Analytics Queue] ──► Metrics Worker
```
**Use when:** A single event needs to trigger multiple independent workflows.

---

### 4.4 Task Chaining / Pipelines
Output of one task becomes input to the next. Enables complex multi-step workflows.

```
[Ingest Task] ──► [Transform Task] ──► [Load Task] ──► [Notify Task]
```
Celery Chains, Airflow DAGs, and AWS Step Functions implement this natively.

---

### 4.5 Dead Letter Queue (DLQ)
Tasks that exceed retry limits are routed to a DLQ for inspection, alerting, and manual reprocessing.

```
[Main Queue] ──► Worker (fails repeatedly) ──► [Dead Letter Queue]
                                                      │
                                               (alerting, replay)
```
**Critical for production:** Without DLQs, poison pill messages can stall workers indefinitely.

---

### 4.6 Delayed / Scheduled Tasks
Tasks enqueued with a future execution time. Broker holds them until the scheduled time, then makes them available to workers.

```
Producer ──► enqueue(task, eta=T+30min) ──► [Broker]
                                              │
                                    (holds until T+30min)
                                              │
                                           Worker
```

---

## 5. Delivery Guarantees

| Guarantee | Description | Implication |
|---|---|---|
| **At-most-once** | Task delivered once; may be lost on failure | No duplicate processing, but tasks can be dropped |
| **At-least-once** | Task delivered until acknowledged; may duplicate | Workers must be **idempotent** |
| **Exactly-once** | Task delivered and processed exactly once | Hardest to guarantee; requires distributed transactions or deduplication |

> **In practice**, at-least-once delivery is the dominant model. The system design burden shifts to making workers **idempotent** — processing the same task twice produces the same result.

---

## 6. Retry Strategies

### 6.1 Immediate Retry
Re-enqueue immediately on failure. Appropriate only for transient network blips.

### 6.2 Fixed Delay
Wait a constant interval before retrying. Simple but can cause thundering herd.

### 6.3 Exponential Backoff
```
delay = base_delay * (2 ^ attempt)
```
Allows transient failures (rate limits, overloaded services) to recover without hammering them.

### 6.4 Exponential Backoff with Jitter
```
delay = random(0, base_delay * (2 ^ attempt))
```
Prevents synchronized retries from multiple workers creating a new spike — the **thundering herd problem**.

### 6.5 Max Retries + DLQ
After N attempts, route to Dead Letter Queue. Prevents poison pills from consuming worker capacity forever.

---

## 7. Idempotency

Since at-least-once delivery can cause duplicate task execution, workers must be designed to be idempotent.

### Techniques
- **Natural idempotency**: Operation is inherently safe to repeat (e.g., `SET user.status = 'verified'`)
- **Idempotency keys**: Task carries a unique ID; worker checks a processed-tasks store (Redis SET, DB unique constraint) before executing
- **Conditional updates**: `UPDATE ... WHERE status = 'pending'` — database prevents double-application
- **Deduplication window**: Broker-level deduplication within a time window (SQS FIFO supports this natively)

---

## 8. Worker Concurrency Models

| Model | Description | Best For |
|---|---|---|
| **Process-based** | Each worker is an OS process (Celery prefork) | CPU-bound tasks (image processing, ML inference) |
| **Thread-based** | Workers share a process with multiple threads | I/O-bound tasks with GIL-limited languages |
| **Async / Event Loop** | Single-threaded, non-blocking (asyncio workers) | High-concurrency I/O-bound work |
| **Gevent / Green threads** | Cooperative multitasking via monkey-patching | Legacy Python I/O-bound code |

### Concurrency Tuning
- CPU-bound: workers = CPU cores
- I/O-bound: workers = CPU cores * (1 + wait_ratio) — often 10–100x the core count

---

## 9. Task Queue Technologies

### 9.1 Celery (Python)
- Most widely used Python task queue
- Supports Redis, RabbitMQ, Amazon SQS as brokers
- Rich feature set: retries, rate limiting, periodic tasks (Celery Beat), task routing, chaining
- Result backends: Redis, database, memcached
- **Weakness**: Complex configuration; at-least-once semantics require idempotent tasks

### 9.2 Redis Queue (RQ)
- Lightweight Python library backed by Redis
- Simple API, easy to get started
- Lacks some advanced features of Celery (e.g., complex routing, AMQP semantics)
- **Use when:** Simplicity is preferred over flexibility

### 9.3 Sidekiq (Ruby)
- Redis-backed job queue for Ruby/Rails
- Multi-threaded workers; high throughput
- Pro version adds unique jobs, batches, scheduled jobs
- **Industry standard** in the Rails ecosystem

### 9.4 BullMQ (Node.js)
- Redis-backed queue for Node.js
- Supports job priorities, rate limiting, repeatable jobs, parent-child job dependencies
- Successor to Bull; well-maintained and production-grade

### 9.5 Amazon SQS
- Fully managed message queue service
- Standard queues: at-least-once, best-effort ordering
- FIFO queues: exactly-once processing, ordered delivery
- Scales automatically; no broker to manage
- **DLQ support** natively
- Integrates deeply with Lambda for serverless workers

### 9.6 RabbitMQ
- AMQP-based message broker
- Rich routing via exchanges (direct, fanout, topic, headers)
- Supports complex topologies: competing consumers, pub/sub, request/reply
- Persistent queues, message TTL, dead-lettering
- **Use when:** Fine-grained message routing and AMQP semantics are required

### 9.7 Google Cloud Tasks
- Managed task queue for HTTP and App Engine targets
- Precise scheduling, rate controls, retry configuration
- Integrates natively with GCP services

---

## 10. Trade-offs

### 10.1 Asynchronism vs. Synchronous Processing

| Dimension | Synchronous | Asynchronous (Task Queue) |
|---|---|---|
| **Latency** | Immediate result | Deferred result (polling / webhook / push) |
| **Complexity** | Simple request/response | Requires queue infra, worker management, result delivery |
| **Fault isolation** | Failure is immediate and visible | Failures are isolated; can retry without user impact |
| **Throughput** | Bounded by request duration | Decoupled; scales producers and consumers independently |
| **Observability** | Single trace per request | Jobs need separate monitoring, alerting, DLQ inspection |
| **User experience** | Instant feedback | Requires progress indicators, async UX patterns (polling, websockets) |

---

### 10.2 Task Queue vs. Message Queue (Pub/Sub)

| Dimension | Task Queue | Message Queue / Pub-Sub |
|---|---|---|
| **Consumer model** | Competing consumers (one worker per task) | Fan-out (all subscribers receive each message) |
| **Task state** | Tracked (retry count, result, status) | Fire-and-forget after delivery |
| **Retry semantics** | Built-in, configurable per task | Varies; often requires consumer-side logic |
| **Primary use case** | Background jobs, deferred work | Event notification, stream processing |
| **Examples** | Celery, Sidekiq, BullMQ | Kafka, SNS, Pub/Sub, EventBridge |

---

### 10.3 Key Trade-offs in Task Queue Design

| Decision | Option A | Option B | Guidance |
|---|---|---|---|
| **Broker choice** | Redis (fast, simple) | RabbitMQ/SQS (durable, rich routing) | Redis for low-ops simplicity; RabbitMQ/SQS for production durability |
| **Task granularity** | Fine-grained many small tasks | Coarse-grained fewer large tasks | Fine-grained = better parallelism but higher overhead |
| **Delivery guarantee** | At-most-once (faster) | At-least-once (safe) | Almost always choose at-least-once + idempotent workers |
| **Worker scaling** | Scale workers vertically | Scale workers horizontally | Horizontal is preferred; stateless workers are easy to add |
| **Result storage** | Store results (Redis/DB) | Fire-and-forget | Only store results if the caller needs them; avoid storage bloat |
| **Task visibility** | All workers see all tasks | Routing by queue/type | Use routing when worker specialization is needed |

---

## 11. Real-World Systems & Applications

### 11.1 Stripe — Payment Processing
- Webhook delivery to merchant endpoints is handled via task queues with exponential backoff
- If a merchant's server is down, Stripe retries delivery over 3 days with increasing delays
- Critical for reliability: the payment event is captured synchronously; the notification is asynchronous
- Workers are purpose-built for idempotency — a webhook delivered twice must not cause double charges

### 11.2 GitHub — CI/CD Job Queuing
- When a push event occurs, GitHub enqueues a build job into a task queue
- Workers (runners) pick up jobs and execute pipelines independently of the web tier
- Priority queues ensure paid plans get faster runner allocation than free tier
- Fan-out: a single push may spawn multiple parallel jobs (lint, test, build, deploy)

### 11.3 Pinterest — Image Processing Pipeline
- Every uploaded image goes through a multi-stage processing pipeline: resizing, thumbnail generation, EXIF extraction, CDN upload
- Each stage is a separate task enqueued after the previous completes (chaining pattern)
- At peak, Pinterest processes millions of images per day — task queues absorb upload bursts without coupling image processing to the upload API

### 11.4 Shopify — Order Fulfillment
- Order placement triggers multiple downstream tasks: inventory reservation, payment capture, fraud check, warehouse notification, email confirmation
- Each is an independent task, allowing partial failure and retry without re-running the entire order flow
- Sidekiq is the backbone of Shopify's background processing; at scale, they run thousands of Sidekiq workers

### 11.5 Slack — Notification Delivery
- Message notifications (mobile push, email digests) are processed via task queues
- Notification tasks carry user preference data; workers decide which channels to use
- Delayed tasks implement "Do Not Disturb" — notifications are scheduled for delivery after the DND window ends

### 11.6 YouTube — Video Transcoding
- Video uploads are acknowledged immediately (202 Accepted); transcoding is entirely asynchronous
- Transcoding is broken into parallel tasks: each resolution (360p, 720p, 1080p, 4K) is an independent worker task
- Workers are GPU-attached instances; scaling the transcoding tier is independent of the upload API
- DLQ captures failed transcoding jobs for operator review

### 11.7 Airbnb — Search Index Updates
- When a host updates a listing, a task is enqueued to rebuild the Elasticsearch index for that listing
- Decouples write latency from index freshness; search index may lag by seconds
- Batch tasks periodically reindex stale listings to catch any missed updates

---

## 12. Failure Modes & Mitigations

| Failure Mode | Description | Mitigation |
|---|---|---|
| **Poison pill** | A task that always fails, blocking workers | Max retries + DLQ; alert on DLQ depth |
| **Worker crash mid-task** | Task dequeued but not acknowledged before crash | Visibility timeout / ack-on-completion semantics; task returns to queue |
| **Queue overflow** | Producer outpaces consumers; queue grows unboundedly | Back-pressure signaling; auto-scale workers; reject tasks at ingress |
| **Thundering herd** | Many workers retry simultaneously after an outage | Jitter in retry backoff |
| **Clock skew on scheduled tasks** | Delayed task fires early/late due to worker clock drift | Use broker-side scheduling (not worker-side sleep); NTP on all hosts |
| **Duplicate processing** | At-least-once delivery; same task run twice | Idempotency keys; deduplication store |
| **Long-running task blocking queue** | One slow task holds a worker thread | Task timeout limits; separate queues for long/short tasks |

---

## 13. Monitoring & Observability

### Key Metrics
| Metric | What It Signals |
|---|---|
| **Queue depth** | Backlog size; indicates consumer lag or producer burst |
| **Task processing rate** | Throughput of workers; compare against enqueue rate |
| **Task latency (queue time)** | Time from enqueue to dequeue; reflects worker capacity |
| **Task execution duration** | Worker efficiency; outliers indicate performance regression |
| **Retry rate** | Downstream dependency health; high retry rate = upstream failure |
| **DLQ depth** | Failed tasks requiring human intervention |
| **Worker saturation** | % of workers busy; drives auto-scaling decisions |

### Operational Practices
- Alert on **DLQ depth > 0** — every dead-lettered task represents a lost operation
- Alert on **queue depth growing monotonically** — workers are falling behind
- Trace task execution with a correlation ID that links the original HTTP request to all downstream tasks
- Use structured logging in workers: task ID, type, attempt number, duration, outcome

---

## 14. Scaling Patterns

### Producer-Side
- Batching: enqueue tasks in bulk to reduce broker round trips
- Sampling: for analytics tasks, enqueue a fraction under extreme load
- Circuit breaking: stop enqueueing if queue depth exceeds threshold

### Broker-Side
- Redis Cluster / SQS: horizontally partitioned queues
- RabbitMQ mirrored queues: replication across nodes for HA

### Worker-Side
- **Horizontal auto-scaling**: scale workers based on queue depth (KEDA — Kubernetes Event-Driven Autoscaling — natively supports SQS/RabbitMQ metrics as scaling signals)
- **Prefetching**: worker fetches N tasks in advance to reduce round-trip latency — balance between efficiency and task holding time
- **Concurrency within worker**: multiple goroutines/threads per worker process, tuned to task type (I/O vs CPU)

---

## 15. Decision Framework

### When to Use a Task Queue
- ✅ Operation takes > ~200ms and doesn't need an immediate result
- ✅ Work can be retried safely (or made idempotent)
- ✅ Producers and consumers have different scaling characteristics
- ✅ External service calls that may fail transiently (email, SMS, webhooks)
- ✅ Fan-out: one event must trigger multiple independent workflows

### When NOT to Use a Task Queue
- ❌ Result is needed immediately by the requester (use synchronous RPC or streaming instead)
- ❌ Task ordering is critical and cannot be relaxed (use Kafka with partition keys, or SQS FIFO)
- ❌ Task volume is extremely low — queue infrastructure overhead exceeds benefit
- ❌ Sub-millisecond latency is required

### Broker Selection Guide
```
Need managed, zero-ops?           ──► Amazon SQS / Google Cloud Tasks
Need rich routing / AMQP?         ──► RabbitMQ
Need simple, fast, Pythonic?      ──► Celery + Redis
Need Node.js?                     ──► BullMQ + Redis
Need Ruby/Rails?                  ──► Sidekiq + Redis
Need event streaming + queuing?   ──► Kafka (with consumer groups)
```

---

## 16. Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Fat tasks** | Passing large payloads (e.g., full documents) in task body | Pass only a reference (ID, S3 key); worker fetches from source |
| **Synchronous waiting on task result in producer** | Defeats the purpose of async; blocks the request thread | Use webhooks, polling endpoints, or WebSocket push for results |
| **No DLQ** | Failed tasks silently disappear | Always configure a DLQ with alerting |
| **Non-idempotent workers** | Duplicate executions cause data corruption | Design all workers with idempotency as a first principle |
| **One giant queue for everything** | Priority inversion; bulk jobs starve critical tasks | Use separate queues by task type and priority |
| **Unbounded retry loops** | Poison pill tasks spin forever, wasting workers | Always set max_retries; route to DLQ |
| **Storing too much state in task payload** | Stale data by the time worker executes | Store a reference; worker fetches fresh state at execution time |

---

## Summary

Task queues are a foundational primitive for building **resilient, scalable, and decoupled** distributed systems. They shift the processing model from synchronous request/response to an asynchronous enqueue/execute paradigm, absorbing traffic spikes, isolating failures, and enabling independent scaling of producers and consumers. The engineering investment — broker management, idempotency design, monitoring, DLQ handling — pays off in systems where reliability and throughput matter more than immediacy of result, which describes the majority of real-world background workloads.