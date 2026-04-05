# Performance Antipattern: Retry Storm

---

## 1. What Is a Retry Storm?

A **Retry Storm** occurs when multiple clients or services simultaneously retry failed requests to a struggling downstream dependency, causing the already-overloaded system to receive a flood of additional requests — amplifying the failure rather than recovering from it.

It is a **positive feedback loop of failure**: the more the downstream struggles, the more retries pile in, the more it struggles.

```
Normal Load:        [Client] ---> [Service]  ✓

Initial Failure:    [Client] --X  [Service]  ← overloaded / slow

Retry Storm:        [Client] ---> [Service]  ← retries compound the load
                    [Client] --->     ↑       ← others doing the same
                    [Client] --->     |       ← load multiplied N×
                    [Client] --->  💥 |       ← cascading failure
```

### Why It Is Dangerous

- A service that was **95% healthy** can be pushed to **total failure** by retry amplification
- Retries arrive in **synchronized waves** (especially after timeouts of equal duration)
- Downstream recovery is **actively prevented** — every time the system starts to heal, a new retry wave arrives
- Cascading failures spread to **upstream callers** and **unrelated services** sharing the same infrastructure

---

## 2. Root Causes

| Cause | Description |
|---|---|
| **Naive retry logic** | Immediate or fixed-interval retries without any backoff |
| **Synchronized clients** | All clients have the same timeout, so retries fire simultaneously |
| **No retry budget** | Unlimited retries per request; no global cap |
| **Thundering herd on startup** | All instances start simultaneously and retry at the same time |
| **Cascading timeouts** | A slow DB causes timeouts in service A → service B retries A → amplified load |
| **Missing circuit breakers** | No mechanism to stop retrying a clearly broken dependency |

---

## 3. Anatomy of a Retry Storm

### Phase 1 — Trigger
A downstream service (DB, API, cache) becomes slow or unavailable due to a spike, deployment, or hardware issue.

### Phase 2 — Timeout Synchronization
All in-flight requests hit the same timeout threshold at roughly the same time, producing a synchronized retry burst.

### Phase 3 — Amplification
```
Original RPS:       1,000 req/s
Max retries:        3 per request
Amplified load:     up to 4,000 req/s (1 original + 3 retries)
With 3 services:    up to 12,000 req/s cascading upstream
```

### Phase 4 — Collapse
The downstream, already struggling, is now hit with multiples of its original load. Queue depth grows, latency skyrockets, and the service fully crashes — taking healthy upstream services with it.

---

## 4. Core Mitigations

### 4.1 Exponential Backoff

Increase the wait time between each retry attempt exponentially.

```
Retry 1: wait 100ms
Retry 2: wait 200ms
Retry 3: wait 400ms
Retry 4: wait 800ms
Retry N: wait min(base × 2^N, max_delay)
```

**Pseudocode:**
```python
def retry_with_backoff(fn, max_retries=5, base_ms=100, max_ms=30_000):
    for attempt in range(max_retries):
        try:
            return fn()
        except TransientError as e:
            if attempt == max_retries - 1:
                raise
            delay = min(base_ms * (2 ** attempt), max_ms)
            sleep(delay / 1000)
```

**Problem solved:** Prevents tight retry loops. Gives the downstream time to recover.  
**Remaining issue:** All clients still backoff by the same amount — retries remain synchronized.

---

### 4.2 Jitter (Full Jitter / Decorrelated Jitter)

Add randomness to backoff to **de-synchronize retries** across clients.

#### Full Jitter
```python
delay = random(0, min(max_cap, base * 2 ** attempt))
```

#### Decorrelated Jitter (AWS recommendation)
```python
sleep = min(max_cap, random(base, prev_sleep * 3))
```

**Why it matters:** Without jitter, 10,000 clients backing off for exactly 1 second all retry simultaneously. With jitter, retries are spread across the interval — the downstream sees a steady trickle instead of a wave.

```
Without Jitter:   ||||||||||||  (spike at t=1s, t=2s, t=4s)
With Jitter:      |  | | |  |  | | (spread evenly)
```

---

### 4.3 Circuit Breaker Pattern

Stop retrying a dependency that is clearly broken. Allow it to recover before resuming traffic.

```
States:
  CLOSED   → requests flow normally; failures counted
  OPEN     → requests fail immediately (no retry); dependency rests
  HALF-OPEN → a probe request is sent; if successful → CLOSED, else → OPEN

Thresholds (example):
  Open circuit if:  error_rate > 50% in a 10s window
  Half-open after:  30s cooldown
```

