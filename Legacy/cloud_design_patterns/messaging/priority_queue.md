# Cloud Design Patterns — Messaging: Priority Queue

---

## Overview

The **Priority Queue** pattern ensures that messages with higher importance are received and processed before messages of lower importance. Instead of a strict FIFO order, consumers always pull from the highest-priority end of the queue first.

This pattern is fundamental when different classes of work have different SLAs, and when treating all messages equally would cause high-value or time-critical work to be starved by a flood of low-priority tasks.

---

## Core Concept

```
Producers                  Priority Queue                 Consumers

[P3 Task] ──────────────►  ┌──────────────────┐
[P1 Task] ──────────────►  │ ● P1 (Critical)  │ ◄── Consumer 1 (dedicated)
[P2 Task] ──────────────►  │ ● P1 (Critical)  │
[P1 Task] ──────────────►  │ ○ P2 (High)      │ ◄── Consumer 2
[P3 Task] ──────────────►  │ ○ P2 (High)      │
                           │ · P3 (Normal)    │ ◄── Consumer 3
                           │ · P3 (Normal)    │
                           │ · P3 (Normal)    │
                           └──────────────────┘

                       Higher priority always dequeued first
```

---

## Implementation Strategies

### Strategy 1: Multiple Physical Queues (Recommended)

Create separate queues per priority level. Consumers poll higher-priority queues first and fall back to lower-priority queues when idle.

```
┌─────────────────────────────────────────────────────┐
│  Priority Tier Architecture                         │
│                                                     │
│  [Critical Queue]  ──►  [Dedicated P1 Consumers]   │
│  [High Queue]      ──►  [P1 + P2 Consumers]        │
│  [Normal Queue]    ──►  [All Consumers (fallback)]  │
│  [Bulk Queue]      ──►  [Idle Consumers only]       │
│                                                     │
│  Consumer poll order: Critical → High → Normal → Bulk│
└─────────────────────────────────────────────────────┘
```

**Pros:** Simple, works with any queue technology, easy to monitor per tier.  
**Cons:** Priority assignment is fixed at enqueue time; requires consumer-side polling logic.

---

### Strategy 2: Single Queue with Priority Field (Native Support)

Some queuing systems natively support priority (e.g., RabbitMQ with `x-max-priority`, Amazon SQS FIFO with message groups, Azure Service Bus with `Priority` session).

```
Producer sets priority:
  message.priority = 9   // 0–9 scale, higher = more urgent

Queue internally maintains ordering:
  [9][9][8][7][5][5][3][1][1]
        ↑
     Consumer always pulls from head
```

**Pros:** Single queue to manage; atomic enqueue + priority setting.  
**Cons:** Not all brokers support it; high-priority flood can still starve low-priority indefinitely.

---

### Strategy 3: Priority Bump / Aging

To prevent **starvation**, low-priority messages that wait too long automatically get their priority elevated.

```
Time-based priority escalation:

  Message age:   0 min  ── P3 (Normal)
  Message age:  30 min  ── P2 (High)    [bumped]
  Message age:  60 min  ── P1 (Critical)[bumped]

Implementation:
  On dequeue, check (current_time - enqueue_time).
  If age > threshold, re-enqueue at elevated priority.
```

---

## Architecture Diagram: Multi-Tier with Auto-Scaling

```
                    ┌─────────────────────────────────────┐
                    │          API / Ingestion Layer       │
                    │  Assigns priority based on:          │
                    │  - Customer tier (paid vs free)      │
                    │  - Request type (payment vs report)  │
                    │  - SLA contract                      │
                    └────────────┬────────────────────────┘
                                 │
               ┌─────────────────┼──────────────────┐
               │                 │                  │
               ▼                 ▼                  ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
     │ Critical (P1) │  │  High (P2)   │  │  Bulk  (P3)  │
     │   Queue      │  │   Queue      │  │   Queue      │
     └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
            │                 │                  │
            ▼                 ▼                  ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
     │  Consumers   │  │  Consumers   │  │  Consumers   │
     │  Always ON   │  │  Min: 2      │  │  Min: 0      │
     │  (dedicated) │  │  Auto-scale  │  │  Scale down  │
     └──────────────┘  └──────────────┘  │  to 0 at    │
                                         │  low load    │
                                         └──────────────┘
```

---

## Priority Assignment Strategies

