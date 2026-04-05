# Instrumentation

## Definition

Instrumentation is the practice of **embedding measurement and observability code directly into a system** to collect data about its internal state, behavior, and performance at runtime. It is the foundation of all observability — without instrumentation, you have no signals; without signals, you cannot understand, debug, or optimize a system.

> Instrumentation answers: "What is my system actually doing right now, and how well is it doing it?"

---

## Core Concepts

### The Three Pillars of Observability (Signals)

```
┌─────────────────────────────────────────────────────────────┐
│                    INSTRUMENTATION                           │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │    METRICS   │  │    TRACES    │  │      LOGS        │   │
│  │              │  │              │  │                  │   │
│  │  Aggregated  │  │  Distributed │  │  Timestamped     │   │
│  │  numeric     │  │  request     │  │  records of      │   │
│  │  measurements│  │  flows       │  │  discrete events │   │
│  │              │  │              │  │                  │   │
│  │  "How many?" │  │  "Which path"│  │  "What happened?"│   │
│  │  "How fast?" │  │  "How long?" │  │  "Why did it     │   │
│  │  "How often?"│  │  "Where slow"│  │   fail?"         │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Types of Instrumentation

| Type | Description | Examples |
|---|---|---|
| **Automatic / Agent-based** | SDK/agent injects instrumentation without code changes | APM agents, JVM agents, eBPF probes |
| **Manual / Code-based** | Developer explicitly adds instrumentation to code | `counter.increment()`, `span.start()` |
| **Hybrid** | Auto-instrumentation with manual enrichment | OpenTelemetry auto + custom spans |

---

## Metrics

### Metric Types

```
┌──────────────────────────────────────────────────────────────────┐
│ COUNTER          │ Monotonically increasing value                 │
│                  │ e.g., total_requests, errors_total             │
│                  │ Use: rate(), increase() functions              │
├──────────────────────────────────────────────────────────────────┤
│ GAUGE            │ Value that goes up and down                    │
│                  │ e.g., active_connections, memory_used_bytes    │
│                  │ Use: point-in-time snapshots                   │
├──────────────────────────────────────────────────────────────────┤
│ HISTOGRAM        │ Samples bucketed by value ranges               │
│                  │ e.g., http_request_duration_seconds            │
│                  │ Use: percentile calculations (p50, p95, p99)  │
├──────────────────────────────────────────────────────────────────┤
│ SUMMARY          │ Pre-computed quantiles on client               │
│                  │ e.g., rpc_duration_seconds{quantile="0.99"}    │
│                  │ Use: when merging across instances is not needed│
└──────────────────────────────────────────────────────────────────┘
```

### The Four Golden Signals (Google SRE)

```
┌────────────────────────────────────────────────────────┐
│  1. LATENCY     - How long requests take               │
│                   Track success vs. error latency      │
│                   separately                           │
│                                                        │
│  2. TRAFFIC     - How much demand is on the system     │
│                   RPS, QPS, bytes/sec, msg/sec         │
│                                                        │
│  3. ERRORS      - Rate of failing requests             │
│                   HTTP 5xx, exceptions, timeouts       │
│                                                        │
│  4. SATURATION  - How "full" the service is            │
│                   CPU %, queue depth, disk %, threads  │
└────────────────────────────────────────────────────────┘
```

### USE Method (for Resources)

- **Utilization** — % of time the resource is busy
- **Saturation** — degree to which the resource has extra work it can't service (queue depth)
- **Errors** — count of error events

### RED Method (for Services)

- **Rate** — requests per second
- **Errors** — failed requests per second
- **Duration** — distribution of request latencies

### Metric Cardinality

High cardinality is one of the most critical instrumentation design challenges.

```
LOW CARDINALITY (good for metrics):
  http_requests_total{method="GET", status="200", service="api"}
  → 2 methods × 10 status codes × 50 services = 1,000 series

