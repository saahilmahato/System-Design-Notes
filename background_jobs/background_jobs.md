# Background Jobs

## What Are Background Jobs?

Background jobs are tasks executed **outside the main request-response cycle**, asynchronously and independently of the UI or calling process. The application initiates the job and immediately continues serving user requests — no blocking, no waiting.

**Core purpose:** Offload work that doesn't need to return a result to the user immediately.

---

## Why Use Background Jobs?

| Problem | Background Job Solution |
|---|---|
| Long-running task blocks the UI | Offload to async worker; return immediately |
| Spiky traffic overwhelms downstream services | Buffer via queue; process at steady rate |
| Periodic maintenance (cleanup, reports) | Schedule-driven execution |
| CPU/IO-intensive work degrades API latency | Isolate in dedicated workers |
| Sensitive data processing needs isolation | Route to secure, restricted compute |

---

## Common Use Cases

- **Maintenance tasks** — DB cleanup, index rebuilding, log rotation, data archival
- **Batch processing** — nightly ETL, report generation, invoice runs
- **Heavy computation** — ML inference, video transcoding, image resizing
- **Notification delivery** — email, SMS, push notifications (fire-and-forget)
- **Order/workflow orchestration** — multi-step business processes (order → payment → fulfillment → ship)
- **Data replication / sync** — eventual consistency between services
- **Sensitive data processing** — isolated compute with restricted access (e.g., PCI data, PII)

---

## Triggers

### Event-Driven
- A message arrives in a **queue** (most common pattern)
- A record is **written/updated** in storage, triggering a change stream or CDC event
- A direct **API/HTTP call** to a job endpoint

### Schedule-Driven
- Cron-based: `0 2 * * *` (run at 2am daily)
- Fixed-interval: every 5 minutes
- One-shot: delayed execution after N seconds

**Key concern with scheduled tasks:** If execution duration > schedule interval, multiple instances overlap. Always design for idempotency.

---

## Architecture Patterns

### Queue-Based Worker (Most Common)

```
Producer (API/UI)  →  Message Queue  →  Worker Pool  →  Data Store
                         ↓ (overflow)
                     Dead-Letter Queue
```

- Producer writes a message and returns `202 Accepted` immediately
- Workers consume messages independently and at their own pace
- Queue acts as **buffer / shock absorber** (Queue-Based Load Leveling pattern)
- Failed messages route to a **Dead-Letter Queue (DLQ)** after N retries

### Async Request-Reply (Polling Pattern)

```
Client  →  POST /jobs         → returns { jobId, statusUrl }
Client  →  GET /jobs/{id}     → returns { status: "pending" | "running" | "done" | "failed" }
```

- Job ID returned immediately; client polls status endpoint
- Suited for HTTP-based long-running operations
- Avoids holding open connections

### Push Callback (Webhook)

```
Client submits job with callbackUrl
Worker completes → POST callbackUrl with result
```

- No polling overhead
- Requires caller to expose a receivable endpoint
- Add retry logic + HMAC signature verification on callback

### Event Notification

```
Worker completes → publishes event to Event Bus
Subscribers (email service, analytics, etc.) react independently
```

- Decoupled; multiple consumers react to one completion event
- Suited for fan-out scenarios

### Pipes and Filters (Multi-Step Jobs)

```
Queue A → Worker 1 (validate) → Queue B → Worker 2 (transform) → Queue C → Worker 3 (store)
```

- Each step is independent, reusable, and separately scalable
- Failure at any step doesn't corrupt prior steps
- Steps can be reordered or reused across different workflows

---

## Returning Results

Background jobs are ideally **fire-and-forget**, but when the caller needs a result:

| Mechanism | How | When to Use |
|---|---|---|
| Status polling endpoint | Return `jobId + statusUrl`; caller polls | HTTP APIs, external clients |
| Reply queue | Worker publishes to a reply queue caller listens on | Internal async systems |
| Webhook callback | Caller provides callback URL upfront | External system integrations |
| Shared storage | Worker writes result to DB/blob; caller reads | Simplest; requires polling |
| Push event / SSE | Worker publishes event; caller subscribed | Real-time UX, internal services |

