# Async Request Reply Pattern

## 1. Overview

The **Async Request Reply** pattern decouples a client's request from the backend's response when synchronous processing is not feasible — typically because the work takes too long to complete within a single HTTP connection's timeout window.

Instead of holding the connection open and blocking, the backend immediately acknowledges receipt of the request and returns a **polling endpoint** (or callback mechanism). The client periodically checks that endpoint until the result is ready.

---

## 2. Problem It Solves

Modern HTTP infrastructure — load balancers, API gateways, proxies — imposes connection timeouts (typically 30s–120s). Long-running operations (ML inference, report generation, video encoding, document processing) exceed these limits.

**Without this pattern:**
- Client times out waiting for response.
- Backend may still be running, producing orphaned work.
- No way to retrieve results after disconnection.
- Retry logic causes duplicate work.

**With this pattern:**
- Client gets an immediate `202 Accepted` with a status URL.
- Backend processes asynchronously.
- Client polls or receives a callback when done.
- Work and result retrieval are fully decoupled.

---

## 3. How It Works

```
Client                  API Gateway / Frontend         Backend Worker          Status Store
  |                            |                              |                      |
  |-- POST /jobs ------------> |                              |                      |
  |                            |-- enqueue job -------------> |                      |
  |                            |-- create status record ----> |                      |
  | <-- 202 Accepted --------- |                              |                      |
  |     Location: /jobs/abc123 |                              |                      |
  |                            |                    (processing...)                  |
  |-- GET /jobs/abc123 ------> |                              |                      |
  |                            |-- read status -------------> |                      |
  | <-- 200 {status: pending}--|                              |                      |
  |                            |                              |-- done, write result->|
  |-- GET /jobs/abc123 ------> |                              |                      |
  |                            |-- read status -------------> |                      |
  | <-- 200 {status: complete, result: ...} ----------------> |                      |
```

### Step-by-Step Flow

1. **Client** sends `POST /jobs` with request payload.
2. **API** validates, enqueues the job, creates a status record (e.g., `PENDING`), returns `202 Accepted` with `Location: /jobs/{jobId}`.
3. **Worker** picks up the job from the queue, processes it, updates the status to `COMPLETE` and stores the result.
4. **Client** polls `GET /jobs/{jobId}` at intervals.
5. **API** reads the status store and returns the current status.
6. Once `COMPLETE`, client retrieves the result from the response body or a `result_url`.

---

## 4. Response Status Conventions

| HTTP Code | Meaning |
|-----------|---------|
| `202 Accepted` | Request received and queued; processing not yet started or ongoing |
| `200 OK` (on poll) | Status successfully retrieved (not necessarily complete) |
| `303 See Other` | Job complete; redirect to result resource |
| `404 Not Found` | Job ID not recognized |
| `410 Gone` | Result expired and no longer available |

### Polling Response Body Pattern (JSON)

```json
{
  "jobId": "abc123",
  "status": "processing",          // pending | processing | complete | failed
  "progress": 45,                  // optional, percent
  "estimatedCompletionTime": "...", // optional hint
  "links": {
    "self": "/jobs/abc123",
    "cancel": "/jobs/abc123/cancel"
  }
}
```

When complete:

```json
{
  "jobId": "abc123",
  "status": "complete",
  "result": { ... },               // inline result OR
  "resultUrl": "/results/abc123",  // redirect to result
  "expiresAt": "2025-01-01T00:00:00Z"
}
```

---

## 5. Polling Strategies

### 5.1 Fixed Interval Polling

```
Client polls every N seconds regardless of expected duration.
```

- Simple to implement.
- Inefficient — wastes requests when job will take minutes.

### 5.2 Exponential Backoff Polling

```
Poll at: 1s → 2s → 4s → 8s → 16s → ... → max cap
```

- Reduces server load for long jobs.
- Recommended as a default.

### 5.3 Server-Sent Events (SSE) / WebSocket Push

