# Schedule-Driven Background Jobs

## What Is Schedule-Driven Invocation?

Schedule-driven jobs are background tasks triggered by **time** rather than by an external event or user action. A clock — not a queue — initiates execution. The task runs at a predetermined time, on a recurring cadence, or after a fixed delay.

**Core distinction from event-driven:** there is no message to consume, no producer to react to. The trigger is purely temporal.

---

## Common Use Cases

| Category | Examples |
|---|---|
| **Batch processing** | Nightly ETL, invoice generation, product recommendation updates |
| **Data maintenance** | Index rebuilding, vacuuming/compaction, partition pruning, archival |
| **Reporting** | Daily/weekly aggregations, metric rollups, dashboard pre-computation |
| **Data consistency checks** | Reconciliation jobs, orphan record cleanup, referential integrity audits |
| **Retention enforcement** | Deleting soft-deleted records, log rotation, expiring stale sessions |
| **Sync / replication** | Polling external APIs on a cadence, syncing to data warehouses |
| **Operational hygiene** | Certificate expiry checks, dependency health sweeps, token rotation |

---

## Trigger Types

### Cron-Based (Recurring)

The most common form. A cron expression defines the schedule.

```
┌──── minute (0-59)
│  ┌─── hour (0-23)
│  │  ┌── day of month (1-31)
│  │  │  ┌─ month (1-12)
│  │  │  │  ┌ day of week (0-6, Sun=0)
│  │  │  │  │
*  *  *  *  *

Examples:
0 2 * * *        → 2:00 AM every day
0 0 * * 0        → Midnight every Sunday
*/15 * * * *     → Every 15 minutes
0 9-17 * * 1-5   → Every hour, 9am–5pm, Mon–Fri
0 0 1 * *        → First day of every month at midnight
```

### Fixed-Interval (Polling Loop)

Runs every N seconds/minutes regardless of wall-clock time.

```
while true:
  run_job()
  sleep(interval)
```

- Simpler than cron; suitable for polling loops (check for new files, sync external API)
- **Drift risk:** if `run_job()` takes longer than the interval, next execution starts late (or overlaps)
- Fix drift: measure actual elapsed time and subtract from the next sleep duration

### One-Shot / Delayed Execution

Task scheduled to run **once** at a specific future time or after a delay.

```
at 2024-12-01T00:00:00Z → run year-end archival job
after 30 minutes         → send order confirmation follow-up email
```

- Common in workflow engines, delayed notification systems, SLA enforcement timers
- Implemented via: task queues with delay support (SQS delay, RabbitMQ TTL + DLQ), durable timers (Temporal, Durable Functions), or DB-backed scheduler polling a `scheduled_at` column

---

## Architecture Patterns

### Centralized Scheduler

```
Scheduler Process
  → emits trigger at T
  → calls Job Worker (HTTP, queue message, or direct invocation)
  → Job Worker executes task
```

- One process owns all schedule definitions
- Easy to reason about; visible audit of what runs when
- **Single point of failure** — if the scheduler crashes, nothing runs
- Mitigate with: HA scheduler (leader election), health monitoring, missed-run alerting

### Decentralized (In-Process Cron)

Each service instance runs its own scheduler (e.g., cron daemon, OS task scheduler, in-process library).

```
App Instance 1: internal cron → runs job at 2am
App Instance 2: internal cron → also runs job at 2am  ← DUPLICATE
App Instance 3: internal cron → also runs job at 2am  ← DUPLICATE
```

- Zero infrastructure overhead
- **Critical problem:** if the app scales horizontally, every instance fires the job → duplicate execution
- Requires distributed locking to enforce single execution (see below)

### DB-Backed Scheduler (Polling)

Jobs stored as rows in a `scheduled_jobs` table. A polling loop claims and executes due jobs.

```sql
scheduled_jobs:
  id | job_type    | run_at              | status   | locked_by | locked_at
  1  | daily_report| 2024-11-01 02:00:00 | pending  | null      | null
  2  | db_cleanup  | 2024-11-01 03:00:00 | pending  | null      | null
```

```
Polling loop (every N seconds):
  SELECT ... WHERE run_at <= NOW() AND status = 'pending'
  FOR UPDATE SKIP LOCKED          ← atomic claim; competing workers each get a different row
  → mark status = 'running', locked_by = worker_id
  → execute job
  → mark status = 'done' (or 'failed')
```

- **`FOR UPDATE SKIP LOCKED`** is the key primitive — enables multiple workers to claim jobs without contention
- Naturally handles distributed locking, retries, failure tracking, and history
- **Polling delay** = up to N seconds of latency between `run_at` and actual execution
- Used by: Sidekiq Pro, Delayed::Job, Quartz (Java), many custom implementations

