# Returning Results from Background Jobs

## The Core Problem

Background jobs execute asynchronously — the caller submits work and moves on immediately. The job runs in a separate process, often on separate infrastructure, with no shared call stack. This means:

- The caller **cannot block and wait** for a result
- There is **no automatic notification** when the job finishes
- Progress and completion must be **explicitly communicated** through a secondary channel

The default posture should always be **fire-and-forget** — design jobs so the caller genuinely doesn't need to know the outcome. When a result *is* required, pick the mechanism that matches the caller's nature and latency tolerance.

---

## Mechanism Comparison

| Mechanism | Caller Type | Latency Tolerance | Complexity | Best For |
|---|---|---|---|---|
| **Polling (status endpoint)** | HTTP client, browser | Seconds to minutes | Low | Public APIs, external clients |
| **Reply queue** | Internal service | Seconds to minutes | Medium | Service-to-service async |
| **Webhook / callback** | External system | Variable | Medium | Third-party integrations |
| **Server-Sent Events (SSE)** | Browser | Near real-time | Medium | Real-time UX progress |
| **WebSockets** | Browser / native app | Near real-time | High | Bidirectional, live updates |
| **Shared storage** | Any | Minutes | Low | Batch results, large payloads |
| **Push notification** | Mobile / browser | Near real-time | Medium | Mobile apps, background sync |

---

## 1. Polling (Async Request-Reply)

The caller submits a job and receives a **job ID + status URL** immediately. It then polls that URL on an interval until the job is complete.

```
Client  →  POST /jobs           →  202 Accepted
                                   { "jobId": "job_abc123", "statusUrl": "/jobs/job_abc123" }

Client  →  GET /jobs/job_abc123  →  { "status": "running", "progress": 40 }
Client  →  GET /jobs/job_abc123  →  { "status": "running", "progress": 80 }
Client  →  GET /jobs/job_abc123  →  { "status": "done", "resultUrl": "/results/job_abc123" }

Client  →  GET /results/job_abc123  →  { ... actual result ... }
```

### Status Schema

Define a consistent status model across all jobs:

```json
{
  "jobId": "job_abc123",
  "status": "running",          // pending | running | done | failed | cancelled
  "progress": 60,               // optional: 0–100
  "message": "Processing row 600 of 1000",
  "createdAt": "2024-11-01T02:00:00Z",
  "updatedAt": "2024-11-01T02:01:30Z",
  "estimatedCompletionAt": "2024-11-01T02:03:00Z",   // optional
  "resultUrl": null,            // populated when status = done
  "error": null                 // populated when status = failed
}
```

### Polling Interval Strategy

Naive fixed-interval polling wastes requests when jobs are long and creates gaps when jobs are short.

**Exponential backoff with cap:**
```
poll at t+1s, t+3s, t+7s, t+15s, t+30s, t+60s, t+60s, ...
                                              ↑ cap — don't poll less frequently than once/min
```

**Adaptive polling using `Retry-After` header:**
```
Server response:  HTTP 202  Retry-After: 30
Client waits 30s before next poll
```

- Server knows job characteristics; it can hint the appropriate wait time
- Reduces unnecessary requests and client-side logic

### `202 Accepted` + `Location` Header (HTTP Standard)

The canonical HTTP pattern for async operations:

```
POST /exports
→ 202 Accepted
   Location: /exports/job_abc123
   Retry-After: 5
```

Client follows `Location` to poll. This is the pattern described in RFC 7231 and used by REST APIs for long-running operations.

### Considerations

- **Polling window:** how long to keep job status available? Store in DB or cache with TTL (e.g., 24 hours after completion)
- **Orphaned polls:** clients that crash and restart need to recover the `jobId` — return it in the initial `202` and persist client-side
- **Status endpoint load:** high-frequency polling from many clients can stress the status service — use short TTL caching on status reads
- **Result separation:** store the result separately from the status record; large results don't bloat the status response

---

## 2. Reply Queue