HIGH CARDINALITY (metrics killer):
  http_requests_total{user_id="abc123", ...}
  → 10M users = 10M time series → OOM, slow queries
  → Move user_id to TRACES or LOGS instead
```

**Cardinality Budget Rule:**
- Each label dimension multiplies series count
- Keep total metric cardinality under 1M series per cluster
- High-cardinality identifiers (user_id, request_id, trace_id) → traces/logs

---

## Distributed Tracing

### Anatomy of a Trace

```
Trace: checkout-flow (trace_id=abc123)
│
├── [0ms]  api-gateway           SPAN: route_request          [15ms]
│
├── [15ms] order-service         SPAN: create_order           [120ms]
│   ├── [20ms] postgres          SPAN: db.query (INSERT)      [30ms]
│   └── [55ms] inventory-svc    SPAN: check_stock             [70ms]
│       └── [60ms] redis        SPAN: cache.get               [5ms]
│
└── [135ms] payment-service     SPAN: charge_card             [200ms]
    └── [140ms] stripe-api      SPAN: http.post /v1/charges   [190ms]
```

### Context Propagation

Traces only work if context is passed across service boundaries:

```
Service A ──────────────────────────────────────────► Service B
           HTTP Header: traceparent: 00-<trace_id>-<span_id>-01
           gRPC metadata / Kafka headers / AMQP properties
```

**W3C TraceContext** is the standard propagation format:
```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             version-trace_id(128bit)-------span_id(64bit)--flags
```

### Sampling Strategies

```
HEAD-BASED SAMPLING (decision at trace start):
  - Probabilistic: sample 1% of all traces
  - Rate-limiting: sample 100 traces/sec max
  + Simple, low overhead
  - May miss rare errors

TAIL-BASED SAMPLING (decision after trace complete):
  - Always sample errors, slow requests, new routes
  - Collect all spans; decide at trace collector
  + Catches the important cases
  - Higher memory/storage pressure at collector

ADAPTIVE SAMPLING:
  - Adjust sample rates based on traffic volume
  - Higher rates for low-traffic services
  - Used by: Jaeger, AWS X-Ray adaptive mode
```

---

## Logging

### Log Levels

```
TRACE   → Extremely detailed, per-line execution (dev only)
DEBUG   → Diagnostic info for developers
INFO    → Normal operational events (startup, config load)
WARN    → Unexpected but recoverable situations
ERROR   → Failures requiring attention
FATAL   → System cannot continue, immediate shutdown
```

### Structured Logging

Prefer structured (JSON) over unstructured logs:

```json
// ❌ Unstructured — hard to parse and query
"ERROR 2024-01-15 12:34:56 Payment failed for user 12345: timeout after 30s"

// ✅ Structured — queryable, indexable
{
  "timestamp": "2024-01-15T12:34:56Z",
  "level": "ERROR",
  "service": "payment-service",
  "event": "payment_failed",
  "user_id": "12345",
  "error": "timeout",
  "duration_ms": 30000,
  "trace_id": "abc123def456",
  "span_id": "789xyz"
}
```

### Correlation: Linking Logs, Metrics, and Traces

Always inject `trace_id` and `span_id` into log records so you can pivot between signals:

```python
# Python: inject trace context into structured log
import structlog
from opentelemetry import trace

span = trace.get_current_span()
log = structlog.get_logger().bind(
    trace_id=format(span.get_span_context().trace_id, '032x'),
    span_id=format(span.get_span_context().span_id, '016x')
)
log.error("payment_failed", user_id=user_id, error=str(e))
```

---

## Instrumentation Patterns

### Pattern 1: RED Instrumentation (Services)

```python
# Prometheus Python client
from prometheus_client import Counter, Histogram
import time

REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status_code']
)

REQUEST_LATENCY = Histogram(
    'http_request_duration_seconds',
    'Request latency in seconds',
    ['method', 'endpoint'],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
)