**Tools:** Netflix Hystrix (deprecated), Resilience4j, Polly (.NET), Go's `gobreaker`

---

### 4.4 Retry Budgets

Instead of per-request retry limits, enforce a **global retry rate** relative to total request volume.

```
Budget policy: retries must not exceed 10% of total outgoing RPS

Example:
  Outgoing requests: 10,000 RPS
  Max retries allowed: 1,000 RPS
  Excess retries: dropped (or fail-fast)
```

Used heavily at **Google** (described in the SRE book). Prevents a small number of failing requests from consuming unbounded retry capacity.

---

### 4.5 Token Bucket / Rate Limiting on Retries

Apply a token bucket specifically for retry traffic:

```
Retry token bucket:
  Capacity:    100 tokens
  Refill rate: 10 tokens/second
  Each retry:  consumes 1 token
  Empty bucket: retry is not attempted → fail fast
```

---

### 4.6 Idempotency Keys

Ensure retried requests do not cause duplicate side effects (double charges, duplicate records). Required for safe retry implementation.

```http
POST /payments
Idempotency-Key: uuid-a3f2-...
```

The server deduplicates on the key — multiple retries of the same request are safe.

---

### 4.7 Hedged Requests (Alternative to Retries)

Instead of waiting for a timeout and then retrying, send a **second parallel request** after a short delay (the *hedging delay*).

```
t=0ms    → Send request to replica A
t=95ms   → No response yet → send to replica B (hedge)
t=110ms  → Replica B responds → cancel request to A
```

**Trade-off:** Doubles load on downstream in the worst case, but eliminates tail-latency failures without causing storm-level amplification. Best for **read-heavy, idempotent** workloads.

---

## 5. Trade-offs

| Mitigation | Benefit | Cost / Risk |
|---|---|---|
| **Exponential backoff** | Reduces retry pressure significantly | Increases latency for the caller |
| **Full jitter** | De-synchronizes retries | Unpredictable latency; harder to reason about SLAs |
| **Circuit breaker** | Gives downstream time to recover | Adds complexity; misconfigured thresholds cause false opens |
| **Retry budget** | Enforces system-wide retry ceiling | Requires centralized coordination; hard to tune budget |
| **Hedged requests** | Reduces tail latency without retry storms | Increased load on healthy replicas; only safe for idempotent ops |
| **No retries (fail-fast)** | Zero amplification risk | Poor user experience; misses transient failures |
| **Infinite retries** | Highest success rate on transient errors | Catastrophic during sustained outages |

### Key Tensions

- **Reliability vs. Amplification:** More retries = higher success rate for transient faults, but higher blast radius during real outages.
- **Latency vs. Safety:** Jitter and backoff increase tail latency. Users experience slower degradation rather than fast failure.
- **Simplicity vs. Correctness:** Circuit breakers and retry budgets are complex to tune. Wrong thresholds introduce more problems than they solve.
- **Client autonomy vs. Coordination:** Per-client retry logic is simple but can't prevent global storms. Centralized retry coordination is effective but adds operational complexity.

---

## 6. Real-World Systems and Incidents

### 6.1 Amazon — AWS SDK Retry Storms
Early versions of AWS SDKs used fixed-interval retries. During partial S3 or DynamoDB outages, synchronized retries from thousands of customers amplified the failures significantly. AWS responded by:
- Publishing the **Exponential Backoff and Jitter** blog post (2015) — now a canonical reference
- Building jitter into all official AWS SDKs by default
- Introducing **adaptive retry mode** in the AWS SDK v2, which adjusts retry rates based on observed error rates

### 6.2 Google — Retry Budgets in gRPC / SRE
Google's SRE book explicitly defines **retry budgets** as a standard practice. gRPC supports `max_attempts` and per-call deadline policies. Google's internal services use a 10% retry budget rule: if more than 10% of requests to a service are retries, the client throttles itself.

### 6.3 Netflix — Hystrix and Resilience Engineering
Netflix's **Hystrix** library (now in maintenance; succeeded by Resilience4j) was built directly in response to retry-driven cascading failures across their microservices. Key features:
- Circuit breaker with configurable thresholds
- Request volume requirements before tripping (avoids false positives during low traffic)
- Fallback logic (return cached data, empty response, or error page)
- Metrics dashboard (Hystrix Dashboard / Turbine)

