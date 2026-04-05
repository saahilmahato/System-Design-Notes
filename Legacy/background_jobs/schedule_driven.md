# Background Jobs: Schedule-Driven

---

## What Are Schedule-Driven Background Jobs?

Schedule-driven background jobs are tasks executed **automatically at predetermined times or intervals**, independent of direct user interaction. They are triggered by a **time-based scheduler** (cron, timer, orchestrator) rather than an event or a user request.

They run in the background so they do not block or interfere with the main application flow.

---

## Core Concepts

### Scheduling Primitives

| Primitive | Description | Example |
|---|---|---|
| **Cron Expression** | Time-based rule using a 5-7 field syntax | `0 2 * * *` (every day at 2 AM) |
| **Fixed Interval** | Repeats every N units of time | Every 15 minutes |
| **Fixed Delay** | Waits N units *after* completion before re-running | Run, finish, wait 10 min, repeat |
| **One-time / Scheduled Future** | Fires once at a specific datetime | 2026-04-01 00:00:00 |

### Cron Syntax Cheatsheet

```
┌───────── minute        (0–59)
│ ┌─────── hour          (0–23)
│ │ ┌───── day of month  (1–31)
│ │ │ ┌─── month         (1–12)
│ │ │ │ ┌─ day of week   (0–7, 0 & 7 = Sunday)
│ │ │ │ │
* * * * *

Examples:
  0 * * * *       → Every hour on the hour
  */15 * * * *    → Every 15 minutes
  0 9 * * 1-5     → 9 AM on weekdays only
  0 0 1 * *       → Midnight on the 1st of each month
  0 2 * * 0       → 2 AM every Sunday
```

---

## Key Components

```
┌─────────────────────────────────────────────────────┐
│                   Scheduler / Clock                 │  ← Time source & trigger
└──────────────────────────┬──────────────────────────┘
                           │ fires
                           ▼
┌─────────────────────────────────────────────────────┐
│                   Job Registry                      │  ← Stores job definitions
│        (job name, schedule, handler, config)        │
└──────────────────────────┬──────────────────────────┘
                           │ dispatches
                           ▼
┌─────────────────────────────────────────────────────┐
│                   Job Queue / Executor              │  ← Runs the job logic
│         (thread pool, worker process, lambda)       │
└──────────────────────────┬──────────────────────────┘
                           │ writes result to
                           ▼
┌─────────────────────────────────────────────────────┐
│              Monitoring & Audit Log                 │  ← Tracks runs, failures
└─────────────────────────────────────────────────────┘
```

---

## Common Use Cases

- **Data Aggregation & Reporting** — Compute daily/weekly/monthly reports, summaries, or metrics.
- **Database Maintenance** — Purge expired records, vacuum tables, rebuild indexes.
- **Invoicing & Billing** — Generate invoices at end of billing cycle.
- **Cache Warming** — Pre-populate caches before peak traffic.
- **Email / Notification Digests** — Send weekly newsletter or daily digest.
- **Sync & ETL Pipelines** — Pull data from external APIs, transform and load into warehouse.
- **Backup & Snapshots** — Nightly database or file system backups.
- **Retry & Cleanup** — Re-process stuck/failed records, remove stale sessions or tokens.
- **ML Model Retraining** — Nightly model refresh on new data.

---

## Architecture Patterns

### 1. Single-Node Cron (Simple)
```
┌─────────────┐
│  Cron Daemon│ ─── runs job directly on one server
└─────────────┘
```
- **Simple** but has **no HA**, no audit trail, and no distribution.
- Suitable for low-stakes internal tools.

### 2. Centralized Scheduler → Message Queue
```
┌─────────────┐    enqueue    ┌──────────┐    consume   ┌──────────┐
│  Scheduler  │ ────────────► │  Queue   │ ───────────► │ Workers  │
└─────────────┘               └──────────┘               └──────────┘
```
- Scheduler only enqueues; workers independently consume.
- Decouples scheduling from execution.
- Workers can scale independently.

