# Background Jobs: Returning Results

---

## Overview

Background jobs are tasks executed **asynchronously**, outside the request-response cycle. Since the client doesn't wait for completion, a core challenge is: **how does the result get back to the requester?**

Choosing the right result-return strategy is a fundamental system design decision that affects latency, complexity, scalability, and user experience.

---

## Core Strategies

### 1. Polling

The client **periodically queries** a status endpoint until the job is done.

**How it works:**
- Client submits a job and receives a `job_id`
- Client repeatedly calls `GET /jobs/{job_id}/status`
- When status = `COMPLETE`, client fetches the result

**Flow:**
```
Client → POST /jobs         → { job_id: "abc123" }
Client → GET /jobs/abc123   → { status: "PENDING" }
Client → GET /jobs/abc123   → { status: "RUNNING" }
Client → GET /jobs/abc123   → { status: "DONE", result: {...} }
```

**Best for:** Simple implementations, clients that can tolerate latency, REST-native APIs.

---

### 2. Webhooks / Callbacks

The server **pushes the result** to a pre-registered URL when the job completes.

**How it works:**
- Client submits a job with a `callback_url`
- Server processes the job and POSTs the result to that URL

**Flow:**
```
Client → POST /jobs { callback_url: "https://client.com/hook" }
          ... job runs ...
Server → POST https://client.com/hook { result: {...} }
```

**Best for:** Server-to-server communication, event-driven architectures, avoiding polling overhead.

---

### 3. WebSockets / Server-Sent Events (SSE)

The server **streams updates** to the client over a persistent connection.

- **WebSocket:** Full-duplex, bidirectional
- **SSE:** Unidirectional (server → client), simpler, HTTP-native

**Best for:** Real-time UIs, streaming progress bars, live dashboards.

---

### 4. Message Queue / Pub-Sub Result Channel

Results are published to a **message queue or topic** that the client or downstream service subscribes to.

**How it works:**
- Worker publishes result to a queue (e.g., Redis, Kafka, SQS)
- Client or another service consumes from that queue

**Best for:** Microservice pipelines, fan-out scenarios, decoupled architectures.

---

### 5. Result Store (Fetch-on-Demand)

Results are written to **persistent storage** (DB, object store, cache) and the client retrieves them at its own pace.

**How it works:**
- Worker writes result to S3, a database, or Redis
- Client receives a reference (URL or key) and fetches when ready

**Best for:** Large results (files, reports), long-running jobs, audit-trail requirements.

---

## Comparison Table

| Strategy        | Latency       | Server Load     | Client Complexity | Push or Pull | Best Scale   |
|----------------|---------------|-----------------|-------------------|--------------|--------------|
| Polling         | Medium-High   | High (chatty)   | Low               | Pull         | Small-Medium |
| Webhooks        | Low           | Low             | Medium            | Push         | Medium-Large |
| WebSockets/SSE  | Very Low      | Medium-High     | Medium            | Push         | Medium       |
| Message Queue   | Low           | Low             | Medium-High       | Pull/Push    | Large        |
| Result Store    | Variable      | Low             | Low               | Pull         | Any          |

---

## Trade-offs

### Polling

| Pros | Cons |
|------|------|
| Simple to implement | Wastes bandwidth with repeated requests |
| Stateless, easy to scale | High latency before result is noticed |
| Works with any HTTP client | Server load from "thundering herds" |
| No persistent connections needed | Inefficient for long or uncertain job durations |

**Design concern:** Use **exponential backoff** for polling intervals. Too short = server overload. Too long = poor UX.

---

### Webhooks

| Pros | Cons |
|------|------|
| Low latency, push-based | Client must expose a public URL |
| No wasted requests | Requires retry logic for failed deliveries |
| Decouples client from server timing | Hard to debug and test locally |
| Scales well for async pipelines | Security concerns — HMAC signature validation required |

**Design concern:** Always implement **idempotent webhook handlers** — delivery is at-least-once, so duplicate events will occur.

---

### WebSockets / SSE

| Pros | Cons |
|------|------|
| Real-time UX | Persistent connections consume server resources |
| Supports streaming progress | Load balancers need sticky sessions or pub-sub relay |
| SSE is HTTP-native, easy to proxy | Overkill for simple one-shot jobs |
| WebSockets support bidirectional flow | Reconnection logic adds client complexity |

**Design concern:** At scale, use a **shared pub-sub layer** (Redis Pub/Sub, Kafka) so any server node can push to any connected client.

---

### Message Queue

