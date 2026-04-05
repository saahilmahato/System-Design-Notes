# Background Jobs

> Tasks executed outside the main request-response cycle, typically asynchronously, to improve system performance, reliability, and scalability.

---

## What Are Background Jobs?

Background jobs are units of work deferred from the critical path of user-facing operations. Instead of making a user wait for a heavy operation to complete, the system accepts the request, queues the work, and processes it separately — often at a different time, on a different machine, or at a controlled rate.

---

## Core Concepts

### Job Types

| Type | Description | Trigger |
|---|---|---|
| **Deferred** | Work postponed to avoid blocking the request | User action |
| **Scheduled (Cron)** | Runs at fixed intervals or specific times | Time-based |
| **Event-driven** | Triggered by an event or message in a queue | System event |
| **Batch** | Processes a large set of records in bulk | Time or threshold |
| **Recurring** | Repeats continuously with a defined cadence | System |

### Execution Models

- **Fire and Forget** — enqueue and don't track the result
- **Callback / Webhook** — notify a URL when the job completes
- **Polling** — the client checks job status periodically
- **Promise / Future** — job returns a handle to retrieve the result later

---

## Components of a Background Job System

```
[Producer]  →  [Queue / Broker]  →  [Worker Pool]  →  [Result Store / DB]
                      ↑
              [Scheduler / Cron]
```

### 1. Producer
- The service or code that enqueues a job
- Should be idempotent when possible (safe to enqueue twice)

### 2. Queue / Message Broker
- Decouples producers from consumers
- Provides durability, ordering guarantees, and backpressure
- Examples: Redis, RabbitMQ, Kafka, SQS, Pub/Sub

### 3. Worker
- Pulls jobs from the queue and executes them
- Can be scaled horizontally
- Should be stateless

### 4. Scheduler
- Triggers jobs on a time-based schedule (like cron)
- Must handle distributed locking to avoid duplicate execution across replicas

### 5. Result / State Store
- Stores job status: `pending → running → success / failed`
- Enables progress tracking and debugging

---

## Key Design Decisions

### Queue Semantics
- **At-most-once**: Job may be lost, never duplicated (fire-and-forget)
- **At-least-once**: Job will run, but may run more than once → **workers must be idempotent**
- **Exactly-once**: Hardest to achieve; requires distributed transactions or dedup logic

### Idempotency
Workers should produce the same result whether a job runs once or multiple times. Use idempotency keys stored in a database to detect and skip duplicate executions.

### Retry Strategy
- Exponential backoff with jitter to avoid thundering herd
- Set a max retry count
- Move permanently-failing jobs to a **Dead Letter Queue (DLQ)** for manual inspection

### Job Priority
- Use separate queues for high/medium/low priority
- Critical jobs (e.g., payment confirmation) should never be starved by bulk jobs (e.g., report generation)

### Concurrency & Throttling
- Limit the number of concurrent workers per queue
- Rate-limit jobs that call external APIs (to avoid hitting rate limits)
- Use semaphores or leases when accessing shared resources

### Visibility Timeout / Lease
- When a worker picks up a job, the job becomes invisible to other workers for a set duration
- If the worker dies, the job reappears and is retried
- Workers must heartbeat to extend the lease on long-running jobs

---

## Failure Handling

| Failure Mode | Mitigation |
|---|---|
| Worker crashes mid-job | Visibility timeout — job re-queues automatically |
| Job poisoning the queue | DLQ after N retries |
| Duplicate execution | Idempotency keys |
| Queue backs up | Auto-scale worker pool; alert on queue depth |
| Scheduler fires twice | Distributed lock (e.g., Redis SETNX or DB row lock) |
| Long-running job timeout | Worker heartbeating / lease extension |

---

## Monitoring & Observability

- **Queue Depth** — number of jobs waiting; primary scaling signal
- **Job Latency** — time from enqueue to completion
- **Failure Rate** — jobs moved to DLQ per unit time
- **Worker Utilization** — idle vs. busy workers
- **Throughput** — jobs completed per second

Alerting thresholds should be set on queue depth and DLQ size.

---

## Trade-offs

### ✅ Benefits
- **Improved response times** — user requests return instantly; heavy work happens out-of-band
- **Resilience** — queues act as a buffer; downstream failures don't lose data
- **Scalability** — worker pools can scale independently from the API layer
- **Decoupling** — producers and consumers evolve independently
- **Throttling** — control the rate of work regardless of request spikes