### 3. Distributed Scheduler with Leader Election
```
┌────────────┐   ┌────────────┐   ┌────────────┐
│ Scheduler A│   │ Scheduler B│   │ Scheduler C│
│  (standby) │   │  (leader)  │   │  (standby) │
└────────────┘   └─────┬──────┘   └────────────┘
                       │ only leader fires jobs
                       ▼
                  Job Queue / Workers
```
- Uses ZooKeeper, etcd, or Redis to elect a leader.
- Prevents duplicate firings in multi-instance deployments.

### 4. Serverless / FaaS Scheduled Triggers
```
Cloud Scheduler ──► Function (Lambda / Cloud Function / Azure Function)
```
- Fully managed; no infra to maintain.
- Cold start latency can be an issue for time-sensitive jobs.

---

## Critical Design Concerns

### Idempotency
Jobs **must** be idempotent — re-running them should produce the same result without side effects.  
Use idempotency keys, upserts, or deduplication logic within the job.

### Exactly-Once vs At-Least-Once Execution
- Most schedulers guarantee **at-least-once** (job may fire more than once on failure/retry).
- **Exactly-once** requires distributed locks (e.g., Redis `SET NX`, database row-level locking).
- Design for at-least-once; make jobs idempotent to handle duplicates safely.

### Distributed Locking (Preventing Duplicate Runs)
When multiple instances are deployed, guard against concurrent execution:
```
Acquire Lock (e.g., Redis SETNX with TTL)
  └── If acquired: run job → release lock
  └── If not acquired: skip (another instance is running)
```

### Clock Drift & Time Zones
- Use **UTC** for all schedules internally; convert to local time only for display.
- Be aware of DST transitions — a job at `0 2 * * *` in a local time zone may skip or fire twice.
- Synchronize server clocks with NTP.

### Job Overlapping
If a job takes longer than its interval, the next run can start before the previous one finishes.  
Strategies:
- **Skip** next run if the current one is still running.
- **Queue** next run but run sequentially.
- **Parallelize** if the job can safely run concurrently.

### Long-Running Jobs
- Break into smaller chunks (pagination/batching).
- Use checkpointing to resume on failure.
- Report heartbeat signals to the scheduler to avoid premature timeout detection.

---

## Trade-offs

| Concern | Option A | Option B | Notes |
|---|---|---|---|
| **Simplicity vs Reliability** | Single-node cron | Distributed scheduler | Cron is easy to set up but is a SPOF |
| **Latency tolerance** | Batch at fixed time | Event-driven triggers | Schedule has predictable load; events react faster |
| **Execution guarantee** | At-least-once | Exactly-once | Exactly-once requires coordination overhead |
| **Scalability** | In-process job | Worker pool via queue | Queue decoupling allows horizontal scaling |
| **Observability** | Fire-and-forget | Full audit log | Logging adds overhead but is essential for debugging |
| **Flexibility** | Rigid cron | Dynamic schedule (DB-driven) | DB-driven schedules allow runtime changes without redeploy |
| **Infra cost** | Self-managed scheduler | Serverless triggers | Serverless reduces ops cost but has cold-start and cost-per-invocation |
| **Tight scheduling (sub-minute)** | In-process timer loop | Message queue with delay | Cron is limited to 1-minute granularity; need custom solutions for finer control |

---

## Failure Handling & Retry Strategy

```
Job fires
   └── Success → log, update status, release lock
   └── Failure
         ├── Transient (network, timeout) → Retry with backoff
         │       └── Max retries exceeded → Dead-letter / Alert
         └── Permanent (bug, bad data) → Dead-letter / Alert → Manual review
```

**Retry policies:**
- **Immediate retry** — Good for transient glitches.
- **Fixed delay** — Wait N seconds between retries.
- **Exponential backoff** — Double the delay each retry (add jitter to avoid thundering herd).
- **Max retry count** — Always cap retries to prevent infinite loops.

**Dead-letter handling:**
- Move failed jobs to a dead-letter queue or table.
- Alert on-call team for investigation.
- Provide a manual re-trigger mechanism.

---

## Observability & Monitoring

Every scheduled job should be observable across three dimensions:

| Dimension | What to Track |
|---|---|
| **Execution** | Start time, end time, duration, status (success/failure/skipped) |
| **Health** | Last successful run, missed schedules, SLA breach alerts |
| **Business** | Records processed, rows updated, emails sent |