def handle_request(method, endpoint):
    start = time.time()
    try:
        response = process(method, endpoint)
        REQUEST_COUNT.labels(method, endpoint, response.status).inc()
        return response
    except Exception as e:
        REQUEST_COUNT.labels(method, endpoint, '500').inc()
        raise
    finally:
        REQUEST_LATENCY.labels(method, endpoint).observe(time.time() - start)
```

### Pattern 2: OpenTelemetry Tracing

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

# Setup (once at startup)
provider = TracerProvider()
provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="http://collector:4317"))
)
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("my-service")

# Usage
def process_order(order_id: str):
    with tracer.start_as_current_span("process_order") as span:
        span.set_attribute("order.id", order_id)
        span.set_attribute("order.source", "web")

        with tracer.start_as_current_span("validate_order"):
            validate(order_id)

        with tracer.start_as_current_span("charge_payment") as payment_span:
            try:
                charge(order_id)
            except PaymentError as e:
                payment_span.record_exception(e)
                payment_span.set_status(StatusCode.ERROR, str(e))
                raise
```

### Pattern 3: SLI/SLO Instrumentation

```yaml
# SLO Definition
service: checkout-api

SLIs:
  availability:
    metric: http_requests_total{status!~"5.."}
    formula: good_requests / total_requests
    target: 99.9%       # 43.2 min downtime/month

  latency:
    metric: http_request_duration_seconds
    formula: requests_under_200ms / total_requests
    target: 95%         # 95% of requests < 200ms

error_budget:
  window: 30d
  burn_rate_alerts:
    - severity: page    # 2% budget consumed in 1 hour
      window: 1h
      threshold: 14.4
    - severity: ticket  # 5% budget consumed in 6 hours
      window: 6h
      threshold: 6
```

### Pattern 4: Custom Business Metrics

```python
# Business-level instrumentation beyond technical signals
ORDERS_CREATED = Counter('orders_created_total', 'Orders placed', ['channel', 'region'])
ORDER_VALUE = Histogram('order_value_usd', 'Order value in USD', ['channel'])
CART_ABANDONMENT = Counter('cart_abandoned_total', 'Abandoned carts', ['step'])
CHECKOUT_FUNNEL = Counter('checkout_step_total', 'Checkout funnel', ['step', 'outcome'])
```

---

## OpenTelemetry (OTel) — The Standard

OpenTelemetry is the vendor-neutral, CNCF standard for instrumentation.

```
┌─────────────────────────────────────────────────────────────────┐
│                     APPLICATION CODE                            │
│                                                                 │
│  OTel SDK (Metrics + Traces + Logs) — vendor-neutral API        │
└──────────────────────┬──────────────────────────────────────────┘
                       │ OTLP (OpenTelemetry Protocol)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                  OTEL COLLECTOR                                  │
│                                                                 │
│  Receivers → Processors (filter, sample, enrich) → Exporters   │
└──────┬──────────────────────────┬───────────────────────────────┘
       │                          │
       ▼                          ▼
┌─────────────┐          ┌─────────────────┐
│  Prometheus │          │ Jaeger / Tempo  │
│  Grafana    │          │ (Traces)        │
│  (Metrics)  │          └─────────────────┘
└─────────────┘
       │
       ▼
┌─────────────┐
│  Loki       │
│  (Logs)     │
│  ELK Stack  │
└─────────────┘
```

**OTel Collector Config Example:**
```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1000
  tail_sampling:
    policies:
      - name: errors, type: status_code, status_code: {status_codes: [ERROR]}
      - name: slow, type: latency, latency: {threshold_ms: 500}
      - name: sample, type: probabilistic, probabilistic: {sampling_percentage: 10}

exporters:
  prometheus:
    endpoint: "0.0.0.0:8889"
  otlp/jaeger:
    endpoint: jaeger:4317

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, tail_sampling]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

---

## Instrumentation Architecture

### Pull vs Push Model

```
PULL (Prometheus model):
  Collector ──HTTP GET /metrics──► Service
  + No client-side buffering
  + Collector controls scrape rate
  - Services must expose HTTP endpoint
  - Not great for short-lived jobs