The caller publishes a job message to a **request queue** and includes a `replyTo` address. The worker publishes the result to that reply queue when done. The caller listens on its own reply queue.

```
Caller   →  Queue: jobs.process
              { jobId: "abc", payload: {...}, replyTo: "queue://results.service-a" }

Worker   →  consumes from jobs.process
         →  processes job
         →  Queue: results.service-a
              { jobId: "abc", status: "done", result: {...} }

Caller   →  consumes from results.service-a  →  handles result
```

### Correlation ID

When a caller has many in-flight jobs, it must match replies to the original request.

```
Request:
  { correlationId: "req_xyz", jobId: "abc", ... }

Reply:
  { correlationId: "req_xyz", status: "done", result: {...} }

Caller maintains a map:
  pending["req_xyz"] = { resolve, reject, timeoutHandle }
  On reply: resolve(result); clearTimeout(timeoutHandle)
```

### Considerations

- **Reply queue ownership:** each caller service owns its own reply queue; do not share a reply queue across services (mixing of unrelated replies)
- **Timeout handling:** if no reply arrives within N seconds, treat as failure; don't wait forever
- **Caller restarts:** if caller crashes before consuming the reply, the reply message sits in the queue — set a TTL on reply queue messages
- **Scaling callers:** if the caller scales horizontally, route replies to the specific instance that made the request (sticky session per instance ID), or use a shared reply queue with instance-level filtering

---

## 3. Webhook / Callback

The caller provides a **callback URL** when submitting the job. The worker sends an HTTP POST to that URL when the job completes (or fails).

```
Caller  →  POST /jobs
              { payload: {...}, callbackUrl: "https://caller.example.com/job-results" }
        ←  202 Accepted  { jobId: "abc" }

Worker  →  processes job
        →  POST https://caller.example.com/job-results
              { jobId: "abc", status: "done", result: {...} }

Caller  →  receives callback  →  processes result
        ←  200 OK  (acknowledge receipt)
```

### Webhook Reliability

The worker must retry if the callback fails. The caller must be idempotent.

```
Delivery attempt 1 → caller returns 500 → retry after 30s
Delivery attempt 2 → caller returns 200 → done

Delivery attempt 3 → caller returns 200 (duplicate)
Caller must deduplicate by jobId
```

Retry policy: exponential backoff with a cap (e.g., retry for up to 24 hours). After exhaustion, alert + log to DLQ — the result is not lost, but delivery failed.

### Security

Callers must verify that webhook requests genuinely come from the expected worker, not an attacker spoofing the endpoint.

**HMAC signature verification:**
```
Worker computes:
  signature = HMAC-SHA256(secret_key, request_body)
  Header: X-Webhook-Signature: sha256=<signature>

Caller verifies:
  expected = HMAC-SHA256(secret_key, raw_body)
  if not constant_time_compare(expected, received): reject 401
```

Additional protections:
- **Timestamp in payload + header:** reject requests older than N minutes (replay attack prevention)
- **IP allowlist:** only accept requests from known worker IP ranges (secondary control)
- **TLS only:** never accept webhook callbacks over plain HTTP

### Considerations

- **Caller must be reachable:** requires the caller to expose a public (or at least network-reachable) endpoint — problematic for clients behind NAT or in private networks
- **Ephemeral callers:** if the caller is a short-lived process (Lambda, CLI), it may not be running when the callback arrives — use a persistent callback receiver service instead
- **Result storage:** worker should store the result durably before delivering the callback; if the callback fails and retries exhaust, the result should still be recoverable via polling

---

## 4. Server-Sent Events (SSE)

The client opens a **persistent HTTP connection**. The server pushes progress updates and the final result over that connection as the job runs.

```
Client  →  POST /jobs              →  202 Accepted  { jobId: "abc" }
Client  →  GET /jobs/abc/stream    →  text/event-stream (connection held open)

Server pushes:
  event: progress
  data: { "percent": 25, "message": "Step 1 of 4 complete" }

  event: progress
  data: { "percent": 75, "message": "Step 3 of 4 complete" }

  event: done
  data: { "status": "done", "resultUrl": "/results/abc" }

Connection closed by server.
```