- Server pushes status updates to the client.
- Eliminates polling entirely.
- Higher infrastructure complexity.
- Best for UIs where real-time feedback matters.

### 5.4 Webhook / Callback

- Client registers a callback URL at submission time.
- Server `POST`s result to callback when done.
- Best for server-to-server integrations.

```json
POST /jobs
{
  "payload": { ... },
  "callbackUrl": "https://client.example.com/webhooks/job-done"
}
```

---

## 6. Architecture Components

```
┌─────────────┐     POST /jobs      ┌─────────────────┐
│             │ ─────────────────>  │                 │
│   Client    │  202 + Location     │   API Gateway   │
│             │ <─────────────────  │   / Frontend    │
│             │                     │    Service      │
│             │  GET /jobs/{id}     │                 │
│             │ ─────────────────>  │                 │
│             │  {status, result}   │                 │
│             │ <─────────────────  └────────┬────────┘
└─────────────┘                              │ enqueue
                                             ▼
                                   ┌─────────────────┐
                                   │   Message Queue  │
                                   │  (SQS, RabbitMQ) │
                                   └────────┬─────────┘
                                            │ consume
                                            ▼
                                   ┌─────────────────┐
                                   │  Worker Pool     │
                                   │  (auto-scaled)   │
                                   └────────┬─────────┘
                                            │ write result
                                            ▼
                                   ┌─────────────────┐
                                   │  Status Store    │
                                   │ (Redis / DynamoDB│
                                   │ / PostgreSQL)    │
                                   └─────────────────┘
```

### Key Components

| Component | Role | Technology Options |
|-----------|------|--------------------|
| **API / Frontend Service** | Accepts requests, returns 202, serves status | Express, FastAPI, Spring Boot |
| **Message Queue** | Buffers work between API and workers | SQS, RabbitMQ, Kafka, Azure Service Bus |
| **Worker Pool** | Consumes queue, executes job, writes result | Celery, Sidekiq, Lambda, custom consumers |
| **Status Store** | Tracks job state and result | Redis, DynamoDB, PostgreSQL, Cosmos DB |
| **Result Store** | Stores large results separately | S3, Blob Storage, GCS |

---

## 7. Implementation Examples

### 7.1 Node.js — Submit Job (Express)

```javascript
// POST /jobs — accept and queue
app.post('/jobs', async (req, res) => {
  const jobId = uuid();

  await statusStore.set(jobId, { status: 'pending', createdAt: Date.now() });
  await queue.send({ jobId, payload: req.body });

  res.status(202).json({
    jobId,
    links: { status: `/jobs/${jobId}` }
  });
});

// GET /jobs/:id — poll status
app.get('/jobs/:id', async (req, res) => {
  const job = await statusStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.status(200).json(job);
});
```

### 7.2 Python — Worker (Celery)

```python
from celery import Celery
import redis

app = Celery('jobs', broker='redis://localhost:6379/0')
store = redis.Redis()

@app.task
def process_job(job_id: str, payload: dict):
    store.hset(job_id, 'status', 'processing')

    result = run_heavy_computation(payload)

    store.hmset(job_id, {
        'status': 'complete',
        'result': json.dumps(result),
        'completedAt': time.time()
    })
```

### 7.3 Python — Client Polling with Backoff

```python
import time, requests

def poll_job(job_id: str, base_url: str, max_wait=300):
    delay = 1
    elapsed = 0
    while elapsed < max_wait:
        resp = requests.get(f"{base_url}/jobs/{job_id}")
        data = resp.json()

        if data['status'] == 'complete':
            return data['result']
        elif data['status'] == 'failed':
            raise Exception(data.get('error'))

        time.sleep(delay)
        elapsed += delay
        delay = min(delay * 2, 30)  # cap at 30s

    raise TimeoutError("Job did not complete in time")
```

### 7.4 Azure Durable Functions Pattern (HTTP-triggered)

