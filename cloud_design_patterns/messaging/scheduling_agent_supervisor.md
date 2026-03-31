# Cloud Design Pattern: Scheduling Agent Supervisor

---

## 1. Overview

The **Scheduling Agent Supervisor** pattern coordinates a set of distributed actions as a single operation. It is used when a workflow involves multiple steps across remote services or resources that may fail independently, and where the system must ensure consistency without relying on distributed transactions.

The pattern is composed of three roles:

| Role | Responsibility |
|---|---|
| **Scheduler** | Orchestrates the sequence of steps; tracks state; triggers agents |
| **Agent** | Executes a single discrete task against a remote service/resource |
| **Supervisor** | Monitors for stalled or failed schedulers; triggers recovery or compensation |

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CLIENT REQUEST                               │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          SCHEDULER                                   │
│                                                                      │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────────────┐  │
│  │  Step State │   │  Step State  │   │       Step State         │  │
│  │  PENDING    │──▶│  RUNNING     │──▶│     COMPLETED / FAILED   │  │
│  └─────────────┘   └──────┬───────┘   └──────────────────────────┘  │
│                           │                                          │
│                    Writes heartbeat/                                 │
│                    state to store                                    │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ Dispatches tasks
            ┌───────────────┼────────────────────┐
            ▼               ▼                    ▼
       ┌─────────┐    ┌──────────┐         ┌──────────┐
       │ Agent A │    │ Agent B  │         │ Agent C  │
       │(Reserve │    │(Charge   │         │(Send     │
       │ Seat)   │    │ Card)    │         │ Email)   │
       └────┬────┘    └────┬─────┘         └────┬─────┘
            │              │                     │
            └──────────────┴─────────────────────┘
                           │ Reports success/failure
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         SUPERVISOR                                   │
│                                                                      │
│  - Polls state store for stale/timed-out schedulers                  │
│  - Detects missing heartbeats                                        │
│  - Triggers retry OR compensating transactions                       │
│                                                                      │
│  [Scheduler Timeout?] ──▶ [Resume Scheduler] OR [Compensate & Abort] │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Mechanics

### 2.1 Scheduler

- Maintains a **state document** (in a durable store — DB, blob storage) for the entire workflow.
- Each step has its own state: `PENDING → RUNNING → COMPLETED | FAILED | COMPENSATING`.
- Writes a **heartbeat timestamp** at regular intervals while executing.
- If an agent succeeds → advances to next step.
- If an agent fails → decides: retry (if idempotent) or trigger compensation.

### 2.2 Agent

- Performs a **single, well-scoped action** against an external resource.
- Must be **idempotent** — safe to call multiple times with the same result.
- Returns: `SUCCESS`, `FAILURE`, or `TRANSIENT_ERROR` (retryable).
- Does **not** know about the broader workflow — purely task-scoped.

### 2.3 Supervisor

- Runs **independently** on a separate process/timer.
- Polls the state store for schedulers whose **heartbeat has expired** (i.e., the scheduler crashed or hung).
- On detection:
  - Attempt to **resume** the scheduler from last known good step.
  - If resume is not safe → execute **compensating transactions** to undo completed steps.
- Uses **distributed locking** (e.g., Redis SETNX, DB advisory locks) to prevent multiple supervisors from acting on the same stalled scheduler.

### 2.4 State Machine Per Workflow

```
PENDING
   │
   ▼
RUNNING ──[heartbeat expires]──▶ STALLED (detected by Supervisor)
   │                                    │
   │                          ┌─────────┴───────────┐
   │                          ▼                     ▼
   │                       RESUME              COMPENSATING
   │                          │                     │
   ▼                          │                     ▼
COMPLETED ◀─────────────────────            COMPENSATED / ABORTED
```

---

## 3. When to Use

- Long-running workflows that span **multiple remote services**.
- Operations that cannot be wrapped in a **single ACID transaction** (distributed transactions are too costly or not available).
- Steps that are potentially **slow or unreliable** (payment gateways, inventory systems, third-party APIs).
- When you need **visibility and auditability** into multi-step process state.
- Systems where **partial failures** are unacceptable and rollback must be orchestrated.

---

## 4. When NOT to Use

