# Idempotent Operations

## 1. What Are Idempotent Operations?

An operation is **idempotent** if performing it multiple times produces the same result as performing it once. Formally:

```
f(f(x)) = f(x)
```

In distributed systems, idempotency is a correctness guarantee — it means a client can safely **retry** an operation without fear of unintended side effects, even if they cannot determine whether a prior attempt succeeded.

**Core principle:**  
> "Do it once or do it a hundred times — the outcome is the same."

---

## 2. Why Idempotency Matters in Distributed Systems

Distributed systems are inherently unreliable. Networks drop packets, services crash mid-request, and timeouts occur constantly. This creates a fundamental ambiguity:

```
Client → sends request → ???
          network drops
          service crashes
          response lost
```

The client is left asking: *did the operation succeed, partially succeed, or not execute at all?*

Without idempotency, the only safe answer is **"don't retry"** — which leads to data loss or degraded reliability. With idempotency, the safe answer is always **"retry freely"**.

### The Retry Problem
```
Non-idempotent: POST /charge $100
  - Retry 1: $100 charged ✓
  - Retry 2: $200 charged ✗ (double charge)

Idempotent:    POST /charge $100 (idempotency-key: abc-123)
  - Retry 1: $100 charged ✓
  - Retry 2: returns same result, no double charge ✓
```

---

## 3. Idempotency by HTTP Method

| Method   | Idempotent? | Safe? | Notes                                             |
|----------|-------------|-------|---------------------------------------------------|
| GET      | ✅ Yes       | ✅ Yes | Read-only; repeating has no side effects          |
| HEAD     | ✅ Yes       | ✅ Yes | Same as GET, no body                              |
| PUT      | ✅ Yes       | ❌ No  | Replaces resource entirely; same result each time |
| DELETE   | ✅ Yes       | ❌ No  | First call deletes; subsequent calls return 404   |
| OPTIONS  | ✅ Yes       | ✅ Yes | Metadata only                                     |
| POST     | ❌ No*       | ❌ No  | Creates new resource each call unless designed otherwise |
| PATCH    | ❌ No*       | ❌ No  | Partial updates; depends on implementation        |

> *POST and PATCH **can** be made idempotent via idempotency keys.

---

## 4. Core Mechanisms for Achieving Idempotency

### 4.1 Idempotency Keys
The client generates a unique key per logical operation and sends it with every retry. The server stores the result of the first execution and replays it for duplicates.

```
POST /v1/payments
Headers:
  Idempotency-Key: a84f3b12-9e2c-4d11-8f0a-1234abcd5678

Body:
  { "amount": 100, "currency": "USD", "to": "user_456" }
```

**Server-side flow:**
```
1. Receive request with idempotency key
2. Check key in store (Redis/DB)
   - If found AND completed → return cached response
   - If found AND in-progress → return 409 Conflict or wait
   - If not found → execute operation, store result, return response
```

**Key storage schema:**
```sql
CREATE TABLE idempotency_keys (
  key          VARCHAR(255) PRIMARY KEY,
  request_hash VARCHAR(64),        -- detect mismatched payloads
  response     JSONB,
  status       ENUM('processing', 'completed', 'failed'),
  expires_at   TIMESTAMP,
  created_at   TIMESTAMP
);
```

### 4.2 Natural Idempotency via Resource Identity
Design APIs so operations are naturally idempotent using resource-centric PUT semantics:

```
# Non-idempotent
POST /cart/items       → adds a new item each call

# Idempotent
PUT /cart/items/sku-789 → sets quantity to 2, always
```

### 4.3 Conditional Writes (Compare-and-Swap)
Use version numbers or ETags to make writes idempotent at the data layer:

```
PUT /orders/order-123
Headers:
  If-Match: "etag-v4"      ← only apply if resource is at this version

→ 200 OK (applied once)
→ 412 Precondition Failed (stale — already applied or conflicting write)
```