### SSE vs. WebSockets

| | SSE | WebSockets |
|---|---|---|
| **Direction** | Server → client only | Bidirectional |
| **Protocol** | HTTP/1.1, HTTP/2 | Separate WS protocol |
| **Reconnect** | Automatic (built into spec) | Manual |
| **Proxy/firewall** | Works through standard HTTP proxies | Can be blocked |
| **Complexity** | Low | Higher |
| **Use case** | Progress updates, live feeds | Chat, collaborative editing, gaming |

For background job progress: **SSE is usually sufficient and simpler**.

### Considerations

- **Connection limits:** browsers cap concurrent SSE connections per origin (6 with HTTP/1.1; effectively unlimited with HTTP/2 — use HTTP/2 multiplexing)
- **Connection drops:** SSE has built-in reconnect with `Last-Event-ID` — server should replay missed events from that ID
- **Load balancer / proxy:** ensure proxies don't buffer SSE responses (disable `proxy_buffering` in Nginx)
- **Stateless workers:** the worker executing the job and the SSE connection holder may be different instances — use a pub/sub channel (Redis pub/sub, in-process event bus) so the worker publishes progress and the SSE handler forwards it
- **Timeout:** close the stream and return a final event after a maximum duration regardless — don't hold connections open indefinitely

---

## 5. Shared Storage (Write + Poll)

The worker writes the result to a shared data store. The caller either polls the store directly or is notified to check it.

```
Worker  →  processes job
        →  writes result to: DB row / S3 object / Redis key
        →  updates status: job.status = "done", job.resultKey = "results/abc.json"

Caller  →  polls job status (as per polling pattern)
        →  on status = done: reads result from storage directly
```

### When to Use Shared Storage for Results

- **Large results:** a 500MB CSV export doesn't belong in a queue message or HTTP response body — write to S3 / blob storage and return a pre-signed URL
- **Long-lived results:** results that must be available for days (audit exports, reports) should be in durable storage, not a transient queue message
- **Multiple consumers:** if more than one system needs to read the result, shared storage avoids re-delivering the same payload

### Pre-Signed URL Pattern for Large Results

```
Worker completes  →  uploads result to S3 / GCS
Worker generates pre-signed URL (valid for 1 hour)
Worker updates job status: { status: "done", resultUrl: "<pre-signed-url>" }

Caller polls status endpoint
Caller receives resultUrl
Caller downloads directly from storage (bypasses the API server)
```

- Result download bypasses application servers entirely — no streaming large payloads through your API
- TTL on pre-signed URL limits exposure; client must download before expiry
- For very sensitive results: short TTL (15 minutes) + one-time use tokens

---

## 6. Push Notifications

For mobile apps or browser clients where the user may not be actively viewing the page, push the result through the platform notification channel.

```
Worker completes
  →  calls push notification service (FCM, APNs, Web Push)
  →  payload: { "jobId": "abc", "status": "done", "summary": "Your export is ready" }

Mobile app receives notification (even in background)
  →  taps notification
  →  fetches full result from API
```

### Considerations

- Push is **best-effort** — delivery not guaranteed; user may have notifications disabled
- Use push to **notify**, not to **deliver** the result — keep the notification payload small; actual result fetched via API on demand
- Combine with shared storage: notification tells the user the result is ready; user fetches from the standard status endpoint

---

## Combining Mechanisms

Real systems often combine multiple mechanisms for robustness and UX quality.

### Pattern: SSE Primary + Polling Fallback

```
Client opens SSE stream for live updates
  → If SSE connection drops or times out:
      fall back to polling the status endpoint
  → Eventual result always readable via status endpoint (source of truth)
```

### Pattern: Webhook Primary + Polling Fallback