```csharp
[FunctionName("StartLongTask")]
public static async Task<HttpResponseMessage> HttpStart(
    [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestMessage req,
    [DurableClient] IDurableOrchestrationClient starter)
{
    string instanceId = await starter.StartNewAsync("LongRunningOrchestration", null);

    // Returns 202 with status endpoint automatically
    return starter.CreateCheckStatusResponse(req, instanceId);
}
```

---

## 8. Trade-offs

### 8.1 Advantages

| Advantage | Description |
|-----------|-------------|
| **Decoupling** | Client and backend lifecycles are independent |
| **Resilience** | Backend restarts don't lose client context; client retries polling |
| **Scalability** | Workers scale independently of the API layer |
| **Timeout elimination** | No HTTP timeouts on long-running operations |
| **Visibility** | Progress and status can be communicated during processing |
| **Retry safety** | Idempotent job submission prevents duplicate work |

### 8.2 Disadvantages

| Disadvantage | Description |
|--------------|-------------|
| **Client complexity** | Client must implement polling loop, backoff, and timeout handling |
| **Polling overhead** | Frequent polls waste bandwidth and add load; mitigated by backoff |
| **Latency perception** | UX feels slower without real-time feedback |
| **State management** | Status store adds a new persistence dependency |
| **Result expiry** | Results must be cleaned up; clients can miss results if they expire |
| **Operational overhead** | Queue + worker + status store = more infrastructure to manage |

### 8.3 When to Use vs. Avoid

| Use When | Avoid When |
|----------|------------|
| Jobs take > 10–30 seconds | Response can be returned in < 5 seconds |
| Work is CPU/IO intensive | Latency is the primary concern |
| Client can tolerate polling | Real-time streaming is required |
| Server-to-server integrations | Simple CRUD operations |
| Batch processing pipelines | WebSocket/SSE is already available |

---

## 9. Design Considerations

### 9.1 Idempotency at Submission

- Clients should include a **client-generated idempotency key** in the request.
- If the same key is submitted twice, return the existing job, not a new one.
- Prevents duplicate work on network retries.

```http
POST /jobs
Idempotency-Key: client-uuid-xyz
```

### 9.2 Job Expiry and TTL

- Set a **TTL on job records** and results (e.g., 24 hours after completion).
- Return `410 Gone` for expired jobs.
- Use Redis TTL or DynamoDB TTL for automatic cleanup.

### 9.3 Cancellation

- Expose `DELETE /jobs/{id}` or `POST /jobs/{id}/cancel`.
- Worker checks for cancellation signal before / during processing.
- Update status to `cancelled`.

### 9.4 Retry and Dead Letter Queue

- Workers should retry on transient failures (with backoff).
- After N retries, move message to a **Dead Letter Queue (DLQ)**.
- Update job status to `failed` with error detail.
- Alert/monitor DLQ depth as a health signal.

### 9.5 Security

- Job IDs must be **unguessable** (UUID v4 or cryptographically random).
- Validate that the polling client owns the job (authorization check on `GET /jobs/{id}`).
- Avoid leaking internal error details in failed job responses.

### 9.6 Progress Reporting (Optional)

```json
{
  "status": "processing",
  "progress": {
    "percent": 62,
    "stage": "encoding",
    "message": "Encoding video — pass 2 of 2"
  }
}
```

Worker writes progress updates to the status store during processing.

---

## 10. Real-World Systems & Applications

### 10.1 GitHub Actions / CI-CD Pipelines

- `POST` a push event triggers a workflow run.
- GitHub returns a run ID immediately.
- Client polls `/repos/{owner}/{repo}/actions/runs/{run_id}` for status.
- Logs stream separately; completion triggers webhooks.

### 10.2 AWS Textract (Document Processing)

- Synchronous API: returns inline for small documents.
- Asynchronous API: `StartDocumentAnalysis` returns a `JobId`.
- Client polls `GetDocumentAnalysis` until `JobStatus: SUCCEEDED`.
- SNS notification can replace polling for server-to-server use.

### 10.3 OpenAI Batch API