| Signal | Priority | Example |
|---|---|---|
| Customer tier | P1 for enterprise | Enterprise customer's export job |
| Request type | P1 for payments, P3 for analytics | Stripe charge vs. monthly report |
| User action vs. background | P2 for interactive, P3 for batch | User-triggered export vs. nightly ETL |
| SLA contract | Priority = SLA tier | 99.99% SLA customer → always P1 |
| Data freshness sensitivity | P1 for real-time, P3 for historical | Live dashboard vs. weekly digest |
| Error retry attempts | Decreasing priority per retry | Retry 1 = P2, Retry 3 = P3 |

---

## Trade-offs

### Advantages

| Advantage | Description |
|---|---|
| **SLA differentiation** | High-value work is guaranteed to run first, enabling tiered service offerings |
| **Resource efficiency** | Critical consumers can be right-sized independently from bulk consumers |
| **Graceful degradation** | Under load, low-priority work gracefully waits rather than failing |
| **Autoscaling alignment** | Each priority tier can have its own scaling policy (e.g., bulk scales to 0 at night) |
| **Business alignment** | Queue structure mirrors business priorities and customer tiers directly |

### Disadvantages

| Disadvantage | Description |
|---|---|
| **Starvation risk** | A sustained flood of P1 messages can permanently block P3 work |
| **Complexity** | Multiple queues, consumer polling logic, and monitoring per tier add operational burden |
| **Misordered priority** | Incorrect priority assignment at enqueue degrades the entire system |
| **Head-of-line blocking** | In single-queue implementations, one stuck P1 message can block everything behind it |
| **Ordering guarantees lost** | Messages of the same priority may still arrive out of order if processed by multiple consumers |
| **Priority inversion** | A high-priority task waiting on a result from a low-priority task leads to deadlock-like stalls |

### Starvation Mitigations

```
Option 1: Aging (time-based promotion)
  → Low-priority messages get bumped after N minutes

Option 2: Capacity reservations
  → Reserve 10% of consumer capacity exclusively for P3 work

Option 3: Weighted fair queuing
  → P1:P2:P3 processed at ratio 60:30:10

Option 4: Deadlines
  → Every message has an absolute deadline; violating the deadline triggers priority escalation
```

---

## When to Use vs. When Not to Use

### Use When

- Different workloads have measurably different SLAs or business value.
- A subset of tasks are interactive / user-facing, while others are background batch jobs.
- You have paying customer tiers that require guaranteed throughput.
- Periodic spikes (e.g., end-of-month reports) should not starve real-time processing.
- You need independent autoscaling per workload class.

### Do Not Use When

- All tasks have the same importance and SLA (adds complexity with no benefit).
- The system is not saturated — if capacity always exceeds demand, priority ordering is irrelevant.
- Strict FIFO ordering is a correctness requirement (e.g., event sourcing where event order matters).
- Priority assignment is non-deterministic or contentious (misassignment is worse than no priority).

---

## Decision Framework

```
Is there a meaningful difference in business value
or SLA between message types?
        │
       YES ──────────────────────────────────────────────────────────►
        │                                                            │
        ▼                                                        Can the
Does your broker natively support priority?               difference be mapped
(RabbitMQ x-max-priority, Azure Service Bus sessions)     to discrete tiers?
        │                                                            │
       YES ──► Use native priority field                            YES ──► Multiple physical queues
        │      (simpler ops, fewer queues)                           │      (most flexible)
        │                                                           NO ──► Aging/weighted fair queue
       NO  ──► Multiple physical queues
               + consumer polling order

In all cases: implement starvation prevention (aging or reserved capacity).
```

---

## Real-World Systems and Applications

### 1. Stripe — Payment Processing vs. Reporting

Stripe prioritizes payment authorization and webhook delivery (P1) far above analytics ingestion (P3). A spike in end-of-month invoice generation jobs cannot delay real-time card authorizations.

```
Critical Queue:  payment.authorize, webhook.deliver
High Queue:      invoice.send, subscription.renew
Bulk Queue:      report.generate, analytics.ingest
```

### 2. Uber — Ride Matching vs. Historical Replay

Uber's dispatch system uses prioritized message processing to ensure that ride request matching and driver location updates (real-time, revenue-critical) are never delayed by historical data replay or ML training jobs.

```
P1: ride.request, driver.location_update
P2: surge.recalculate
P3: trip.export_for_training, ml.feature_pipeline
```

### 3. AWS SQS — Message Group Priority via Multiple Queues

AWS SQS FIFO queues do not natively support priority ordering. AWS recommends the multiple-queue pattern, with Lambda consumers polling the critical queue first, falling back to standard queues when idle. Lambda reserved concurrency enforces consumer tier isolation.

### 4. Azure Service Bus — Sessions as Priority Lanes