```
Worker delivers result via webhook
  → If webhook delivery fails after N retries:
      caller can fall back to polling the status endpoint
  → Result always stored durably; webhook is a convenience, not the only path
```

### Pattern: Result in Storage + Notification

```
Worker writes result to S3
  → Sends push notification: "Your report is ready"
  → Caller polls status endpoint to get pre-signed URL
  → Caller downloads from S3 directly
```

**General principle:** the status endpoint (polling) is always the **source of truth**. Other mechanisms (SSE, webhook, push) are optimizations for latency and UX. They should be supplementary, not the only path to the result.

---

## Failure States and Error Results

Error results need as much structure as success results. The caller must be able to act on failures — retry, surface to user, alert, or log.

```json
{
  "jobId": "job_abc123",
  "status": "failed",
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "Payment service did not respond within 30s",
    "retryable": true,
    "occurredAt": "2024-11-01T02:03:45Z"
  },
  "attempts": 3,
  "nextRetryAt": null
}
```

### Retryable vs. Non-Retryable Failures

| Failure Type | `retryable` | Examples | Caller Action |
|---|---|---|---|
| Transient | `true` | Timeout, rate limit, upstream 503 | Retry after backoff |
| Permanent | `false` | Invalid input, missing data, auth failure | Surface to user; do not retry |
| Partial | — | Batch job: 980/1000 rows succeeded | Return partial result + error summary |

For batch jobs, always return a **partial result** where possible. Failing the entire job because 2% of records errored is poor UX and wastes the 98% of successful work.

---

## Result Retention and Cleanup

Job results consume storage. Define and enforce a retention policy.

| Result Type | Suggested TTL | Storage |
|---|---|---|
| Status record | 7–30 days after completion | DB / Redis |
| Small result payload (< 1MB) | 24–48 hours | DB / cache |
| Large result (file, export) | 24–72 hours | Object storage (S3, GCS) |
| Audit-required results | Per compliance requirement | Cold storage / archive |

**Cleanup job:** a scheduled job (ironic but correct) that deletes expired result records and storage objects. Without it, old job results accumulate indefinitely.

---

## Design Checklist

```
□ Default posture is fire-and-forget; result mechanism only added when genuinely needed
□ Every job returns a jobId immediately on submission (202 Accepted)
□ Status schema is consistent across all job types (pending/running/done/failed)
□ Polling endpoint uses Retry-After header to guide poll interval
□ Result stored separately from status record; large results go to object storage
□ Pre-signed URLs used for large result downloads (bypasses API servers)
□ Webhook deliveries are retried with backoff; result remains readable via polling after exhaustion
□ Webhook signatures verified with HMAC (timestamp + body)
□ SSE connections handled with HTTP/2; proxy buffering disabled
□ Reply queue messages have TTL; correlation IDs used to match replies to requests
□ Error responses distinguish retryable from non-retryable failures
□ Partial results returned for batch jobs rather than all-or-nothing failure
□ Result retention TTL defined; cleanup job in place
□ Polling is always the source-of-truth fallback regardless of primary notification mechanism
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Synchronous wait for async job | Ties up a connection/thread; timeouts under load | Return `202` + `jobId`; use polling or callback |
| Result only delivered via webhook with no fallback | Webhook failure = result lost | Always store result durably; webhook is supplementary |
| Large result payload in queue message or API response | Queue size limits; API timeout on slow networks | Write to object storage; return pre-signed URL |
| Polling at fixed short interval regardless of job duration | Excessive load on status endpoint | Exponential backoff; use `Retry-After` hint |
| No TTL on result storage | Old results accumulate indefinitely | Define retention policy; scheduled cleanup job |
| Unauthenticated webhook endpoint | Any caller can deliver fake results | HMAC signature verification on every callback |
| Status and result in same record | Frequent status updates lock the same row as the result read | Separate tables/keys for status vs. result |
| No error detail in failure response | Caller can't distinguish transient from permanent failure | Structured error with `code`, `message`, `retryable` |