PUSH (StatsD, OTLP model):
  Service ──UDP/gRPC──► Aggregator/Collector
  + Works for short-lived jobs (batch, lambdas)
  + Firewall-friendly (service initiates)
  - Client-side buffering complexity
  - Need to handle back-pressure

HYBRID (Prometheus Pushgateway):
  Short-lived jobs ──push──► Pushgateway ──pull──► Prometheus
  + Best of both worlds for batch jobs
  - Pushgateway becomes a SPOF
  - Stale metrics if job crashes
```

### Instrumentation Pipeline

```
Service
  │
  ├── Metrics ────────────► Prometheus/VictoriaMetrics ──► Grafana
  │
  ├── Traces ─────────────► Jaeger / Tempo ──────────────► Grafana
  │
  └── Logs ───────────────► Loki / Elasticsearch ─────────► Grafana/Kibana
                                        │
                                        ▼
                               Alertmanager / PagerDuty
```

---

## Trade-offs

| Dimension | More Instrumentation | Less Instrumentation |
|---|---|---|
| **Observability** | Deep insight, faster MTTR | Blind to failures, slow debugging |
| **Performance overhead** | Higher CPU, memory, I/O | Lower overhead, more headroom |
| **Storage cost** | Higher metrics/log storage | Lower storage spend |
| **Cardinality risk** | Risk of OOM in metric stores | Fewer series, safer |
| **Development cost** | More code to write/maintain | Less code, faster iteration |
| **On-call experience** | Rich dashboards, clear alerts | Alert fatigue from gaps or silence |
| **Compliance/audit** | Full audit trail | Gaps in audit coverage |
| **Build time** | Slower — more deps | Faster builds |

### Sampling Trade-offs

| Strategy | Pros | Cons | Use When |
|---|---|---|---|
| **No sampling (100%)** | Complete data, no blind spots | Huge cost, slow queries | Low-traffic services, critical paths |
| **Head-based probabilistic** | Simple, predictable cost | Misses rare errors | High-traffic, cost-constrained |
| **Tail-based** | Captures errors and slow spans | Higher memory at collector | When error coverage matters most |
| **Adaptive** | Balances cost and coverage | Complex to configure | Large, heterogeneous systems |

### Instrumentation Granularity Trade-offs

```
COARSE (per-service):
  + Low overhead, low cardinality
  - Can't identify which endpoint/method is slow

MEDIUM (per-endpoint):
  + Good balance of insight vs. cost
  - May miss intra-service bottlenecks

FINE (per-operation, per-query):
  + Full visibility into hot paths
  - High cardinality, high storage cost