### Leader Election + Single Runner

Use distributed consensus to elect one scheduler instance as leader. Only the leader fires jobs.

```
Instances: [A, B, C]
  Acquire lock in Redis / ZooKeeper / etcd
  Winner (A) = leader → runs scheduler
  B, C = standby → poll lock; ready to take over if A fails

A crashes → lock TTL expires → B acquires lock → becomes leader
```

- Clean solution for singleton scheduling across a scaled service
- Lock TTL must be shorter than job interval; renewal required during long jobs
- Tools: Redis `SET NX EX`, etcd leases, ZooKeeper ephemeral nodes, Kubernetes `Lease` objects

---

## The Overlap / Concurrent Execution Problem

**The most critical concern in schedule-driven design.** If a job takes longer than its schedule interval, the scheduler fires again before the previous run finishes.

```
Schedule: every 5 minutes
Job duration: 7 minutes

T=0:00  → Run 1 starts
T=5:00  → Scheduler fires → Run 2 starts (Run 1 still executing)
T=7:00  → Run 1 finishes
T=10:00 → Scheduler fires → Run 3 starts (Run 2 still executing)
...
```

**Consequences:** race conditions on shared data, double-processing, compounding backlog.

### Solutions

| Approach | How | Trade-off |
|---|---|---|
| **Skip if already running** | Check lock before starting; skip if lock held | Simple; may miss work if consistently slow |
| **Queue + single worker** | Scheduler enqueues a message; one worker processes at a time | Queue absorbs triggers; natural serialization |
| **Distributed lock with TTL** | Acquire lock at job start; release on completion; skip if lock taken | Works across instances; must tune TTL carefully |
| **Kubernetes `concurrencyPolicy: Forbid`** | Platform-level enforcement; new CronJob skips if previous still running | Zero code required; limited to K8s |
| **Fix the job** | Reduce execution time (parallelism, better queries, incremental processing) | Best long-term fix |

### Kubernetes CronJob Concurrency Policies

| Policy | Behavior |
|---|---|
| `Allow` (default) | Multiple job instances can run concurrently |
| `Forbid` | Skip new run if previous is still running |
| `Replace` | Cancel previous run; start a new one |

---

## Idempotency in Scheduled Jobs

Scheduled jobs **will run more than once** due to retries, overlapping executions, or manual re-runs. Every scheduled job must be idempotent.

**This is not optional.** Assume the job can be triggered N times for the same logical window.

### Idempotency Strategies

**Window-based idempotency key:**
```
job_id = hash(job_type + schedule_window)
       = hash("daily_report" + "2024-11-01")

Before running:
  INSERT INTO job_runs (id, job_id, started_at)
  ON CONFLICT (job_id) DO NOTHING
  → if 0 rows inserted: another instance already started this run; skip
```

**State machine gating:**
```
Job states: PENDING → RUNNING → DONE | FAILED

Only start if current state = PENDING
Transition to RUNNING atomically (compare-and-swap)
→ concurrent runners see RUNNING; skip
```

**Upsert / conditional writes:**
```sql
-- Report generation: insert or skip if already exists for this window
INSERT INTO daily_reports (date, data)
VALUES ('2024-11-01', ...)
ON CONFLICT (date) DO NOTHING;
```

**Soft-delete aware cleanup:**
```sql
-- Data retention: only delete records that meet criteria; re-running is safe
DELETE FROM audit_logs
WHERE created_at < NOW() - INTERVAL '90 days'
AND archived = true;
-- Running twice: second run finds no matching rows; no harm done
```

---

## Missed Runs

A scheduled job can fail to fire due to: scheduler downtime, deployment gaps, clock skew, or a race condition.

### Detecting Missed Runs

The challenge: **a missed run produces no error**. Nothing happened. Standard error alerting won't catch it.

```
Expected run: 2024-11-01 02:00:00
Actual runs in DB:
  2024-10-31 02:00:00  ✓
  2024-11-01 02:00:00  ← MISSING
  2024-11-02 02:00:00  ✓
```

Detection strategies:
- **Heartbeat check:** job writes a "last successful run" timestamp on completion; external monitor alerts if timestamp is older than expected interval + buffer
- **Run log comparison:** compare expected run times (generated from cron expression) against actual run log; alert on gaps
- **Dead man's switch:** job pings an external watchdog (e.g., healthchecks.io, PagerDuty) on each completion; watchdog alerts if ping not received within the expected window

### Catch-Up / Backfill Behavior

When a scheduler restarts after downtime, should it run missed jobs?