### 6.4 Stripe — Idempotency Keys for Safe Retries
Stripe's payment API is designed so that every `POST` request can be safely retried. Each request includes an `Idempotency-Key` header. This allows their SDK to retry aggressively on network errors without risk of double-charging customers — decoupling retry safety from storm risk.

### 6.5 Twitter / X — Thundering Herd on Cache Miss
Twitter experienced retry-storm-like cascades when their Memcache layer went cold during deployments. A cache miss caused services to retry reads and fan out to the database simultaneously. Their mitigation: **mutex locks on cache misses** (only one request populates the cache; others wait) and **probabilistic early expiration** to avoid synchronized expiry.

### 6.6 Slack — The 2015 Incident
During a database issue, Slack clients began retrying WebSocket connections simultaneously. The synchronized reconnection storm made recovery impossible until clients were forced to use randomized reconnect intervals via server-sent backoff hints.

---

## 7. Detection and Observability

Track these signals to detect and diagnose retry storms:

| Metric | What It Reveals |
|---|---|
| **Retry rate (% of total requests)** | Core indicator — spikes signal a developing storm |
| **Retry amplification ratio** | `total_requests / original_requests`; > 1.5× is a warning sign |
| **Error rate by error type** | Distinguish transient (5xx, timeout) from permanent (4xx) — only transient should be retried |
| **Downstream latency P99** | Rising tail latency often precedes a storm |
| **Circuit breaker state changes** | OPEN transitions indicate cascading failures in progress |
| **Queue depth / backlog** | Downstream queues filling up confirm load amplification |
| **Connection pool exhaustion** | Retries hold connections open; pool saturation is a key signal |

**Tooling:** Prometheus + Grafana (retry counters), Jaeger / Zipkin (distributed trace showing retry chains), Datadog APM, AWS CloudWatch retry metrics.

---

## 8. Decision Framework: Retry Strategy Selection

```
Is the operation idempotent?
├── NO  → Require idempotency key OR do not retry
└── YES → Proceed

Is the error transient? (5xx, timeout, network blip)
├── NO  (4xx, business logic error) → Do NOT retry
└── YES → Proceed

Is the downstream clearly broken? (sustained high error rate)
├── YES → Trip circuit breaker; stop retrying entirely
└── NO  → Retry with exponential backoff + jitter

Do you have a global retry budget enforced?
├── NO  → Add one (or at minimum cap per-request retries at 3)
└── YES → Retries safe within budget

Is tail latency a critical concern?
├── YES → Consider hedged requests instead of retries
└── NO  → Exponential backoff + jitter is sufficient
```

---

## 9. Summary Table

| Concept | One-Line Summary |
|---|---|
| **Retry Storm** | Synchronized retries amplify failure on already-struggling systems |
| **Exponential Backoff** | Double the wait time after each failure |
| **Jitter** | Randomize backoff to de-synchronize clients |
| **Circuit Breaker** | Stop retrying clearly broken dependencies; let them recover |
| **Retry Budget** | Cap retries as a % of total RPS system-wide |
| **Idempotency Key** | Make retries safe by deduplicating on the server side |
| **Hedged Requests** | Send a parallel backup request instead of waiting for timeout |
| **Retry Amplification Ratio** | Key metric: total requests / original requests |

---

## 10. Anti-Patterns Checklist (What NOT to Do)

- ❌ **Immediate retry on failure** — No backoff; hammers the downstream instantly
- ❌ **Fixed-interval retry without jitter** — Synchronized retry waves at every interval
- ❌ **Unlimited retries** — No cap; a single slow request can retry forever
- ❌ **Retrying non-idempotent operations** — Double charges, duplicate records, data corruption
- ❌ **Retrying on non-transient errors** — Retrying a `400 Bad Request` wastes resources; the result will never change
- ❌ **No circuit breaker** — Keeps retrying a broken dependency with no cooldown period
- ❌ **Treating all errors as retryable** — Must distinguish 4xx from 5xx, business errors from infrastructure errors
- ❌ **Ignoring retry metrics** — Storm begins silently; you won't know until the system collapses

---

*References: AWS Architecture Blog — Exponential Backoff and Jitter (2015); Google SRE Book — Chapter 22 (Addressing Cascading Failures); Netflix Tech Blog — Fault Tolerance in a High Volume Distributed System; Stripe API Documentation — Idempotent Requests*