### 4.4 Deduplication at the Message Layer
Message queues like Kafka and SQS provide at-least-once delivery. Consumers must be idempotent:

```
Consumer logic:
  1. Receive message with message_id
  2. Check deduplication store: has message_id been processed?
     - Yes → ack and discard
     - No  → process, mark as processed, ack
```

### 4.5 Database-Level Idempotency
Using unique constraints and upserts:

```sql
-- Upsert: idempotent insert
INSERT INTO payments (idempotency_key, amount, user_id)
VALUES ('key-abc', 100, 42)
ON CONFLICT (idempotency_key) DO NOTHING;

-- Or update to same state
ON CONFLICT (idempotency_key)
DO UPDATE SET status = EXCLUDED.status
WHERE payments.status != 'completed';
```

---

## 5. Idempotency Key Design

### Generation Strategy
- **Client-generated UUIDs (v4):** Most common; random, collision-resistant
- **Deterministic/content-based:** `SHA256(user_id + amount + timestamp_bucket)` — allows reconstruction
- **Server-assigned tokens:** Two-phase: acquire token, then submit operation

### Key Scope
```
Too narrow:  Per-field (fragile, complex)
Just right:  Per logical business operation
Too broad:   Per user session (loses deduplication power)
```

### Expiry Policy
```
Short-lived (minutes): Suitable for real-time payment retries
Medium (24–72 hours):  Standard for most API operations
Long-lived (30 days):  Async workflows, batch jobs
Permanent:             Audit trails, financial ledgers
```

### Payload Mismatch Handling
Always hash the request body and compare on retry. If a client sends the same key with a different payload, reject with `422 Unprocessable Entity`:

```
Same key + same payload  → replay cached result ✓
Same key + diff payload  → reject with error ✗
```

---

## 6. Idempotency in Message-Driven Architectures

### At-Least-Once vs Exactly-Once

| Guarantee       | How Achieved                                      | Cost      |
|-----------------|---------------------------------------------------|-----------|
| At-most-once    | Fire and forget; no retry                         | Data loss |
| At-least-once   | Retry until ack; consumer must be idempotent      | Duplicates|
| Exactly-once    | Distributed transaction or idempotent consumer    | High cost |

> True exactly-once is extremely expensive. The industry standard is **at-least-once delivery + idempotent consumers**.

### Kafka Producer Idempotency
Kafka producers can be configured for idempotent delivery within a session:

```properties
enable.idempotence=true
acks=all
retries=Integer.MAX_VALUE
max.in.flight.requests.per.connection=5
```

Each message gets a **Producer ID (PID)** + **sequence number**. The broker deduplicates within a session window.

### Kafka Transactions (Cross-Topic Exactly-Once)
```
producer.initTransactions();
producer.beginTransaction();
  producer.send(record1);
  producer.send(record2);
  producer.sendOffsetsToTransaction(offsets, groupId);
producer.commitTransaction();  // atomic
```

---

## 7. Idempotency Patterns in Distributed Workflows

### 7.1 Saga Pattern
Each step in a saga must have an **idempotent forward action** and an **idempotent compensating transaction**:

```
Step 1: Reserve inventory   → compensate: release inventory
Step 2: Charge payment      → compensate: refund payment
Step 3: Create shipment     → compensate: cancel shipment
```

All steps must be safely retryable if the orchestrator crashes mid-execution.

### 7.2 Outbox Pattern
Ensures a DB write and a message publish are atomically consistent via idempotency:

```
Transaction:
  1. Write order to orders table
  2. Write event to outbox table (same transaction)

Outbox poller:
  3. Read unprocessed outbox events
  4. Publish to message broker (with idempotency key = outbox event ID)
  5. Mark outbox event as published
```

### 7.3 Event Sourcing
Appending events is naturally idempotent when events carry sequence numbers or UUIDs. Replaying the event log always reconstructs the same final state.

---

## 8. Trade-offs

### ✅ Benefits