| Strategy | Behavior | Use When |
|---|---|---|
| **Run all missed** | Execute once per missed schedule window | Data pipelines where every window must be processed |
| **Run latest only** | Execute once for the most recent window; skip older ones | Cleanup, maintenance — stale runs have no value |
| **Skip all missed** | Do nothing; wait for next scheduled time | Idempotent reporting — next run will cover everything |

Define this explicitly. Default behavior varies by scheduler (Kubernetes CronJob: `startingDeadlineSeconds`; Airflow: `catchup=True/False`).

---

## Distributed Locking for Scheduled Jobs

When multiple instances of a service all have a scheduler, a distributed lock ensures only one executes.

### Redis-Based Lock

```
SETNX  lock:daily_report  worker_id_abc  EX 300
→ Returns 1: lock acquired → proceed
→ Returns 0: lock held by another → skip this run

On completion:
  DEL lock:daily_report   (only if value = worker_id_abc — check ownership first)

If job takes longer than TTL (300s):
  Extend lock: SET lock:daily_report worker_id_abc EX 300 XX  (before expiry)
```

**Critical:** always set a TTL. If the process crashes without releasing, the lock must expire automatically.

**Ownership check on release:**
```
-- Use Lua for atomic check + delete:
if redis.call("GET", key) == worker_id then
  return redis.call("DEL", key)
end
```
Without this check, a slow worker's lock expires, another worker acquires it, then the slow worker finishes and deletes the new owner's lock.

### Database-Based Lock

```sql
-- Postgres advisory lock (session-level)
SELECT pg_try_advisory_lock(hashtext('daily_report_job'));
→ true:  lock acquired
→ false: another instance holds it

-- Released automatically when session ends (crash-safe)
```

- No TTL management needed — DB releases on connection close
- Suitable when the job already uses the same DB connection
- Not suitable across multiple DB instances

---

## Scheduling Reliability

### Retry on Failure

A job that fails should retry — but not indefinitely.

```
Retry policy for scheduled jobs:
  Max attempts: 3
  Backoff: exponential with jitter (1s, 4s, 16s + random)
  On exhaustion: alert + record in failed_jobs table

Do NOT retry indefinitely:
  → Compounding retries from multiple missed windows fill the queue
  → Permanent failures (bad config, corrupt data) loop forever
```

### Separating Scheduling from Execution

**Anti-pattern:** the scheduler executes the job inline.

```
-- Bad: scheduler does the work
at 2am:
  scheduler process runs 2-hour ETL job inline
  if scheduler restarts mid-job: state lost, job must restart from scratch
```

**Better pattern:** scheduler enqueues a message; worker executes independently.

```
at 2am:
  Scheduler → enqueues { jobType: "daily_etl", window: "2024-11-01" } to queue
  Worker    → consumes message → executes ETL
  Worker    → checkpoints progress every N rows
  Worker crashes → message redelivered → resume from checkpoint
```

Benefits:
- Scheduler failure doesn't kill in-progress work
- Workers can be scaled independently of the scheduler
- At-least-once delivery + idempotency handles restarts
- Job history lives in the queue and worker logs, not the scheduler

---

## Time Zone Handling

Time zones are one of the most common sources of bugs in scheduled jobs.

### Rules

- **Store schedules in UTC internally.** Never store local time in schedule definitions.
- **Express user-facing schedules in the user's local time zone**, then convert to UTC for storage and execution.
- **Account for DST transitions.** A job scheduled for `02:00` local time may fire at `01:00` or `03:00` UTC the day DST changes — or may not fire at all (if the clock skips 2am).
- **Use a proper time zone library.** `America/New_York`, not `UTC-5`. Named zones handle DST automatically; fixed offsets don't.

### DST Edge Cases

| Scenario | Risk | Mitigation |
|---|---|---|
| Clock springs forward (2am → 3am) | A job scheduled at 2:30am never fires | Use UTC; document expected behavior |
| Clock falls back (2am → 1am again) | A job scheduled at 1:30am fires twice | Idempotency key based on date window |
| Monthly job scheduled for "last day" | Feb, months with 30/31 days behave differently | Use `last day of month` semantics explicitly |

---

## Observability

### What to Instrument

| Signal | What to Track |
|---|---|
| **Run start + end time** | Duration trend; detect slowdowns before SLA breach |
| **Run outcome** | `success` / `failed` / `skipped` per execution |
| **Last successful run timestamp** | Feed to external watchdog for missed-run detection |
| **Records processed** | Validate job did meaningful work; detect silent no-ops |
| **Lock acquisition result** | Track how often jobs are skipped due to concurrent instance |
| **Lag from scheduled time** | How late did execution actually start? (scheduler overhead) |