- Simple, fast, single-step operations — overkill.
- When all steps fit within a single transactional database — just use ACID.
- When eventual consistency in failure recovery is unacceptable (requires strong ACID guarantees).
- When compensating transactions are **not possible** (e.g., sending an email cannot be "unsent").

---

## 5. Trade-offs

| Dimension | Benefit | Cost |
|---|---|---|
| **Fault Tolerance** | Survives scheduler crashes; supervisor recovers state | Supervisor itself is a new failure point |
| **Consistency** | Explicit state tracking prevents lost steps | No true atomicity; window exists between steps |
| **Scalability** | Agents scale independently | State store becomes a bottleneck at high volume |
| **Idempotency** | Enables safe retries after partial failures | All agents must be designed idempotent — added engineering cost |
| **Visibility** | Full audit trail of each step | State store must be maintained and pruned over time |
| **Complexity** | Handles arbitrary workflow topologies | Significant operational complexity vs simple request/response |
| **Latency** | Steps run asynchronously | Adds latency vs synchronous calls; not suitable for real-time |
| **Compensation** | Can undo completed steps on failure | Compensating transactions are often hard/impossible (e.g., emails sent) |

### Key Trade-off: Saga vs Scheduling Agent Supervisor

| | Saga Pattern | Scheduling Agent Supervisor |
|---|---|---|
| **Coordination** | Choreography or Orchestration | Centralized (Scheduler) |
| **Recovery** | Each service self-compensates (choreography) | Supervisor triggers recovery |
| **State** | Distributed across services | Centralized in state store |
| **Visibility** | Hard (choreography) / Better (orchestration) | Excellent — full state in one place |
| **Complexity** | Lower for simple flows | Higher — three distinct roles |
| **Best for** | Microservices with clear ownership | Long-running, complex, multi-system workflows |

---

## 6. Implementation Blueprint

### 6.1 State Document Schema (JSON / DB Row)

```json
{
  "workflow_id": "order-9821",
  "status": "RUNNING",
  "heartbeat": "2024-11-01T10:45:00Z",
  "current_step": 2,
  "steps": [
    { "id": 1, "name": "reserve_inventory", "status": "COMPLETED", "result": {...} },
    { "id": 2, "name": "charge_payment",    "status": "RUNNING",   "result": null },
    { "id": 3, "name": "send_confirmation", "status": "PENDING",   "result": null }
  ],
  "compensations": [
    { "step_id": 1, "action": "release_inventory", "status": "PENDING" }
  ]
}
```

### 6.2 Scheduler Pseudocode (Python-style)

```python
class Scheduler:
    def run(self, workflow_id: str):
        state = state_store.load(workflow_id)
        
        for step in state.pending_steps():
            state.update_step(step.id, status="RUNNING")
            state.write_heartbeat()
            
            try:
                result = agents[step.name].execute(step.params)
                state.update_step(step.id, status="COMPLETED", result=result)
            
            except TransientError as e:
                if step.retries < MAX_RETRIES:
                    state.update_step(step.id, retries=step.retries + 1)
                    retry_later(workflow_id, delay=backoff(step.retries))
                    return
                else:
                    self._compensate(state, step)
                    return
            
            except PermanentError as e:
                self._compensate(state, step)
                return
        
        state.update_status("COMPLETED")
    
    def _compensate(self, state, failed_step):
        state.update_status("COMPENSATING")
        for completed_step in reversed(state.completed_steps_before(failed_step)):
            agents[completed_step.compensation_action].execute(completed_step.result)
        state.update_status("COMPENSATED")
```

### 6.3 Supervisor Pseudocode

```python
class Supervisor:
    def scan(self):
        stalled = state_store.find_stalled(
            status="RUNNING",
            heartbeat_older_than=TIMEOUT_THRESHOLD
        )
        
        for workflow_id in stalled:
            with distributed_lock(workflow_id):  # Prevent double-processing
                state = state_store.load(workflow_id)
                
                if state.is_resumable():
                    scheduler.resume(workflow_id)
                else:
                    scheduler.compensate(workflow_id)
```

### 6.4 Agent Interface Contract

```python
class Agent(ABC):
    @abstractmethod
    def execute(self, params: dict) -> dict:
        """
        Must be idempotent.
        Must return structured result.
        Must raise TransientError or PermanentError on failure.
        """
        pass
    
    @abstractmethod
    def compensate(self, original_result: dict) -> None:
        """Undo the effect of execute(). Must also be idempotent."""
        pass
```