Azure Service Bus supports sessions, which can be mapped to priority lanes. A consumer locks a session and processes all its messages before switching. This enables fair but prioritized drain of each tier.

```
Session "critical" → always offered first to eager receivers
Session "bulk"     → only accepted when no critical work pending
```

### 5. Shopify — Flash Sale vs. Background Jobs

During flash sales, Shopify routes checkout and order confirmation jobs to high-priority queues backed by dedicated Sidekiq workers with reserved capacity. Non-critical background jobs (email digests, report generation) are dequeued only when high-priority queues are empty.

### 6. Airbnb — Search Indexing Priority

Airbnb differentiates between index updates triggered by a host actively editing a listing (P1, affects immediate search results) and bulk re-indexing triggered by ML model retraining (P3). This ensures search quality remains fresh for the interactive case even when bulk indexing is running.

### 7. Netflix — Encoding Priority

When a new original is released globally, Netflix marks encoding jobs for the first few episodes as P1 to ensure they complete before the announcement. Back-catalog re-encodes for improved codec efficiency (AV1) run as P3 bulk work filling spare capacity.

---

## Implementation Notes

### Consumer Polling Pattern (Multiple Queues)

```python
# Pseudocode: Consumer poll loop with fallback
QUEUES = [critical_queue, high_queue, normal_queue, bulk_queue]

while True:
    message = None
    for queue in QUEUES:                 # Poll in priority order
        message = queue.receive(timeout=0)  # Non-blocking
        if message:
            break

    if not message:
        time.sleep(POLL_INTERVAL)        # Back off when all queues empty
        continue

    process(message)
    message.delete()
```

### Dead-Letter Queue Per Priority Tier

Every priority tier should have its own DLQ. A failing P1 message should not be moved to a shared DLQ where it competes for investigation with P3 failures.

```
Critical Queue ──► Critical DLQ ──► PagerDuty Alert
High Queue     ──► High DLQ     ──► Slack Alert
Bulk Queue     ──► Bulk DLQ     ──► Daily digest
```

### Priority Assignment at Enqueue (not at consume)

Priority must be set by the **producer** at enqueue time based on authoritative signals (customer tier from the database, request type from the API contract). Never let consumers assign priority to work they receive — they have incomplete context.

---

## Monitoring and Key Metrics

| Metric | Description | Alert Threshold |
|---|---|---|
| **Queue depth per tier** | Messages waiting per priority level | P1 depth > 100 → page on-call |
| **Age of oldest message** | Oldest unprocessed message per tier | P1 > 30s, P3 > 30min |
| **Consumer utilization per tier** | % of time consumers are busy | > 90% sustained → scale out |
| **Priority inversion count** | P3 messages completing before P1 messages enqueued at same time | Any > 0 → investigate |
| **Starvation depth** | P3 queue depth growing unbounded | > 10k → trigger aging |
| **Enqueue rate by tier** | Messages/sec entering each queue | Spike in P1 → capacity alert |
| **Processing latency p50/p99 by tier** | End-to-end time per priority level | P1 p99 > SLA threshold → alert |

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Flat queuing** | All work competes equally; latency non-deterministic under load | Introduce priority tiers |
| **Priority inflation** | Producers mark everything as P1 to guarantee throughput | Enforce priority quotas per producer; monitor P1 rate |
| **No starvation guard** | P3 queue grows unbounded; old messages never processed | Implement aging or reserved consumer capacity |
| **Shared DLQ across tiers** | P1 failures buried under P3 noise in the DLQ | Separate DLQ per priority tier |
| **Consumer-assigned priority** | Consumers re-prioritize on consume; inconsistent and racy | Producers assign priority at enqueue using authoritative data |
| **Priority inversion** | P1 task blocked waiting on a P3 dependency | Promote dependency's priority to match dependent task |
| **Too many priority levels** | 10-level scale is operationally unmanageable | Use 3–4 discrete tiers maximum |

---

## Summary Cheat Sheet

```
Core idea:         Higher-priority messages are always dequeued first.

Main approaches:   1. Multiple physical queues (most portable)
                   2. Native broker priority (RabbitMQ, Azure SB)
                   3. Aging/weighted fair queuing (starvation prevention)

Biggest risk:      Starvation of low-priority work.
Best mitigation:   Time-based priority aging or reserved capacity.

Sweet spot:        3–4 discrete priority tiers.

Avoid:             Priority inflation (everyone is P1 → back to flat queue).

Monitor always:    Queue depth + oldest message age, per tier.

Pair with:         Autoscaling per tier, separate DLQs per tier,
                   rate limiting per producer.
```