### Alerting Rules

- Last successful run timestamp older than `interval × 1.5` → **missed run alert**
- Job duration > P95 baseline × 2 → **performance degradation alert**
- Consecutive failures ≥ 3 → **page on-call**
- Jobs skipped due to overlap > N per day → **job is too slow; needs optimization**
- Records processed = 0 when non-zero expected → **silent no-op alert**

### Common Observability Anti-Patterns

| Anti-Pattern | Problem |
|---|---|
| Only alerting on exceptions | A missed run or a no-op produces no exception |
| Logging "job started" but not "job completed" | Hung jobs look healthy |
| No duration trending | Slow degradation goes unnoticed until SLA breach |
| No records-processed metric | Job runs successfully but processes nothing; data pipeline silently empty |

---

## Clock Skew and Distributed Time

Servers in a distributed system do not have perfectly synchronized clocks. NTP corrects drift over time, but instantaneous skew of tens to hundreds of milliseconds is normal. Larger skew is possible after NTP sync corrections.

**Implications for schedulers:**
- Two instances checking `run_at <= NOW()` simultaneously may get slightly different answers
- Distributed lock TTLs set in wall time may expire slightly earlier or later than expected
- Mitigate with **fencing tokens** (monotonically increasing version from lock server) rather than relying on wall-clock time for correctness

---

## Scheduler Technology Reference

| Tool / Platform | Type | Key Characteristics |
|---|---|---|
| **Cron (OS)** | In-process / OS | Zero dependencies; no HA; single machine only |
| **Kubernetes CronJob** | Platform | Native K8s; `concurrencyPolicy`; limited observability |
| **Celery Beat** | Application-level | Python; stores schedule in DB or Redis; no built-in HA leader election |
| **Sidekiq-Cron / Sidekiq Pro** | Application-level | Ruby; integrates with Sidekiq queue; DB-backed dedup |
| **Quartz Scheduler** | Application-level | Java; JDBC-backed clustering; mature; verbose config |
| **Temporal** | Workflow engine | Durable timers; handles missed runs, retries, history natively; high operational overhead |
| **Apache Airflow** | Workflow orchestrator | DAG-based; powerful dependency management; significant infra overhead |
| **pg_cron** | DB-level | Runs SQL jobs from inside Postgres; no external scheduler needed; limited to DB operations |
| **AWS EventBridge Scheduler** | Managed cloud | Fully managed; one-time + recurring; targets Lambda, SQS, Step Functions, etc. |
| **Cloud Scheduler (GCP)** | Managed cloud | HTTP/Pub-Sub targets; integrates with GCP ecosystem |

---

## Design Checklist

```
□ Schedule expressed in UTC; DST transitions accounted for
□ Concurrent execution handled — distributed lock or queue serialization
□ Job is idempotent — window-based key or upsert semantics
□ Scheduler and execution are separated — scheduler enqueues; worker executes
□ Missed-run detection in place — heartbeat or dead man's switch
□ Catch-up / backfill behavior explicitly defined
□ Retry policy defined — max attempts, backoff, exhaustion handling
□ Distributed lock has TTL — crash-safe; won't deadlock
□ Lock ownership verified before release — no accidental unlock of another instance's lock
□ Job duration tracked and alerted on
□ Records-processed metric emitted — silent no-ops are caught
□ Last-successful-run timestamp exposed for external monitoring
□ Overlap (job slower than interval) tested and handled
□ One-shot jobs have unique idempotency key tied to the scheduled window
```

---

## Common Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| In-process cron on a horizontally scaled service | Every instance fires the job → duplicate execution | Distributed lock or leader election |
| No missed-run alerting | Missed schedule produces no error → silent data gap | Heartbeat / dead man's switch |
| Scheduler executes job inline | Scheduler crash kills in-progress work | Enqueue to worker queue; execute separately |
| Non-idempotent job | Manual re-run or overlap → data corruption | Window-based idempotency key |
| Hardcoded local time zone | DST transitions cause double-fires or skipped runs | Store schedules in UTC |
| Unbounded retries | Failed window retries pile up and overwhelm workers | Cap retries; alert on exhaustion |
| No records-processed metric | Job runs successfully but does nothing | Emit count; alert on zero when non-zero expected |
| Lock TTL too short | Job still running when TTL expires → another instance starts → concurrent execution | Set TTL > P99 job duration; extend lock proactively |
| Lock TTL too long | Crashed worker holds lock until TTL expiry → job doesn't run for a long time | Balance TTL with detection latency requirements |