---

## 7. Key Design Decisions

### 7.1 State Store Selection

| Store | Use Case | Notes |
|---|---|---|
| **PostgreSQL** | General workflows, moderate scale | ACID guarantees; easy querying of stalled jobs |
| **Redis** | High-throughput, short-lived workflows | Volatile; pair with TTL; use for heartbeat tracking |
| **DynamoDB** | Massive scale, cloud-native | Use conditional writes for optimistic locking |
| **Blob Storage (S3/Azure Blob)** | Large state payloads | Slower; use for archiving completed workflows |

### 7.2 Heartbeat Timeout Tuning

```
Timeout = (Agent SLA) × (Max Retries) + (Network Buffer) + (Supervisor Poll Interval)

Example:
  Agent SLA        = 30s
  Max Retries      = 3
  Network Buffer   = 10s
  Supervisor Poll  = 60s
  ─────────────────────────
  Timeout ≈ 180s (3 min)
```

- Too short → false positives, supervisor triggers unnecessary compensation.
- Too long → delayed recovery from real failures.

### 7.3 Idempotency Strategies for Agents

| Technique | How |
|---|---|
| **Idempotency Keys** | Pass `workflow_id + step_id` as idempotency key to external API |
| **Check-before-act** | Query if action already completed; skip if so |
| **Database Upserts** | Use `INSERT ... ON CONFLICT DO NOTHING` |
| **Conditional API Calls** | Use ETags / `If-None-Match` headers |

---

## 8. Real-World Systems & Applications

### 8.1 Uber — Trip Lifecycle Management

**Problem:** A trip creation involves: driver matching, fare estimation, payment pre-auth, ETA notification — across separate microservices.

**How SAS is applied:**
- Scheduler coordinates trip state machine: `REQUESTED → MATCHED → PAYMENT_PREAUTH → ACTIVE`.
- Each step is an Agent (DispatchAgent, PaymentAgent, NotificationAgent).
- Supervisor detects orphaned trips (e.g., scheduler pod crashed mid-matching) and either resumes or cancels and refunds.
- State is persisted in a distributed DB; heartbeats prevent zombie trips.

---

### 8.2 Stripe — Payment Orchestration

**Problem:** A single charge may involve: fraud scoring, card network authorization, ledger entry, webhook dispatch — some of which are external and may fail.

**How SAS is applied:**
- Each payment is a workflow managed by a scheduler with step-level state.
- Agents call Visa/Mastercard networks (external, unreliable).
- If the payment network times out, the Supervisor detects the stall and either retries or initiates a void/reversal (compensation).
- Idempotency keys prevent double charges on retry.
- Full step-level audit log stored for regulatory compliance.

---

### 8.3 Airbnb — Booking Workflow

**Problem:** Booking involves: hold inventory, charge guest, pay host, send confirmations, update calendar — failure of any step must be reversed.

**How SAS is applied:**
- Scheduler drives the booking state machine.
- `InventoryAgent` places a temporary hold; `PaymentAgent` charges the guest.
- If `PaymentAgent` permanently fails → Supervisor triggers `InventoryAgent.compensate()` to release the hold.
- Supervisor polls for bookings stuck in `RUNNING` state beyond SLA.

---

### 8.4 Netflix — Content Encoding Pipeline

**Problem:** Ingesting a video involves: transcoding to multiple resolutions, generating thumbnails, updating metadata, CDN warming — a long-running, multi-step pipeline.

**How SAS is applied:**
- Each encoding job is a Scheduler-managed workflow.
- Agents represent individual encoding tasks (480p, 720p, 4K, HDR variants).
- Supervisor detects failed or hung encoding workers (common on spot instances) and reassigns work.
- Completed steps are checkpointed; only failed steps are retried, not the entire pipeline.

---

### 8.5 Amazon — Order Fulfillment

**Problem:** An order spans: payment capture, warehouse pick, carrier booking, tracking setup, customer notification — across dozens of internal services.

**How SAS is applied:**
- AWS Step Functions (a managed implementation of this pattern) orchestrates order workflows.
- Each Lambda or ECS task is an Agent.
- Step Functions state machine handles retries, timeouts, and error routing.
- Supervisor role is built into Step Functions runtime (CloudWatch Events + state machine error handlers).