---

## Idempotency — Non-Negotiable

Background jobs run **at least once** by design. Infrastructure restarts, queue redeliveries, and scheduler overlaps mean a job may process the same logical work item multiple times.

**Every background job must be idempotent:** running it N times produces the same result as running it once.

### Idempotency Strategies

| Strategy | Description |
|---|---|
| **Idempotency key** | Include a unique `jobId` or `messageId`; check before processing |
| **Database upsert** | Use `INSERT ... ON CONFLICT DO NOTHING` or equivalent |
| **Check-then-act with locking** | Read current state before mutating; skip if already applied |
| **Deduplication window** | Store processed IDs in a cache (Redis) with TTL |
| **State machine gating** | Only transition if in the expected prior state (e.g., `PENDING → PROCESSING`) |

---

## Reliability Considerations

### Poison Messages
Messages that **consistently fail** processing and block the queue.

- Detect by tracking delivery count (`deliveryCount > maxDeliveries`)
- Route to **DLQ** automatically (Service Bus) or manually
- Alert on DLQ depth; investigate root cause; resubmit after fix
- Without DLQ handling: one bad message can halt the entire worker

### Message Ordering
Queues generally provide **at-least-once delivery but not strict ordering**.

- If order matters: include a **sequence number** in the payload
- Or use ordered delivery mechanisms (Kafka partitions, Service Bus sessions)
- Prefer designing jobs so **order doesn't matter** — avoids coordination complexity

### Graceful Shutdown
Workers can be interrupted by deployments, scale-in, or platform maintenance.

- Listen for termination signals (`SIGTERM`)
- Finish or **checkpoint** the current work item before exiting
- Do not accept new messages after signal received
- If can't finish in time: let message visibility timeout expire (auto-redelivered to another instance)
- Configure platform grace period ≥ typical work item duration

### Checkpointing for Long-Running Jobs
Persist intermediate state to durable storage at each milestone.

```
Job Progress:
Step 1 complete → write checkpoint { jobId, step: 1, state: {...} }
Step 2 complete → write checkpoint { jobId, step: 2, state: {...} }
Restart         → read checkpoint → resume from step 2
```

- Prevents re-processing from scratch on failure
- Critical for jobs spanning minutes or hours

### Transient vs. Permanent Failures

| Failure Type | Examples | Response |
|---|---|---|
| **Transient** | Network timeout, throttle (429), downstream hiccup | Retry with exponential backoff + jitter |
| **Permanent** | Malformed payload, missing referenced data, schema mismatch | Route to DLQ immediately; don't burn retries |

Distinguish them early. Retrying a permanent failure wastes resources and delays detection.

---

## Scaling Considerations

### Scale on Queue Depth, Not CPU

CPU utilization is a lagging signal. Queue depth is a **leading signal** — it reflects pending work directly.

```
Workers = f(queue_depth)
Not:
Workers = f(cpu_percent)
```

KEDA (Kubernetes), Azure Container Apps, and cloud Functions all support queue-length-based autoscaling.

### Scale to Zero for Intermittent Workloads
Nightly batch jobs, event-driven processors with idle periods → scale to zero when queue is empty. No cost for idle compute.

### Scale Workers Independently from UI
Background workers and the UI have **different scaling signals**:
- UI scales on **concurrent users / requests**
- Workers scale on **queue depth / batch size**

Run them as separate services. Colocating forces both to scale together — wasteful and limiting.

### Scale the Full Pipeline
More workers don't help if a downstream resource is the bottleneck:

```
Bottleneck checklist:
□ Queue throughput limits (partitions, throughput units)
□ Database connection pool / RCU / WCU
□ External API rate limits
□ Network bandwidth
```

Identify the constraint first; add workers second.