- Submit a batch of inference requests → receive a `batch_id`.
- Poll `GET /v1/batches/{batch_id}` for `status: completed`.
- Retrieve results via output file ID once complete.
- Cost is ~50% of synchronous calls — suited for non-latency-sensitive workloads.

### 10.4 Stripe Payouts / Bank Transfers

- Initiating a payout returns immediately with a `Transfer` object ID.
- Status transitions: `pending → in_transit → paid`.
- Clients poll the Transfer object or receive webhook events on state changes.

### 10.5 Google Cloud Video Intelligence API

- Submit video for analysis → job ID returned immediately.
- Poll `projects.locations.operations.get` endpoint.
- Supports `done: true/false` with result embedded when done.

### 10.6 Netflix Encoding Pipeline

- Video upload triggers an async transcoding job across multiple resolution profiles.
- Job tracker records per-profile progress.
- Encoding service updates status store (Cassandra-backed).
- Content becomes available progressively as profiles complete.

### 10.7 Shopify / E-commerce Bulk Operations

- Bulk product imports, order exports triggered via async job API.
- `POST /admin/api/graphql.json` with bulk operation mutation.
- Poll `currentBulkOperation` query for status.
- Completed bulk operations return a `url` to download results from GCS.

### 10.8 Uber — Surge Pricing Computation

- Pricing recalculation for a region is a heavy computation job.
- Price API returns estimated fare immediately (cached); recalculation dispatched async.
- Status store updated when new pricing is committed.

---

## 11. Comparison with Related Patterns

| Pattern | Communication | Client Waits? | Best For |
|---------|--------------|---------------|----------|
| **Sync Request/Reply** | HTTP (request-response) | Yes, blocking | Fast ops (< 5s) |
| **Async Request Reply** | HTTP + poll/callback | No (polls) | Long ops (> 30s) |
| **Event-Driven** | Message bus | No (fire-and-forget) | Decoupled pipelines |
| **Publish/Subscribe** | Message bus (fanout) | No | Notifications, fanout |
| **Streaming (SSE/WS)** | Persistent connection | No (pushed) | Real-time progress |
| **Saga** | Choreography/orchestration | No | Distributed transactions |

---

## 12. Interview Cheat Sheet

```
TRIGGER QUESTION:
  "Design a system where [long operation] needs to be performed on user request."
  Examples: video transcoding, ML model training, bulk CSV export, report generation.

CORE IDEA:
  - POST /jobs → 202 + jobId
  - Worker processes asynchronously
  - GET /jobs/{id} → polls status
  - 200 {complete, result} when done

KEY COMPONENTS:
  API → Queue → Workers → Status Store → Result Store (if large)

POLLING STRATEGY:
  Default: exponential backoff (1s → 2s → 4s → ... → 30s cap)
  Better UX: SSE or WebSocket push
  Server-to-server: webhook callback

EDGE CASES TO MENTION:
  - Idempotency keys on submission (prevent duplicates on retry)
  - Job expiry / TTL on status records (return 410 Gone)
  - Dead Letter Queue for failed jobs
  - Authorization: caller must own the job
  - Cancellation endpoint

SCALE DECISIONS:
  - Scale workers on queue depth, not CPU
  - Use Redis for hot status reads (low latency polling)
  - Use DynamoDB / Cosmos for durable job history at scale
  - Stream large results to S3/GCS, return pre-signed URL

TRADE-OFF SUMMARY:
  + Resilient to timeouts and restarts
  + Scales workers independently
  - Client complexity (polling loop)
  - More infrastructure (queue + store)
```

---

## 13. Related Patterns

- **Queue-Based Load Leveling** — the queue that buffers work in this pattern
- **Competing Consumers** — the worker pool that drains the queue
- **Claim Check** — offload large payloads to blob store, pass reference through queue
- **Scheduler Agent Supervisor** — coordinates long-running distributed workflows
- **Retry / Circuit Breaker** — client-side resilience when polling fails
- **Saga** — when the async job spans multiple services requiring rollback