---

### 8.6 GitHub Actions — CI/CD Pipeline Execution

**Problem:** A workflow run involves many jobs across multiple runners; a runner may crash mid-job.

**How SAS is applied:**
- The Actions scheduler tracks job state per workflow run.
- Each runner is an Agent executing a discrete job.
- Supervisor monitors runner heartbeats; on timeout, marks job as failed and re-queues if configured.
- Workflow state is stored centrally; the UI reflects live step-level status.

---

## 9. Anti-Patterns to Avoid

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Non-idempotent agents** | Retries cause duplicate charges, double bookings | Always design agents with idempotency keys |
| **In-memory scheduler state** | Crash loses all progress | Persist state to durable store before every state transition |
| **Single supervisor** | Supervisor becomes SPOF | Run multiple supervisor instances with distributed locking |
| **Ignoring compensation failures** | Compensation itself can fail, leaving inconsistent state | Persist compensation state; retry compensations with alerting |
| **Missing heartbeat mechanism** | Supervisor cannot distinguish slow vs crashed schedulers | Always write heartbeat on every step start |
| **Supervisor too aggressive** | Cancels workflows that are merely slow | Tune timeout thresholds carefully; add jitter |
| **Overly coarse agents** | Hard to retry or compensate partial work | Each agent should encapsulate the smallest safe atomic action |

---

## 10. Monitoring & Observability

### Key Metrics

| Metric | What to Track |
|---|---|
| `workflow.duration_ms` | End-to-end time per workflow type |
| `workflow.step.failure_rate` | Failure rate per agent/step |
| `workflow.stalled_count` | Number of workflows detected stalled by supervisor |
| `workflow.compensation_rate` | How often compensation is triggered (high = systemic failures) |
| `supervisor.scan_latency_ms` | Time for supervisor to detect and act on stalls |
| `agent.retry_count` | Retries per agent (high = instability in downstream service) |

### Alerts

```yaml
alert: WorkflowStalledHigh
  condition: workflow.stalled_count > 50 (5 min window)
  severity: page
  action: Investigate supervisor health and downstream agent SLAs

alert: CompensationRateSpike
  condition: workflow.compensation_rate > 5%
  severity: warning
  action: Check downstream service error rates and agent failure logs

alert: SupervisorLagHigh
  condition: supervisor.scan_latency_ms > 2 × TIMEOUT_THRESHOLD
  severity: critical
  action: Supervisor is not catching stalled workflows in time
```

---

## 11. Relationship to Other Patterns

| Pattern | Relationship |
|---|---|
| **Saga** | SAS is one implementation strategy for Sagas; adds explicit Supervisor role |
| **Competing Consumers** | Agents can be implemented as competing consumers of a task queue |
| **Retry** | SAS wraps retry logic at the workflow level with state persistence |
| **Compensating Transaction** | Core mechanism SAS uses for rollback |
| **Leader Election** | Used to elect a single active Supervisor among multiple instances |
| **Queue-Based Load Leveling** | Task queues decouple scheduler from agents for async dispatch |
| **Circuit Breaker** | Agents should use circuit breakers to prevent cascading into failing external services |

---

## 12. Decision Framework

```
Is your operation a single step or fast synchronous call?
    └── YES → Skip SAS; use simple request/response

Does your workflow span multiple remote services?
    └── NO  → Use a local transaction
    └── YES ▼

Can all steps be wrapped in a distributed transaction (2PC)?
    └── YES → Use 2PC (rare; high cost; avoid at scale)
    └── NO  ▼

Do you need rollback capability on failure?
    └── NO  → Use Pipes & Filters or simple message chaining
    └── YES ▼

Can you design all steps to be idempotent and compensatable?
    └── NO  → Reconsider step boundaries; some steps may need to be truly atomic
    └── YES ▼

Is the workflow long-running (seconds to minutes)?
    └── NO  → Saga with choreography may be simpler
    └── YES → USE SCHEDULING AGENT SUPERVISOR
                  ├── State Store: PostgreSQL (default) / DynamoDB (high scale)
                  ├── Agents: Idempotent, single-responsibility
                  ├── Supervisor: Timer-based, distributed lock, configurable timeout
                  └── Managed: Consider AWS Step Functions / Azure Durable Functions
```