### Single-Instance Enforcement
Some scheduled tasks must not run concurrently (non-idempotent by nature: DB maintenance, report gen).

- **Distributed lock** (Redis `SET NX`, ZooKeeper, DB row lock)
- Scheduler frameworks often provide built-in leader election
- Kubernetes: `CronJob.spec.concurrencyPolicy: Forbid`

---

## Partitioning and Isolation

**Colocate** background tasks with the main app only when:
- Tasks are lightweight and infrequent
- Deployment/scaling lifecycle is identical

**Separate** into dedicated compute when:
- Tasks are resource-intensive (CPU/memory/IO spikes affect UI latency)
- Security boundary must differ (tasks access data the UI should never reach)
- Release cadence differs (deploy job logic without redeploying UI)
- Scaling signals differ (queue depth ≠ concurrent users)

**Benefit of separation:** independent failure domains. If the worker crashes, the UI continues; pending work queues up and drains on recovery.

---

## Security Considerations

| Principle | Practice |
|---|---|
| **Least privilege** | Job processor gets only the permissions it needs (read queue + write DB) — not a broad app identity |
| **No sensitive data in messages** | Store PII/credentials in protected storage; pass reference ID in message |
| **Network isolation** | Workers that access internal data stores shouldn't be reachable from the public internet |
| **Message integrity** | Sign messages (HMAC) for webhook callbacks; verify on receipt |
| **Audit logging** | Log every job start, completion, and failure with identity and correlation ID |

---

## Observability

### What to Instrument

| Signal | What to Track |
|---|---|
| **Job lifecycle** | Start time, completion time, duration, status (success/failure) |
| **Queue metrics** | Depth, age of oldest message, enqueue rate, dequeue rate |
| **DLQ metrics** | Depth, message age — alert immediately on growth |
| **End-to-end latency** | Enqueue time → completion time (not just processing time) |
| **Correlation ID** | Propagate through every step for distributed tracing |

### Key Alerting Rules

- DLQ depth > 0 for > N minutes → alert
- Scheduled job didn't fire within expected window → alert (nothing errored, but nothing ran)
- Queue depth growing consistently despite healthy workers → capacity alert
- P99 job duration spiking → alert

### Common Observability Anti-Patterns

| Anti-Pattern | Problem |
|---|---|
| Only logging job start | A hung job looks healthy |
| Only alerting on errors | Silent failures (missed schedules, DLQ growth) go undetected |
| Measuring processing time only | 2s processing + 30min queue wait = 30min user impact |
| No correlation IDs | Can't trace multi-step job failures |

---

## Design Checklist

```
□ Job is idempotent — safe to re-run N times
□ Graceful shutdown — handles SIGTERM, checkpoints in-progress work
□ DLQ configured — poison messages don't block the queue
□ Transient vs. permanent failures distinguished — no infinite retries on bad payloads
□ Scaling signal is queue depth, not CPU
□ Workers isolated from UI — separate compute, separate scaling
□ Least-privilege access — job identity scoped to its actual needs
□ No sensitive data in message payloads
□ Correlation ID propagated through all steps
□ Alerts on DLQ depth, missed schedules, and queue age — not only on exceptions
□ Long-running jobs use checkpointing
□ Single-instance tasks protected by distributed lock
```

---

## Common Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Synchronous execution of background work | UI blocked; latency spikes | Queue the work; return immediately |
| Non-idempotent job | Duplicate messages → duplicate side effects | Add idempotency key checks |
| No DLQ | Poison message stalls entire worker | Configure DLQ + alerting |
| Storing sensitive data in queue message | Messages are logged, inspectable | Store in secure store; pass reference |
| Colocating heavy workers with UI | Workers starve UI of CPU/memory | Separate compute |
| Scaling only workers, not the pipeline | DB/queue becomes the bottleneck | Profile full pipeline |
| No missed-schedule alerting | Silent job failures go undetected | Monitor expected run windows |
| Jobs not idempotent because "queue delivers once" | Queues deliver **at least once** | Always design for redelivery |