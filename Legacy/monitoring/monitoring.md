# Monitoring in System Design

---

## Table of Contents

1. [What is Monitoring?](#what-is-monitoring)
2. [Why Monitoring Matters](#why-monitoring-matters)
3. [The Four Golden Signals](#the-four-golden-signals)
4. [Pillars of Observability](#pillars-of-observability)
5. [Metrics](#metrics)
6. [Logging](#logging)
7. [Distributed Tracing](#distributed-tracing)
8. [Alerting](#alerting)
9. [Dashboards & Visualization](#dashboards--visualization)
10. [Health Checks](#health-checks)
11. [SLIs, SLOs, and SLAs](#slis-slos-and-slas)
12. [Monitoring Architecture Patterns](#monitoring-architecture-patterns)
13. [Trade-offs](#trade-offs)
14. [Real-World Systems & Examples](#real-world-systems--examples)
15. [Tooling Ecosystem](#tooling-ecosystem)
16. [Decision Framework](#decision-framework)
17. [Anti-Patterns](#anti-patterns)
18. [Key Metrics to Monitor by Layer](#key-metrics-to-monitor-by-layer)

---

## What is Monitoring?

Monitoring is the practice of **collecting, aggregating, analyzing, and acting on data** about a running system to understand its health, performance, and behavior over time.

It answers the question: **"Is the system working correctly right now, and was it working correctly in the past?"**

Monitoring is distinct from — but complementary to — **observability**, which answers: _"Why is the system behaving the way it is?"_

### Monitoring vs Observability

| Dimension | Monitoring | Observability |
|-----------|-----------|---------------|
| Nature | Predefined checks on known failure modes | Ability to ask arbitrary questions about system state |
| Direction | Known unknowns | Unknown unknowns |
| Tools | Metrics dashboards, alerts | Logs, traces, profiling |
| Question answered | "Is it broken?" | "Why is it broken?" |
| Setup | Upfront instrumentation | Ongoing, exploratory |

---

## Why Monitoring Matters

- **Detect failures early** — before users report them
- **Reduce MTTD/MTTR** — Mean Time to Detect / Mean Time to Recover
- **Capacity planning** — understand trends to provision ahead of demand
- **SLA compliance** — measure and enforce uptime and performance commitments
- **Business metrics** — connect system health to revenue, conversions, churn
- **Post-mortem analysis** — reconstruct what happened during incidents
- **Security detection** — anomalous behavior signals intrusions

---

## The Four Golden Signals

Coined by Google's SRE book. These four metrics form the minimum viable monitoring surface for any user-facing service.

### 1. Latency
Time taken to serve a request. Distinguish between successful and failed request latency.

```
p50, p95, p99, p999 latency (percentile-based — not averages)
```

> **Why percentiles over averages?**
> Averages hide tail latency. A p99 of 5s means 1% of users wait 5 seconds — unacceptable even if the average is 50ms.

### 2. Traffic
How much demand is hitting the system.

```
Requests per second (RPS)
Queries per second (QPS)
Messages per second (for queues)
Bytes per second (for streaming)
```

### 3. Errors
Rate of requests that fail (explicitly or implicitly).

```
HTTP 5xx rate
Exception rate
Timeout rate
Failed health checks
```

> **Implicit errors**: A response of HTTP 200 with corrupted data is an error. Define errors carefully.

### 4. Saturation
How "full" your service is. A measure of constraint — the resource most limiting throughput.

```
CPU utilization %
Memory usage %
Disk I/O utilization
Network bandwidth %
Thread pool queue depth
Connection pool exhaustion
```

---

## Pillars of Observability

The three fundamental data types that together enable full system observability:

```
┌──────────────────────────────────────────────────────┐
│                    OBSERVABILITY                     │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   METRICS   │  │    LOGS     │  │   TRACES    │  │
│  │             │  │             │  │             │  │
│  │ Aggregated  │  │ Timestamped │  │ End-to-end  │  │
│  │ numeric     │  │ event       │  │ request     │  │
│  │ time series │  │ records     │  │ flow        │  │
│  │             │  │             │  │             │  │
│  │ "What?"     │  │ "What       │  │ "Where?"    │  │
│  │             │  │  happened?" │  │             │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└──────────────────────────────────────────────────────┘
```

---

## Metrics

### Definition
Numeric measurements collected at regular intervals over time — **time series data**.

### Types of Metrics

#### Counter
Monotonically increasing value. Resets on restart.

```
http_requests_total
errors_total
bytes_sent_total
```

#### Gauge
A point-in-time value that goes up and down.

```
cpu_usage_percent
memory_bytes_used
active_connections
queue_depth
```

#### Histogram
Counts observations into configurable buckets. Used for latency and size distributions.

```
http_request_duration_seconds_bucket{le="0.1"}
http_request_duration_seconds_bucket{le="0.5"}
http_request_duration_seconds_bucket{le="1.0"}
http_request_duration_seconds_bucket{le="+Inf"}
```

#### Summary
Pre-computed quantiles (φ-quantiles). Client-side computation. Unlike histograms, cannot be aggregated across instances.

### Metric Collection Models

#### Pull (Scraping)
The monitoring system polls services at intervals.

```
Prometheus → scrapes → /metrics endpoint on each service
```

- **Pros**: Simple, service doesn't need to know about monitoring; easier to detect dead services
- **Cons**: Requires service discovery; doesn't work well for short-lived jobs

#### Push
Services push metrics to a collector.

```
App → pushes → StatsD / InfluxDB / Graphite
```

- **Pros**: Works for short-lived processes; no need for service discovery
- **Cons**: Monitoring system can be overwhelmed; harder to detect dead services

#### Hybrid (Push Gateway)
Used for short-lived jobs that push to a gateway, which Prometheus then scrapes.

### Metric Cardinality

**Cardinality** = the number of unique time series created by label combinations.

```
http_requests_total{method="GET", status="200", endpoint="/users"}   → 1 series
http_requests_total{method="POST", status="500", endpoint="/orders"}  → 1 series
...thousands more
```

**High cardinality** (e.g., user_id or request_id as labels) causes:
- Storage explosion
- Query slowness
- OOM crashes in TSDB

> **Rule of thumb**: Labels should have bounded, predictable cardinality (method, status code, service name — YES; user ID, trace ID — NO).

### Metric Storage: Time Series Databases (TSDB)

Optimized for time-indexed numeric data with efficient compression.

```
┌──────────────────────────────────────────────────┐
│  Time Series Database                            │
│                                                  │
│  [timestamp, metric_name, labels, value]         │
│                                                  │
│  1700000000  cpu_usage  {host="web-1"}  72.3    │
│  1700000060  cpu_usage  {host="web-1"}  74.1    │
│  1700000120  cpu_usage  {host="web-1"}  71.9    │
│                                                  │
│  Storage: delta encoding + gorilla compression   │
│  Retention: hot (recent) → cold (downsampled)    │
└──────────────────────────────────────────────────┘
```

**Tools**: Prometheus, VictoriaMetrics, InfluxDB, TimescaleDB, Cortex, Thanos

---

## Logging

### Definition
Timestamped, discrete records of events that occurred in a system.

### Log Levels (severity hierarchy)

```
TRACE   → Extremely verbose, step-by-step (dev only)
DEBUG   → Diagnostic info for developers
INFO    → Normal operational events
WARN    → Unexpected but non-fatal situations
ERROR   → Failures that require attention
FATAL   → System cannot continue; process exits
```

### Structured vs Unstructured Logs

#### Unstructured (text)
```
2024-01-15 10:23:45 ERROR Failed to connect to DB: timeout after 30s
```

Hard to parse, query, and aggregate programmatically.

#### Structured (JSON)
```json
{
  "timestamp": "2024-01-15T10:23:45Z",
  "level": "ERROR",
  "service": "order-service",
  "message": "Failed to connect to DB",
  "error": "timeout",
  "timeout_ms": 30000,
  "host": "web-3",
  "trace_id": "abc123def456"
}
```

Machine-readable, filterable, aggregatable.

> **Always prefer structured logging in production systems.**

### Log Pipeline Architecture

```
Application
    │
    ▼
Log Agent (Fluentd / Filebeat / Vector)
    │
    ▼
Log Aggregator / Broker (Kafka / Kinesis)
    │
    ▼
Log Store & Index (Elasticsearch / Loki / Splunk)
    │
    ▼
Query & Visualization (Kibana / Grafana)
```

### Log Sampling

At high throughput, logging every event is expensive. Use sampling:

- **Head-based sampling**: Decide at request start (e.g., 1% of requests)
- **Tail-based sampling**: Decide at request end — log all errors, sample successes
- **Adaptive sampling**: Increase sample rate for anomalous patterns

### Log Retention Strategy

| Tier | Duration | Storage | Cost |
|------|----------|---------|------|
| Hot (real-time search) | 7–14 days | SSD / in-memory index | High |
| Warm (recent history) | 30–90 days | HDD / compressed index | Medium |
| Cold (compliance/audit) | 1–7 years | Object store (S3 Glacier) | Low |

---

## Distributed Tracing

### The Problem
In microservices, a single user request may touch 10+ services. When it fails or is slow, you need to know **where** and **why**.

```
User Request
    │
    ├──→ API Gateway (2ms)
    │         │
    │         ├──→ Auth Service (5ms)
    │         │
    │         ├──→ Order Service (200ms) ← SLOW!
    │         │         │
    │         │         ├──→ Inventory DB (180ms) ← ROOT CAUSE
    │         │         │
    │         │         └──→ Payment Service (15ms)
    │         │
    │         └──→ Notification Service (8ms)
    │
Total: 230ms
```

### Core Concepts

#### Trace
The complete journey of a request through the system. Identified by a **trace ID**.

#### Span
A single unit of work within a trace (e.g., one service call, one DB query). Has:
- Span ID
- Parent span ID
- Start time
- Duration
- Tags/attributes (metadata)
- Events (logs within the span)
- Status (OK / Error)

#### Context Propagation
Trace and span IDs are passed between services via headers:

```
W3C Trace Context standard:
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
              ^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ^^^^^^^^^^^^^^^^ ^^
              ver  trace-id (128-bit)               span-id (64-bit)  flags
```

### Sampling Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| Always on | Trace every request | Low-traffic dev environments |
| Probabilistic | Trace X% of requests | High-throughput production |
| Rate limiting | Max N traces/sec | Bursty traffic |
| Tail-based | Decide after completion (always trace errors) | Critical paths |

### OpenTelemetry (OTel)

The vendor-neutral standard for instrumentation (traces, metrics, logs):

```
┌────────────────────────────────────────┐
│           OpenTelemetry SDK            │
│                                        │
│  Instrument → Collect → Export         │
└─────────────┬──────────────────────────┘
              │
     ┌────────▼────────┐
     │  OTel Collector  │
     └────────┬─────────┘
              │
    ┌─────────┼──────────┐
    ▼         ▼          ▼
 Jaeger   Zipkin    Datadog/Honeycomb
```

---

## Alerting

### Principles of Good Alerting

1. **Every alert must be actionable** — if you can't do anything about it, don't alert
2. **Alert on symptoms, not causes** — alert on user impact, not internal metrics
3. **Alerts should have runbooks** — clear escalation and remediation steps
4. **Avoid alert fatigue** — too many alerts → engineers ignore them → incidents missed

### Alert Types

#### Threshold Alerts
Simple static thresholds:
```
Alert if: cpu_usage > 90% for 5 minutes
Alert if: error_rate > 1% for 2 minutes
```

#### Anomaly Detection
Statistical deviation from baseline:
```
Alert if: request_rate drops > 3 standard deviations below 7-day rolling average
```

#### Rate of Change Alerts
```
Alert if: error_count increases by > 500% in 5 minutes
```

#### Composite Alerts
Multiple conditions:
```
Alert if: latency_p99 > 2s AND traffic > 1000 rps (high traffic makes latency impact significant)
```

### Alert Routing & On-Call

```
Alert fires
    │
    ▼
PagerDuty / OpsGenie
    │
    ├── P1 (Critical)  → Page on-call immediately
    ├── P2 (High)      → Page within 15 minutes
    ├── P3 (Medium)    → Slack notification
    └── P4 (Low)       → Ticket creation only
```

### Runbook Structure

```markdown
## Alert: High Database Connection Pool Exhaustion

### Impact
Orders cannot be processed; users see 503 errors.

### Investigation Steps
1. Check: `SELECT count(*) FROM pg_stat_activity;`
2. Look for long-running transactions: `pg_stat_activity WHERE state != 'idle'`
3. Check for connection leaks in order-service logs

### Remediation
- Immediate: Restart order-service pods to release connections
- Short-term: Increase pool_size in config
- Long-term: Audit for connection leaks in codebase

### Escalate To
- Database team if > 15 minutes unresolved
```

### Avoiding Alert Fatigue

| Problem | Solution |
|---------|----------|
| Too many low-priority alerts | Route to tickets, not pages |
| Flapping alerts | Add hysteresis (must be sustained for N minutes) |
| Duplicate alerts | Group by service/region; one page per incident |
| Noisy during deployments | Silence alerts during deploy windows |
| False positives | Tune thresholds, add context |

---

## Dashboards & Visualization

### Dashboard Hierarchy (USE Method)

**U**tilization – **S**aturation – **E**rrors

For every resource (CPU, memory, disk, network), track:
- **Utilization**: How busy is the resource? (%)
- **Saturation**: How much work is queued waiting? (queue depth)
- **Errors**: How often does the resource fail?

### Dashboard Tiers

```
┌──────────────────────────────────────────────────────────┐
│  TIER 1: Executive / Business Dashboard                  │
│  - Revenue, order volume, active users                   │
│  - SLA compliance, uptime %                              │
├──────────────────────────────────────────────────────────┤
│  TIER 2: Service Overview Dashboard                      │
│  - Golden signals per service                            │
│  - Dependency health                                     │
├──────────────────────────────────────────────────────────┤
│  TIER 3: Service Deep-Dive Dashboard                     │
│  - Detailed metrics per endpoint                         │
│  - Resource utilization, pool stats                      │
├──────────────────────────────────────────────────────────┤
│  TIER 4: Infrastructure Dashboard                        │
│  - Host-level CPU, RAM, disk, network                    │
│  - Container/pod metrics                                 │
└──────────────────────────────────────────────────────────┘
```

### Visualization Best Practices

- **Time-series graphs**: For rates, counts, gauges over time
- **Heatmaps**: For latency distributions (better than histograms for trends)
- **Status panels**: Green/yellow/red for service health
- **Scorecards**: Current value with trend vs. prior period
- **Alert annotations**: Mark alert firings on graphs for correlation

---

## Health Checks

### Types

#### Liveness Check
Is the process alive? (Should the container be restarted?)

```
GET /health/live
→ 200 OK: {"status": "alive"}
→ 500: crash → restart container
```

#### Readiness Check
Is the service ready to receive traffic? (Should it be in the load balancer pool?)

```
GET /health/ready
→ 200 OK: {"status": "ready", "db": "connected", "cache": "connected"}
→ 503: not ready → remove from LB pool
```

#### Startup Check (Kubernetes)
Has the service finished initializing? (Prevent premature liveness checks.)

```
GET /health/startup
→ 200 OK when init complete
```

### Deep Health Check

Validates all dependencies are reachable:

```json
GET /health/deep
{
  "status": "degraded",
  "checks": {
    "database": {"status": "ok", "latency_ms": 3},
    "redis":    {"status": "ok", "latency_ms": 1},
    "stripe":   {"status": "error", "error": "timeout"},
    "s3":       {"status": "ok", "latency_ms": 45}
  }
}
```

> **Warning**: Deep health checks that call external dependencies can cause cascading failures. Use timeouts and don't use them for liveness checks.

---

## SLIs, SLOs, and SLAs

### Service Level Indicator (SLI)
A quantitative measurement of a specific aspect of service behavior.

```
SLI = (good events / total events) × 100

Example:
SLI (availability) = (successful requests / total requests) × 100
SLI (latency)      = (requests < 200ms / total requests) × 100
```

### Service Level Objective (SLO)
An internal target for an SLI. The reliability goal your team commits to.

```
Availability SLO: 99.9% of requests succeed
Latency SLO:      99% of requests complete < 200ms
```

### Service Level Agreement (SLA)
A contractual commitment with customers. SLOs are stricter than SLAs to maintain buffer.

```
SLA: 99.5% monthly availability  ← what you promise users
SLO: 99.9% monthly availability  ← what you target internally
```

### Error Budget

The amount of unreliability allowed before violating an SLO.

```
SLO: 99.9% availability
Error budget: 100% - 99.9% = 0.1%

Per month (30 days):
0.001 × 30 × 24 × 60 = 43.2 minutes of allowed downtime
```

**Error budget policy**:
- Budget healthy → ship features, take risks
- Budget depleted → freeze releases, focus on reliability

### SLO Examples by Service Type

| Service | SLI | SLO |
|---------|-----|-----|
| API (user-facing) | Success rate | 99.95% |
| API (user-facing) | p99 latency < 500ms | 99% |
| Batch job | Completion within 1 hour | 99.5% |
| Data pipeline | Data freshness < 5 min | 99% |
| Storage | Durability | 99.9999999% |

---

## Monitoring Architecture Patterns

### Centralized Monitoring

```
All Services → Central Monitoring Platform
               (Datadog / New Relic / Grafana Cloud)
```

- **Pros**: Single pane of glass, easy correlation
- **Cons**: Single point of failure, vendor lock-in, cost at scale

### Federated / Hierarchical (Prometheus Style)

```
Local Prometheus (per datacenter)
        │
        │ remote_write / federation
        ▼
Global Prometheus / Thanos
        │
        ▼
Grafana
```

- **Pros**: Resilient, data locality, can query globally
- **Cons**: Operational complexity, multi-cluster management

### Agent-Based vs Agentless

| Model | How | Examples | Trade-offs |
|-------|-----|---------|------------|
| Agent-based | Daemon runs on each host, forwards metrics | Telegraf, Datadog agent, FluentD | More data, more control, resource overhead |
| Agentless | Metrics pulled directly, no software installed | Blackbox exporter, SNMP | Simpler, but less granular |

### Push vs Pull (Revisited in Architecture)

```
PULL (Prometheus model):              PUSH (StatsD/Graphite model):

  Prometheus ──scrape──▶ /metrics      App ──UDP──▶ StatsD ──▶ Graphite
                                            (fire-and-forget)
  ✓ Easy to detect dead services        ✓ Works for ephemeral processes
  ✓ No buffering needed                 ✗ Metric loss if collector down
  ✗ Requires service discovery          ✗ Hard to detect dead services
```

### Long-Term Storage Strategies

```
Short-term (hot):     Prometheus (15 days, local SSD)
          │
          │ remote_write
          ▼
Long-term (cold):     Thanos / Cortex / Mimir (1+ year, object store S3)
```

---

## Trade-offs

### 1. Granularity vs Cost

| Scrape Interval | Resolution | Storage Cost | Use Case |
|----------------|-----------|-------------|----------|
| 10s | High | High | Critical services, debugging |
| 60s | Medium | Medium | Standard production |
| 300s | Low | Low | Infrastructure, cost-sensitive |

**Trade-off**: Finer granularity catches brief spikes but multiplies storage and compute costs. 10s vs 60s scraping = ~6x more data points.

### 2. Cardinality vs Flexibility

High-cardinality labels allow fine-grained queries but:
- Can explode TSDB memory usage
- Slow down query performance
- Increase ingestion costs

**Trade-off**: Add labels judiciously. Use tracing (not metrics) for high-cardinality attributes like user IDs, order IDs.

### 3. Log Volume vs Insight

| Approach | Cost | Insight |
|----------|------|---------|
| Log everything | Very high | Maximum |
| Structured sampling | Medium | High (for sampled events) |
| Log only errors | Low | Limited (missed context) |

**Trade-off**: Logging every request at high QPS can cost more than the infrastructure being monitored. Use adaptive sampling.

### 4. Push vs Pull

| | Pull (Prometheus) | Push (StatsD) |
|--|---------|---------|
| Ephemeral jobs | ✗ Hard | ✓ Easy |
| Service discovery | Required | Not needed |
| Detecting dead services | ✓ Easy | ✗ Hard |
| Back-pressure | ✓ Automatic | ✗ None |
| Data loss on collector restart | ✓ Minimal | ✗ Possible |

### 5. Alerting Sensitivity

| Threshold | Effect |
|-----------|--------|
| Too sensitive | Alert fatigue; on-call burnout; real alerts ignored |
| Too lenient | Failures missed; SLA violations; user impact before detection |

**Trade-off**: Use multi-window, multi-burn-rate alerting (Google SRE approach) to catch both fast burns and slow burns.

### 6. Centralized vs Federated Monitoring

| | Centralized | Federated |
|--|------------|---------|
| Correlation across services | ✓ Easy | Harder |
| Blast radius (monitoring failure) | ✗ High | ✓ Contained |
| Cost | ✗ Can be expensive | ✓ More control |
| Operational complexity | ✓ Lower | ✗ Higher |
| Global query | ✓ Easy | Needs aggregation layer |

---

## Real-World Systems & Examples

### Google — SRE & SLOs
Google pioneered the SRE discipline and SLO/error-budget model. Their monitoring stack (Borgmon, predecessor to Prometheus) introduced the pull-based scraping model. Google uses multi-burn-rate alerting and manages hundreds of SLOs per service with automated budget tracking.

### Netflix — Atlas & Chaos Engineering
Netflix built **Atlas**, an in-memory time-series database designed for high-cardinality metrics at scale (billions of data points per minute). They pair monitoring with **Chaos Monkey** to proactively test failure resilience. Netflix monitors:
- Playback start failure rate (critical user-facing SLI)
- Stream health per region, device, CDN edge node
- Anomaly detection for video bitrate drops

### Uber — M3 & Jaeger
Uber built **M3**, an open-source metrics platform (Prometheus-compatible) designed for massive scale across thousands of microservices. For distributed tracing, they created **Jaeger** (now CNCF), which handles billions of spans per day. Uber uses tail-based sampling to capture all error traces while sampling success traces.

### Airbnb — Chronos & Real-Time Anomaly Detection
Airbnb uses Datadog for metrics and custom ML-based anomaly detection to monitor booking conversion rates. A dip in bookings at 2AM Pacific can be more significant than at peak hours — their alerting is time-aware.

### Stripe — Error Budget & Reliability
Stripe publishes public status pages and maintains internal SLOs per API endpoint. They use distributed tracing to debug latency issues in their payment processing pipeline, where a 100ms slowdown can translate to measurable revenue loss.

### AWS — CloudWatch & X-Ray
AWS CloudWatch handles metrics and logs for all AWS services. AWS X-Ray provides distributed tracing. They use composite alarms, metric math, and anomaly detection bands to minimize false positives at planetary scale.

### Twitter/X — Manhattan & Observability
Twitter built **Manhattan**, a distributed real-time key-value store with deep internal monitoring. During peak events (Super Bowl, elections), they pre-scale based on leading indicators — tweet rate acceleration — monitored in real time.

### Discord — Prometheus + Grafana at Scale
Discord runs Prometheus at scale with Thanos for long-term storage. They aggressively prune high-cardinality labels and monitor WebSocket connection health, latency per gateway server, and message delivery rates.

### Shopify — Dashboard-Driven Deploys
Shopify monitors golden signals for every service during deployments with automated rollback triggers. A deploy that increases p99 latency by >20% is automatically rolled back within 5 minutes.

---

## Tooling Ecosystem

### Metrics

| Tool | Type | Strengths |
|------|------|-----------|
| **Prometheus** | Open-source TSDB | Industry standard, pull-based, PromQL |
| **VictoriaMetrics** | Open-source TSDB | Prometheus-compatible, 10x more efficient |
| **InfluxDB** | Open-source TSDB | Push-based, strong query language (Flux) |
| **Datadog** | SaaS | All-in-one, easy setup, ML anomaly detection |
| **New Relic** | SaaS | Full-stack observability |
| **Thanos / Cortex / Mimir** | OSS HA layer | Long-term Prometheus storage at scale |

### Logging

| Tool | Type | Strengths |
|------|------|-----------|
| **ELK Stack** (Elasticsearch + Logstash + Kibana) | Open-source | Powerful search, rich visualizations |
| **Grafana Loki** | Open-source | Log aggregation, Prometheus-like model, cost-efficient |
| **Fluentd / Fluent Bit** | Open-source agents | Log collection, transformation |
| **Splunk** | Enterprise | Powerful querying, compliance features |
| **Datadog Logs** | SaaS | Integrated with metrics and traces |
| **AWS CloudWatch Logs** | Cloud | Native AWS integration |

### Distributed Tracing

| Tool | Type | Strengths |
|------|------|-----------|
| **Jaeger** | Open-source (CNCF) | Production-grade, Uber-born |
| **Zipkin** | Open-source | Lightweight, Twitter-born |
| **Tempo** | Open-source (Grafana) | Integrates with Loki/Prometheus |
| **Datadog APM** | SaaS | Low-config, rich flame graphs |
| **Honeycomb** | SaaS | High-cardinality, query-centric |
| **AWS X-Ray** | Cloud | Native AWS integration |

### Dashboards & Alerting

| Tool | Purpose |
|------|---------|
| **Grafana** | Metrics & log visualization (connects to most backends) |
| **PagerDuty** | On-call management, incident routing |
| **OpsGenie** | On-call management (acquired by Atlassian) |
| **Alertmanager** | Prometheus alerting, deduplication, grouping |

### OpenTelemetry (OTel)
The CNCF standard for vendor-neutral instrumentation. Provides SDKs for metrics, traces, and logs in all major languages. Replaces vendor-specific agents. Export to any backend.

---

## Decision Framework

### What monitoring stack should I choose?

```
Is this a startup / small team?
    └── YES → Datadog or New Relic (SaaS, low operational overhead)
    └── NO → Continue

Do you have the ops capacity to self-host?
    └── NO → Grafana Cloud / Datadog
    └── YES → Continue

High-scale, cost-sensitive, Kubernetes-native?
    └── YES → Prometheus + Thanos/Mimir + Grafana + Loki + Tempo (OSS stack)
    └── NO → Mix: Managed Prometheus + Grafana Cloud

Compliance / data residency requirements?
    └── YES → Self-hosted or private cloud deployment (VictoriaMetrics, ELK)
    └── NO → Any of the above
```

### What to alert on?

```
Does this alert indicate user impact?
    └── NO → Don't alert; use for dashboards only
    └── YES → Continue

Is there an action the on-call engineer can take?
    └── NO → Don't alert; create a ticket
    └── YES → Continue

Is this a P1 (revenue/safety impacting)?
    └── YES → Page immediately (PagerDuty)
    └── NO → Slack notification or ticket
```

### Logging vs Metrics vs Tracing — When to Use Which?

| Scenario | Tool |
|----------|------|
| "Is the service up?" | Metrics (uptime %) |
| "What's the p99 latency?" | Metrics (histogram) |
| "Why did this specific request fail?" | Logs + Traces |
| "Which service caused this slow request?" | Traces |
| "How many users hit this error today?" | Metrics + Logs |
| "What was the exact error message?" | Logs |
| "Is this a trend or a spike?" | Metrics |

---

## Anti-Patterns

### 1. Monitoring Only the Happy Path
Monitoring that only tracks successful requests misses the user experience when things go wrong. Always track error rates, not just throughput.

### 2. Averaging Latency
Averages hide tail latency. A p99 of 10s is invisible in an average of 50ms. **Always use percentiles (p95, p99, p999)**.

### 3. Alert on Every Metric
Leads to alert fatigue. On-call engineers start ignoring alerts. **Alert on user-impacting symptoms, not every internal metric.**

### 4. No Runbooks
Alerts without runbooks force on-call engineers to debug blind at 3AM. Every alert must have a linked runbook.

### 5. Unbounded Log Volume
Logging every request detail at 100K RPS generates terabytes per day. Use structured sampling, log levels, and retention policies.

### 6. High-Cardinality Labels in Metrics
Using user IDs or request IDs as Prometheus labels causes cardinality explosions, OOM crashes, and ingest failures.

### 7. Deep Health Checks for Liveness
A liveness check that calls a slow database can cause the container to be restarted when the DB is slow, creating cascading restarts across the fleet.

### 8. Monitoring Without SLOs
Without SLOs, there's no objective criteria for "is this good enough?" Teams either over-invest in reliability or ship broken experiences.

### 9. Siloed Observability
Metrics in one system, logs in another, traces in a third, with no correlation (trace IDs not present in logs, no log links from dashboards). Makes incident investigation slow.

### 10. Forgetting Business Metrics
Infrastructure metrics alone don't tell you business impact. A CPU spike is fine if revenue is flowing. Connect technical SLIs to business KPIs.

---

## Key Metrics to Monitor by Layer

### Application Layer
```
- Request rate (RPS/QPS)
- Error rate (5xx, 4xx)
- Latency (p50, p95, p99)
- Apdex score
- Active sessions
- Cache hit rate
- Queue depth & processing lag
```

### Service / API Layer
```
- Dependency call success rate
- Dependency latency
- Circuit breaker state (open/closed/half-open)
- Retry rate
- Timeout rate
- Connection pool utilization
```

### Database Layer
```
- Query latency (p50, p99)
- Queries per second
- Slow query count
- Active connections / pool utilization
- Replication lag
- Lock wait time
- Cache hit ratio (buffer pool)
- Deadlock rate
- Disk I/O utilization
```

### Cache Layer (Redis)
```
- Hit rate (> 90% is good)
- Miss rate
- Eviction rate
- Memory utilization
- Connected clients
- Command latency
- Keyspace hits/misses
```

### Message Queue (Kafka/RabbitMQ)
```
- Consumer lag (most important)
- Messages in / messages out rate
- Broker disk utilization
- Replication under-replicated partitions
- Producer/consumer error rate
```

### Infrastructure Layer
```
- CPU utilization (warn > 70%, alert > 85%)
- Memory utilization (warn > 80%, alert > 90%)
- Disk utilization (warn > 75%, alert > 90%)
- Network I/O (bytes in/out, packet loss, retransmits)
- File descriptor usage
- Load average
```

### Kubernetes Layer
```
- Pod restart count
- OOMKilled events
- CPU/memory request vs limit vs actual
- Node not ready count
- Pending pod count
- PVC usage
- API server latency
- etcd disk latency
```

---

## Summary: Monitoring Design Checklist

```
□ Instrument all services with the Four Golden Signals
□ Use structured logging with trace_id correlation
□ Implement distributed tracing (OpenTelemetry)
□ Define SLIs and SLOs for all user-facing services
□ Calculate and track error budgets
□ Create tiered dashboards (executive → service → infra)
□ Implement liveness and readiness health checks
□ Set up alert routing with severity levels and runbooks
□ Define log retention and sampling strategy
□ Choose centralized vs. federated monitoring architecture
□ Instrument business metrics alongside technical metrics
□ Use percentile-based (p99) not average latency
□ Audit label cardinality regularly
□ Test alerting regularly (chaos engineering / fire drills)
□ Correlate logs, metrics, and traces via trace IDs
```