```

---

## Real-World Systems & Applications

### Netflix
- Instruments every microservice with **Atlas** (their in-house metrics system) for time-series data at massive scale
- Uses **spectator** (their OTel-like SDK) embedded in the JVM platform library — auto-instruments every service
- Tail-based sampling on traces via **Edgar** to always capture user-facing failures
- Custom business metrics: stream starts, rebuffers, bitrate shifts per title and CDN edge

### Uber
- Builds **M3** (open-sourced), a distributed metrics platform handling billions of metrics/min
- Auto-instrumentation via a Go middleware that wraps every RPC with RED metrics
- Trace every trip lifecycle end-to-end using **Jaeger** (which they open-sourced)
- Instruments driver-app heartbeat events to detect silent failures without explicit errors

### Stripe
- Every API call emits structured logs with `request_id`, `idempotency_key`, and `user_id` (for support lookups)
- Instruments payment state machine transitions as events → feeds into error rate SLOs
- Custom metric: payment authorization rate by card network (Visa/Mastercard/Amex) — caught a Visa-specific issue before customers noticed
- Error budget tracking per endpoint — teams own their SLOs

### Shopify
- Instruments Liquid template rendering time per theme to identify merchant-caused slowness
- Uses **StatsD** + **Datadog** for platform-wide metrics
- Flash sale detection: spike in `orders_per_minute` gauge triggers proactive scaling
- Per-merchant instrumentation to identify "noisy merchant" patterns without high cardinality (bucketed by merchant tier, not ID)

### Discord
- Instruments WebSocket connection state machine (connecting, connected, reconnecting, dropped)
- Tracks voice packet loss rate per server region — used to detect network degradation before users report it
- Custom metric: `messages_sent_per_minute` with guild_id hashed into buckets — not raw IDs (cardinality management)
- Alert on p99 message delivery latency, not p50, because tail matters for user experience

### Google (SRE Model)
- Originator of the **Four Golden Signals** — latency, traffic, errors, saturation
- Instruments every service at the RPC layer via **Stubby** (internal gRPC) — all services auto-get RED metrics
- SLO-based alerting: alert on burn rate, not raw error rates (avoids alert fatigue)
- Error budget drives release velocity decisions — if budget is exhausted, freeze deployments

### Airbnb
- **Minerva** metrics platform: auto-instruments every Python/Java/Go service at the framework layer
- Business SLOs tied to search ranking quality, booking conversion rate, and host response time — instrumented as first-class metrics
- Canary deployments gated on metric comparisons: new version must not degrade p99 latency vs. baseline

---

## Anti-Patterns

### 1. Logging Everything at DEBUG in Production
```python
# ❌ Floods storage, kills I/O
log.debug(f"Processing item {item_id} at step {step}")  # inside loop of 10M items

# ✅ Sample or use sampling flags
if random.random() < 0.001:  # 0.1% sample
    log.debug(...)
# Or: use structured trace spans instead of debug logs
```

### 2. High-Cardinality Metric Labels
```python
# ❌ Explodes metric store — 10M users × 100 endpoints = 1B series
REQUEST_COUNT.labels(user_id=user_id, endpoint=endpoint).inc()

# ✅ Keep metric labels low-cardinality; user_id goes in traces/logs
REQUEST_COUNT.labels(endpoint=endpoint, region=region).inc()
```

### 3. Missing Context Propagation
```python
# ❌ Trace breaks at service boundary — can't correlate
response = requests.post("http://payment-svc/charge", json=payload)

# ✅ Inject trace context into outbound requests
from opentelemetry.propagate import inject
headers = {}
inject(headers)
response = requests.post("http://payment-svc/charge", json=payload, headers=headers)
```

### 4. Alerting on Metrics Instead of Symptoms
```yaml
# ❌ Too noisy — CPU spike doesn't always mean user impact
alert: HighCPU
  expr: cpu_usage > 80

# ✅ Alert on user-facing symptoms (SLO burn rate)
alert: HighErrorRate
  expr: |
    (rate(http_requests_total{status=~"5.."}[5m])
     / rate(http_requests_total[5m])) > 0.01
```

### 5. Instrumentation Only in Happy Path
```python
# ❌ No instrumentation on error or timeout paths
try:
    result = fetch_data()
    REQUEST_COUNT.labels(status='200').inc()
    return result
except Exception:
    raise  # ← error path is invisible

# ✅ Always instrument all outcomes
try:
    result = fetch_data()
    REQUEST_COUNT.labels(status='200').inc()
    return result
except TimeoutError:
    REQUEST_COUNT.labels(status='timeout').inc()
    raise
except Exception:
    REQUEST_COUNT.labels(status='error').inc()
    raise
```

### 6. No Histogram Buckets Matching SLOs
```python
# ❌ Default buckets won't let you query "requests under 200ms"
Histogram('latency_seconds', ...)

# ✅ Align buckets with your SLO thresholds
Histogram('latency_seconds', ...,
    buckets=[0.05, 0.1, 0.2, 0.5, 1.0, 2.5, 5.0, 10.0])