### ⚠️ Costs & Challenges
- **Eventual consistency** — users see stale state until the job completes; requires careful UX
- **Operational complexity** — extra infrastructure (broker, workers, scheduler, DLQ)
- **Debugging is harder** — no synchronous stack trace; requires correlation IDs and distributed tracing
- **Idempotency burden** — every worker must be designed to handle duplicate runs
- **Ordering guarantees** — most queues don't guarantee strict order (especially at scale); you may need sequence numbers or a FIFO queue
- **Latency unpredictability** — under load, jobs may wait in queue; not suitable for time-critical operations

### When NOT to Use Background Jobs
- When the result is needed synchronously (e.g., payment validation before showing confirmation)
- When the operation is trivially fast (< a few ms)
- When strict ordering is required and the queue can't guarantee it

---

## Real-World Systems & Applications

### 1. Email & Notification Delivery
**Companies**: Mailchimp, SendGrid, Twilio  
When a user triggers an email (e.g., password reset), the API enqueues a job. Workers pick up the job, render the template, and call the SMTP/SMS provider. This prevents provider latency from blocking the API and allows retries on transient failures.

### 2. Media Processing
**Companies**: YouTube, Netflix, Cloudinary  
After a video upload, background jobs handle transcoding into multiple resolutions, extracting thumbnails, generating captions, and virus scanning. These are compute-intensive and would be completely impractical in a synchronous API call.

### 3. Payment Processing & Reconciliation
**Companies**: Stripe, PayPal  
Webhook delivery to merchants is handled as background jobs — with exponential backoff retries. Nightly batch jobs reconcile ledgers, generate invoices, and settle accounts across millions of transactions.

### 4. Search Index Updates
**Companies**: Elasticsearch, Algolia, GitHub  
When a record changes (e.g., a new GitHub repo is pushed), a background job reindexes the content. This keeps write latency low while ensuring eventual search consistency.

### 5. Feed Generation
**Companies**: Twitter/X, Instagram, LinkedIn  
Fan-out on write: when a user posts, background jobs push the post to followers' feeds (or pre-compute feed rankings). This is done asynchronously to avoid blocking the posting action.

### 6. Report & Export Generation
**Companies**: Salesforce, Shopify, Metabase  
User-initiated CSV/PDF exports are enqueued as background jobs. The user is notified (email or in-app) when the file is ready. Prevents timeouts on large dataset exports.

### 7. Machine Learning Pipelines
**Companies**: Uber, Airbnb, Spotify  
Model training, feature computation, recommendation refreshes, and fraud scoring on historical data all run as scheduled or event-driven background jobs on platforms like Airflow, Celery, or Kubeflow.

### 8. Cleanup & Maintenance Tasks
**Examples**: Deleting soft-deleted records after 30 days, expiring sessions, purging old logs, sending digest emails  
Scheduled cron-style jobs keep the database clean and handle compliance requirements (e.g., GDPR deletion requests).

---

## Technology Reference

| Tool | Category | Notes |
|---|---|---|
| **Sidekiq** | Worker framework (Ruby) | Redis-backed, widely used in Rails apps |
| **Celery** | Worker framework (Python) | Supports Redis and RabbitMQ backends |
| **BullMQ** | Worker framework (Node.js) | Redis-backed, supports priorities and delays |
| **Temporal** | Workflow orchestration | Durable execution with built-in retries and state |
| **Apache Airflow** | DAG scheduler | Best for complex ML/data pipelines with dependencies |
| **AWS SQS** | Managed queue | At-least-once, simple ops, native AWS integration |
| **AWS SQS FIFO** | Managed queue | Exactly-once, ordered, lower throughput ceiling |
| **RabbitMQ** | Message broker | Flexible routing, at-least-once |
| **Apache Kafka** | Event streaming | High throughput, log-based, replay support |
| **Redis (lists/streams)** | Lightweight queue | Great for simple use cases; not durable by default |
| **Google Cloud Tasks** | Managed queue | HTTP-targeted task dispatch |
| **Faktory** | Language-agnostic worker | Simple, polyglot job system |

---

## Design Patterns

### Outbox Pattern
Prevents the dual-write problem (writing to DB and enqueuing independently, risking one succeeding and the other failing). Write the job to an `outbox` table in the same DB transaction, then a separate process polls the outbox and publishes to the queue.

### Saga Pattern
For long-running workflows spanning multiple services, use a sequence of background jobs — each step either succeeds and triggers the next, or triggers a compensating transaction on failure.

### Fan-Out
One job spawns many child jobs (e.g., notify 10,000 followers). Use a coordinator job that enqueues child jobs in batches to avoid overwhelming the queue.

### Rate-Limited Workers
Use a token bucket or sliding window to ensure workers don't exceed an external API's rate limits, even under high load.