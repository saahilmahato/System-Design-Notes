# Background Jobs

> Tasks executed asynchronously, independent of the main request-response cycle, without user interaction.

---

## Why Background Jobs?

| Problem | Background Job Solution |
|---|---|
| UI blocks on slow work | Offload to async worker; return immediately |
| Burst traffic overwhelms downstream | Queue absorbs spikes; workers drain at safe rate |
| Long computation ties up a web thread | Dedicated compute processes without blocking |
| Repeated periodic work clutters app logic | Scheduler handles triggers cleanly |
| Sensitive processing needs isolation | Separate compute with tighter security boundary |

---

## File Map

| File | Contents |
|---|---|
| `01-fundamentals.md` | Job types, trigger models, return-result patterns |
| `02-reliability.md` | Idempotency, poison messages, graceful shutdown, checkpointing |
| `03-architecture.md` | Hosting options, partitioning, coordination patterns |
| `04-scaling-observability.md` | Scaling signals, queue-depth autoscaling, monitoring |

---

## Quick-Reference: Decision Tree

```
Is the task user-facing and must complete before the response?
│
├── YES → Inline (synchronous). Not a background job.
│
└── NO → Can it be delayed?
        │
        ├── YES, by seconds/minutes → Queue-driven background job
        │
        └── YES, at a fixed time → Scheduled job (cron)
```

---

## Core Vocabulary

| Term | Definition |
|---|---|
| **Idempotency** | Running the same job N times produces the same result as running it once |
| **Poison message** | A message that consistently fails processing and blocks the queue |
| **Dead-letter queue (DLQ)** | Holding queue for messages that exceeded retry limits |
| **At-least-once delivery** | Queue guarantee: a message will be delivered ≥1 times; duplicates are possible |
| **Checkpointing** | Persisting intermediate job state so restarts resume from last known-good point |
| **Back-pressure** | Signal from a downstream system that it is overwhelmed; producer must slow down |
| **Fan-out / fan-in** | Distribute work across parallel workers, then aggregate results |
| **KEDA** | Kubernetes Event-Driven Autoscaler — scales pods/jobs based on queue depth |