#                   ^^^^ 200ms SLO boundary
```

---

## Decision Framework

```
What signal do I need?
│
├── Is it "how many / how often / how long"?
│     └── METRIC (Counter, Gauge, Histogram)
│
├── Is it "what path did this request take through my system"?
│     └── DISTRIBUTED TRACE
│
├── Is it "what happened in detail at a specific moment"?
│     └── LOG (structured)
│
└── Is it a user-facing outcome (conversion, session length, revenue)?
      └── BUSINESS METRIC / EVENT ANALYTICS

For each metric, ask:
  Is cardinality > 10k label combinations?
  ├── Yes → Move high-cardinality dims to traces/logs
  └── No  → Proceed with metric

For each trace:
  Is traffic > 1k RPS?
  ├── Yes → Apply sampling (tail-based preferred)
  └── No  → 100% capture if budget allows

For each log:
  Does it need to be queryable by field?
  ├── Yes → Structured JSON log
  └── No  → Plaintext is acceptable
```

---

## Key Metrics to Instrument (by Layer)

### Application Layer
- `http_requests_total{method, endpoint, status_code}` — Counter
- `http_request_duration_seconds{method, endpoint}` — Histogram
- `active_connections` — Gauge
- `error_rate{type}` — derived from counters

### Database Layer
- `db_query_duration_seconds{operation, table}` — Histogram
- `db_connection_pool_size{state}` — Gauge (active, idle, waiting)
- `db_queries_total{operation}` — Counter
- `db_deadlocks_total` — Counter

### Cache Layer
- `cache_hits_total` / `cache_misses_total` — Counter → derive hit rate
- `cache_evictions_total` — Counter
- `cache_memory_bytes{state}` — Gauge

### Queue/Messaging Layer
- `queue_depth{queue_name}` — Gauge
- `message_processing_duration_seconds` — Histogram
- `messages_consumed_total` / `messages_published_total` — Counter
- `consumer_lag` — Gauge (most critical for Kafka)

### Infrastructure Layer
- `cpu_usage_percent{host, core}` — Gauge
- `memory_used_bytes` — Gauge
- `disk_io_bytes_total{direction}` — Counter
- `network_bytes_total{direction, interface}` — Counter

---

## Monitoring Stack Reference

| Tool | Signal | Notes |
|---|---|---|
| **Prometheus** | Metrics | Pull-based, PromQL, TSDB; standard for K8s |
| **VictoriaMetrics** | Metrics | Drop-in Prometheus replacement, better cardinality |
| **Grafana** | Visualization | Dashboards for all three pillars |
| **Jaeger** | Traces | CNCF open-source, good for Kubernetes |
| **Tempo** | Traces | Grafana's trace backend, object storage |
| **Zipkin** | Traces | Simpler, lightweight, Twitter origin |
| **Loki** | Logs | Label-indexed, pairs with Grafana, cheap |
| **Elasticsearch** | Logs | Full-text search, heavier, more powerful |
| **Datadog** | All three | Commercial, auto-instrumentation, expensive |
| **New Relic** | All three | Commercial APM |
| **AWS X-Ray** | Traces | Native AWS, limited cross-cloud |
| **OpenTelemetry** | All three | Vendor-neutral SDK + Collector; the standard |

---

## Summary Cheat Sheet

```
Signal    → Tool              → Question Answered
────────────────────────────────────────────────────
Metrics   → Prometheus/DD     → Is the system healthy? (alerts)
Traces    → Jaeger/Tempo      → Where is THIS request slow?
Logs      → Loki/ELK          → WHY did this specific request fail?

Golden Signals: Latency · Traffic · Errors · Saturation
USE Method:     Utilization · Saturation · Errors       (resources)
RED Method:     Rate · Errors · Duration                (services)

Cardinality: labels LOW → metrics | labels HIGH → traces/logs
Sampling:    head-based (simple) | tail-based (catches errors)
Standard:    OpenTelemetry — vendor-neutral, instrument once, export anywhere
```