**Key alerts to set up:**
- Job did not fire within the expected window (missed schedule).
- Job exceeded its expected max duration (possible hang).
- Job failure rate above threshold.
- Job is currently running and has been for too long (zombie job).

Tools: Prometheus + Grafana, Datadog, Cronitor, Healthchecks.io, CloudWatch.

---

## Real-World Systems & Applications

### Netflix
- Uses **Fenzo** (a Mesos-based scheduler) and internal schedulers for nightly content encoding jobs, recommendation model refreshes, and billing aggregation across millions of users.

### Airbnb
- Built **Airflow** (Apache Airflow), now widely adopted, to orchestrate complex DAG-based scheduled ETL and data pipeline jobs — nightly revenue reporting, pricing model updates.

### Uber
- Uses **Cadence** (now open-sourced as **Temporal**) to manage scheduled workflows like driver incentive calculations, surge pricing data refreshes, and trip reconciliation.

### GitHub
- Offers **GitHub Actions Scheduled Workflows** via cron expressions — widely used for nightly CI builds, stale issue cleanup, dependency updates (Dependabot), and security scans.

### Stripe
- Runs nightly batch jobs for **invoice generation**, **payout processing** to bank accounts, fraud model scoring, and financial reconciliation across its global payments infrastructure.

### LinkedIn
- Relies on **Azkaban** for scheduling Hadoop and Spark jobs — daily analytics aggregation, feed ranking model retraining, and member engagement metrics computation.

### Google Cloud / AWS / Azure
- **Cloud Scheduler** (GCP), **EventBridge Scheduler** (AWS), **Azure Logic Apps Timer Triggers** — all provide managed, serverless cron-style job triggering with built-in retry and monitoring.

---

## Popular Tools & Technologies

| Tool | Type | Notes |
|---|---|---|
| **Cron (Unix)** | OS-level | Simplest option; no HA, no UI |
| **Apache Airflow** | DAG Orchestrator | Rich UI, complex dependencies, Python-defined DAGs |
| **Temporal / Cadence** | Workflow Engine | Durable execution, retry logic built-in |
| **Celery Beat** | Python Scheduler | Extension of Celery; integrates with Redis/RabbitMQ |
| **Quartz Scheduler** | Java Library | Clustered job scheduling for JVM apps |
| **Kubernetes CronJob** | K8s Native | Container-based jobs on a schedule; easy scaling |
| **AWS EventBridge Scheduler** | Managed Cloud | Serverless, millions of schedules, IAM-integrated |
| **Google Cloud Scheduler** | Managed Cloud | HTTP/Pub-Sub targets, fully managed |
| **Sidekiq-Cron / Sidekiq Scheduler** | Ruby | For Ruby/Rails apps using Sidekiq |
| **pg_cron** | DB-native | Runs SQL jobs inside PostgreSQL |
| **Healthchecks.io** | Monitoring | Heartbeat monitoring for scheduled jobs |

---

## Anti-Patterns to Avoid

1. **Running on every app instance** — Without distributed locking, every pod/server fires the job simultaneously.
2. **No idempotency** — Re-runs after failure create duplicate records or double-sends.
3. **Silent failures** — Job fails but no alert is raised; nobody notices for days.
4. **Overly long jobs without checkpointing** — A timeout kills a 4-hour job at hour 3 with no way to resume.
5. **Hardcoded local time zones** — DST shifts cause jobs to skip or double-fire.
6. **Unbounded retries** — Infinitely retrying a permanently broken job floods the system.
7. **No max execution time (TTL)** — A hung job holds its lock forever, blocking future runs.
8. **Treating cron as a workflow engine** — For complex multi-step pipelines with dependencies, use Airflow or Temporal instead.

---

## Summary

| Aspect | Key Takeaway |
|---|---|
| **Trigger** | Time / interval based (not user action, not event) |
| **Core guarantee needed** | Idempotency + at-least-once with deduplication |
| **Scaling** | Decouple scheduling from execution via a queue |
| **HA** | Leader election or managed scheduler to avoid duplicate runs |
| **Observability** | Always log runs, alert on missed/long/failed jobs |
| **Complexity growth** | Graduate from cron → queue-backed jobs → orchestrator (Airflow/Temporal) as complexity grows |