| Benefit                  | Description                                                   |
|--------------------------|---------------------------------------------------------------|
| Safe retries             | Clients can retry freely without risk of double-execution     |
| Fault tolerance          | Systems recover gracefully from partial failures              |
| Simplified client logic  | Clients don't need to track whether a request succeeded       |
| Easier debugging         | Idempotent replays simplify incident investigation            |
| Enables at-least-once    | Unlocks simpler, cheaper messaging guarantees                 |

### ❌ Costs & Challenges

| Challenge                      | Details                                                                 |
|--------------------------------|-------------------------------------------------------------------------|
| Storage overhead               | Idempotency keys must be persisted and indexed                         |
| TTL management complexity      | Choosing key expiry requires domain knowledge                           |
| Cross-service idempotency      | Hard to guarantee when an operation spans multiple systems              |
| In-flight deduplication        | Need to handle concurrent requests with the same key (locking/fencing) |
| State machine complexity       | Long-running workflows require tracking per-step idempotency            |
| Cache invalidation timing      | Prematurely expired keys can re-enable duplicate execution              |
| Non-idempotent dependencies    | If a downstream call is not idempotent, you can't make yours idempotent |

### Design Tension: Idempotency vs Freshness
```
Strong idempotency:  Return cached result for N hours
  → Safe but may return stale data to caller

Weak idempotency:   Only deduplicate within a short window
  → Less stale but narrows protection window
```

---

## 9. Concurrency and Race Conditions

A subtle problem: two requests with the same idempotency key arrive simultaneously before either has written a result.

### Solution: Distributed Locking / Atomic Check-and-Insert

```
Option A: Redis SET NX (atomic conditional set)
  SET idempotency:{key} "processing" NX EX 30

Option B: DB unique constraint + optimistic locking
  INSERT ... ON CONFLICT DO NOTHING
  → Only one writer wins; others retry or wait

Option C: Advisory locks (PostgreSQL)
  SELECT pg_advisory_xact_lock(hashtext(idempotency_key));
```

State machine for concurrent handling:
```
not_found → [lock] → processing → completed
                              ↘ failed (retryable)
```

---

## 10. Real-World Systems & Applications

### Stripe — Payments API
Stripe is the canonical example of production-grade idempotency:
- Every mutating API call accepts an `Idempotency-Key` header
- Results are cached for **24 hours**
- Mismatched payloads for the same key return `400 Bad Request`
- Concurrent requests with same key return `409 Conflict` until first completes
- Idempotency keys are scoped per API key (not globally)

```
POST /v1/charges
Idempotency-Key: unique-key-per-charge-attempt
```

### AWS S3 — Object Storage
- `PUT object` is idempotent — uploading the same key with same content has no additional effect
- `DELETE object` is idempotent — deleting a non-existent object returns 204 (not 404)
- Strong consistency (since 2020) makes reads after writes idempotent from the client's perspective

### AWS SQS — Message Deduplication
- **FIFO queues** support a `MessageDeduplicationId`
- Deduplication window: **5 minutes**
- Any message with the same deduplication ID within the window is discarded

### Kubernetes — Control Loop (Reconciliation)
The entire Kubernetes architecture is built on idempotency:
- Controllers continuously reconcile **desired state** vs **actual state**
- Applying the same manifest multiple times is a no-op
- `kubectl apply` uses a server-side apply with merge semantics — idempotent by design

```yaml
# Applying this 100 times always results in exactly 3 replicas
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3
```

### Google Spanner — External Consistency
- Uses **commit timestamps** to enforce idempotency across globally distributed writes
- Transactions include a `transaction_id` that the server deduplicates

### Uber — Trip and Payment Processing
- Idempotency keys on all payment operations prevent double-charging on retry storms
- Dispatch operations are idempotent: assigning the same driver twice is a no-op
- Fare calculation is a pure function — idempotent by design

### Netflix — Chaos and Retry Infrastructure
- All inter-service calls are designed to be idempotent to support automatic retries via Hystrix/Resilience4j
- Event pipeline (Kafka consumers) uses offset tracking + dedup IDs to guarantee idempotent processing