| Pros | Cons |
|------|------|
| Highly decoupled | Added infrastructure complexity |
| Durable and replayable | Debugging message flow is harder |
| Natural backpressure | Requires consumer management |
| Scales to very high throughput | Ordering guarantees vary by queue type |

**Design concern:** Define **dead-letter queues (DLQs)** for jobs that fail after retries to avoid silent data loss.

---

### Result Store

| Pros | Cons |
|------|------|
| Simple and decoupled | Client must know when to fetch |
| Handles large payloads well | Stale results if TTL not managed |
| Natural audit trail | Storage costs at scale |
| No connection management | Requires a notification mechanism to trigger fetch |

**Design concern:** Set appropriate **TTL (Time to Live)** on stored results to avoid unbounded storage growth.

---

## Key Design Considerations

### Job ID & Status Tracking
- Every background job needs a **globally unique ID** (UUID or ULID)
- Persist job state transitions: `PENDING → RUNNING → SUCCESS / FAILED`
- Store metadata: creation time, start time, completion time, retry count

### Idempotency
- Workers should be **idempotent** — re-running the same job produces the same result
- Use job IDs as idempotency keys when writing results

### Failure Handling
- Define **retry policies** with backoff (immediate, linear, exponential)
- Set a **max retry limit** before marking as `PERMANENTLY_FAILED`
- Route failed jobs to a **Dead Letter Queue (DLQ)** for inspection

### Result Expiry
- Results should not be stored indefinitely
- Use TTL-based expiry in Redis or S3 lifecycle policies
- Notify clients before expiry if the result window is long

### Security
- Authenticate result retrieval — only the job owner should fetch results
- Sign webhook payloads with **HMAC-SHA256** to verify origin
- Use **pre-signed URLs** for large file results in object storage

### Observability
- Emit metrics: job queue depth, processing time, failure rate
- Trace job lifecycle from submission to result delivery
- Alert on DLQ growth or stalled jobs

---

## Real-World Systems & Applications

### GitHub Actions / GitLab CI
- **Strategy:** Polling + WebSocket streaming
- Job is submitted on push. UI polls for status and streams logs in real-time via WebSocket. Final result is stored and accessible via the API.

### AWS S3 Batch Operations
- **Strategy:** Result Store + SNS Notification
- Large-scale S3 jobs write a completion manifest to S3. SNS publishes a notification to trigger downstream consumers.

### Stripe
- **Strategy:** Webhooks
- Payment processing is asynchronous. Stripe POSTs events (`charge.succeeded`, `payment_intent.failed`) to merchant callback URLs with HMAC signatures and exponential retry backoff.

### OpenAI Batch API
- **Strategy:** Polling + Result Store
- Client submits a batch and polls `/batches/{id}`. When complete, results are written to a file downloadable via the Files API.

### Twilio (SMS / Voice)
- **Strategy:** Webhooks
- After processing a call or SMS, Twilio POSTs a status callback to a developer URL with delivery receipts and call logs.

### Google BigQuery Jobs
- **Strategy:** Polling + Pub/Sub notifications
- Long-running query jobs expose a status endpoint. Completion events can also be published to a Pub/Sub topic for downstream orchestration.

### Netflix Encoding Pipeline
- **Strategy:** Message Queue (Kafka)
- Video encoding jobs publish results to Kafka topics. Downstream microservices (thumbnail generation, CDN upload, catalog update) consume independently.

### Slack / Discord File Processing
- **Strategy:** WebSockets + Result Store
- File uploads trigger background processing (virus scan, thumbnail generation). Progress and completion are pushed to clients over WebSocket connections.

---

## Architecture Pattern: Hybrid Approach

For production systems, strategies are often **combined**:

```
Client
  │
  ├─── POST /jobs ──────────────────────► Job Queue (SQS / Redis)
  │         returns { job_id }                   │
  │                                         Worker Pool
  │                                              │
  ├─── WebSocket (live progress) ◄──────── Redis Pub/Sub
  │                                              │
  ├─── GET /jobs/{id} (polling fallback) ◄── Job Status DB
  │                                              │
  └─── Webhook callback ◄──────────────── Result written to S3
```

Use WebSockets for real-time UX, polling as a fallback, webhooks for server-to-server, and object storage for large results.

---

## Summary

| If you need...                        | Use...                        |
|--------------------------------------|-------------------------------|
| Simplicity, REST-only client          | Polling                       |
| Real-time user feedback               | WebSockets / SSE              |
| Server-to-server async events         | Webhooks                      |
| Decoupled microservice pipelines      | Message Queue                 |
| Large files or long-lived results     | Result Store                  |
| Maximum reliability + real-time UX   | Hybrid (Queue + WS + Store)  |