### Terraform — Infrastructure as Code
- `terraform apply` is idempotent: running it multiple times converges to the same infrastructure state
- Internally uses a state file + diff engine to only apply changes

### Database Migrations (Flyway / Liquibase)
- Migration scripts are idempotent: each script runs exactly once, tracked by version checksum
- Re-running migrations is a safe no-op

---

## 11. Idempotency in REST API Design — Decision Framework

```
Is the operation a read?
  └─ Yes → Inherently idempotent (GET/HEAD)

Is the operation a full resource replacement?
  └─ Yes → Use PUT (idempotent by spec)

Is the operation a deletion?
  └─ Yes → DELETE is idempotent; treat 404 as success on retry

Is the operation a creation or partial update (POST/PATCH)?
  └─ Can you use a resource-keyed PUT instead?
       ├─ Yes → Prefer PUT
       └─ No  → Add Idempotency-Key header support
                ├─ Store key + response in persistent store
                ├─ Set appropriate TTL
                └─ Handle concurrent same-key requests with locking
```

---

## 12. Anti-Patterns

| Anti-Pattern                          | Problem                                                               | Fix                                              |
|---------------------------------------|-----------------------------------------------------------------------|--------------------------------------------------|
| Ignoring idempotency for POST         | Retries cause duplicate records, double charges                       | Add idempotency key support                      |
| Using time-based IDs as keys          | Same time bucket → collision; different time → missed dedup           | Use UUIDs or content hashes                      |
| Storing keys in-memory only           | Server restart loses key → duplicate execution on retry               | Persist keys to durable storage                  |
| No payload hash check                 | Different payload, same key → silently executes wrong operation       | Hash and validate request body on every call     |
| Over-broad idempotency scope          | "Idempotent user session" deduplicates unrelated operations           | Scope keys to the exact logical operation        |
| Forgetting downstream non-idempotency | Your service is idempotent, but calls a non-idempotent external API   | Wrap external calls in dedup layer or check state first |
| Short TTL on long workflows           | Key expires before workflow retries, enabling re-execution            | Match TTL to workflow SLA, not arbitrary timeout |
| DELETE returning 404 as error         | Client retries delete, gets 404, treats as failure, retries infinitely | Treat 404 on DELETE as success                   |

---

## 13. Monitoring & Observability

### Key Metrics

| Metric                          | What It Tells You                                         |
|---------------------------------|-----------------------------------------------------------|
| Idempotency key hit rate        | How often retries are occurring (operational health)      |
| Duplicate request rate          | Upstream retry behavior; potential client bugs            |
| Key store latency (p99)         | Dedup lookup is in the hot path; must be fast             |
| Concurrent same-key conflicts   | Indicates upstream retry storms or clock issues           |
| Expired key re-executions       | TTL too short; replay attacks possible                    |
| Payload mismatch rejections     | Client bugs or adversarial behavior                       |

### Alerts
- Sudden spike in idempotency key hits → upstream service retry storm
- High concurrent same-key conflicts → distributed lock contention
- Payload mismatch rate > 0 → client implementation bug

---

## 14. Summary

| Dimension               | Key Point                                                               |
|-------------------------|-------------------------------------------------------------------------|
| Definition              | Same input → same output, no matter how many times called              |
| Primary use case        | Safe retries in unreliable distributed systems                          |
| Main mechanism          | Idempotency keys + durable result caching                               |
| HTTP methods            | GET, PUT, DELETE are idempotent; POST/PATCH require explicit design     |
| Message queues          | At-least-once + idempotent consumer = practical exactly-once semantics  |
| Distributed workflows   | Saga, Outbox, and Event Sourcing all depend on idempotency              |
| Biggest risk            | Non-idempotent downstream dependencies                                  |
| Gold standard           | Stripe's payments API, Kubernetes reconciliation loops                  |