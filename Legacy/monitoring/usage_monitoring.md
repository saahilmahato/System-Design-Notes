# Usage Monitoring

## Table of Contents
1. [What is Usage Monitoring?](#what-is-usage-monitoring)
2. [Core Concepts](#core-concepts)
3. [Key Metrics to Monitor](#key-metrics-to-monitor)
4. [Architecture Patterns](#architecture-patterns)
5. [Data Collection Strategies](#data-collection-strategies)
6. [Storage & Aggregation](#storage--aggregation)
7. [Alerting & Anomaly Detection](#alerting--anomaly-detection)
8. [Trade-offs](#trade-offs)
9. [Real-World Examples](#real-world-examples)
10. [Anti-Patterns](#anti-patterns)
11. [Decision Framework](#decision-framework)
12. [Key Metrics for the Monitoring System Itself](#key-metrics-for-the-monitoring-system-itself)

---

## What is Usage Monitoring?

Usage Monitoring is the practice of **tracking, measuring, and analyzing how resources, features, and services are consumed** across a system — by users, tenants, services, or infrastructure components.

It serves two distinct purposes:

| Purpose | Description |
|---|---|
| **Operational** | Understand system health, detect anomalies, prevent abuse |
| **Business** | Drive billing, quota enforcement, capacity planning, product decisions |

Usage monitoring sits at the intersection of **observability** (what is the system doing?) and **metering** (how much has been consumed?).

---

## Core Concepts

### Metering vs. Monitoring
- **Metering**: Counting and recording discrete units of consumption (API calls, storage bytes, compute hours). Accuracy is critical — often tied to billing.
- **Monitoring**: Observing system behavior over time (latency, error rates, saturation). Approximate is acceptable.

### Granularity
```
Fine-grained (per-request)  →  Higher accuracy, higher cost, harder to scale
Coarse-grained (aggregated) →  Cheaper, faster, loses detail
```

### Push vs. Pull Collection
- **Push**: Services emit events/metrics to a central collector (e.g., StatsD, Kafka).
- **Pull**: Collector scrapes endpoints on a schedule (e.g., Prometheus).

### Real-time vs. Batch
- **Real-time**: Low latency visibility, used for alerting and quota enforcement.
- **Batch**: Higher throughput, used for billing, reporting, and analytics.

---

## Key Metrics to Monitor

### Resource Usage
| Metric | Examples | Use Case |
|---|---|---|
| **Compute** | CPU %, vCPU hours | Billing, scaling |
| **Memory** | RAM usage, heap size | Capacity planning |
| **Storage** | Disk bytes, object count | Quota enforcement |
| **Network** | Ingress/egress bytes | Billing, throttling |

### API & Feature Usage
| Metric | Examples | Use Case |
|---|---|---|
| **Request count** | API calls per user/tenant | Rate limiting, billing |
| **Feature adoption** | Feature X used N times | Product analytics |
| **Error rate** | 4xx/5xx per endpoint | Health, SLA tracking |
| **Latency percentiles** | p50, p95, p99 | SLA enforcement |

### Business/Tenant Metrics
| Metric | Examples | Use Case |
|---|---|---|
| **Active users** | DAU, MAU | Growth, capacity |
| **Quota utilization** | % of plan limit consumed | Upsell triggers |
| **Churn signals** | Drop in usage patterns | Retention |

---

## Architecture Patterns

### Pattern 1: Sidecar / Interceptor

```
Client → [Sidecar / Middleware] → Service
                   ↓
            Usage Events → Message Queue → Aggregator → Storage
```

- Sidecar intercepts all requests/responses and emits usage events.
- Decouples usage tracking from business logic.
- Used by: Envoy proxy, AWS API Gateway.

### Pattern 2: Event-Driven Pipeline

```
Service → Produce Event → Kafka / Kinesis → Stream Processor (Flink/Spark)
                                                      ↓
                                          Real-time Store (Redis)
                                          + Cold Store (S3 / BigQuery)
```

- Events contain full context: tenant ID, resource type, amount, timestamp.
- Stream processor handles aggregation, deduplication, and routing.

### Pattern 3: Agent-Based Collection

```
Host Agent (Datadog Agent / Prometheus Node Exporter)
    ↓ scrape
Local Metrics → Push/Pull → Central Time-Series DB (Prometheus, InfluxDB, M3)
                                        ↓
                                  Dashboards + Alerts
```

- Lightweight agent runs on each host, collects system-level metrics.
- Good for infrastructure-level usage (CPU, memory, disk I/O).

### Pattern 4: SDK / Client-Side Instrumentation

```
Application Code → SDK (OpenTelemetry)
                       ↓
              Traces + Metrics + Logs → Collector → Backend
```

- OpenTelemetry is the de facto standard for vendor-neutral instrumentation.
- SDK batches, samples, and exports telemetry asynchronously.

---

## Data Collection Strategies

### Sampling
Collecting every event at scale is prohibitively expensive. Sampling reduces volume while maintaining statistical accuracy.

| Strategy | Description | Best For |
|---|---|---|
| **Head-based sampling** | Decision made at trace start | Simple, consistent traces |
| **Tail-based sampling** | Decision made after trace completes | Keep errors & slow requests |
| **Adaptive sampling** | Rate adjusts based on traffic volume | High-cardinality endpoints |
| **Reservoir sampling** | Fixed-size random sample | Fixed storage budgets |

> **Rule**: Never sample billing-critical events. Always sample trace/profiling data.

### Deduplication
Distributed systems produce duplicate events (retries, at-least-once delivery). Must deduplicate before billing.

- **Idempotency keys** on events.
- **Exactly-once semantics** in stream processors (Kafka transactions, Flink checkpointing).
- **Dedup window**: Deduplicate within a time window (e.g., 24 hours).

### Batching & Buffering
```
Client SDK → In-memory buffer → Flush every N events OR every T seconds
                 ↓ (on crash)
          Persistent local queue (disk-based WAL)
```

- Batching reduces network overhead and downstream pressure.
- Local WAL prevents data loss on crashes.

---

## Storage & Aggregation

### Time-Series Databases (TSDB)
For real-time operational metrics.

| Database | Best For | Notes |
|---|---|---|
| **Prometheus** | Infrastructure metrics, alerting | Pull-based, 15s scrape |
| **InfluxDB** | IoT, high-frequency metrics | Push-based |
| **TimescaleDB** | SQL over time-series (PostgreSQL ext.) | Rich querying |
| **M3DB** | Uber-scale Prometheus-compatible | Used at Uber |
| **Druid** | OLAP queries on event streams | Used at Netflix, Twitter |

### Cold Storage / Analytical Store
For billing, historical reports, capacity planning.

```
Raw Events → S3 / GCS (Parquet / ORC)
                 ↓
         Query Engine: Presto / Athena / BigQuery / Snowflake
```

### Pre-Aggregation Strategy

```
Raw events → Minute-level rollup → Hour-level rollup → Day-level rollup
    ↑               ↑                     ↑                   ↑
High cost        Medium cost           Low cost           Lowest cost
High fidelity    Good fidelity         Good for billing   Good for trends
```

- Store raw events short-term (hours/days), aggregates long-term (months/years).
- Typical retention: raw = 7 days, minute rollup = 30 days, hourly = 1 year.

### Quota Enforcement with Redis

```
Incoming Request
       ↓
INCR usage:{tenant_id}:{resource}:{window} in Redis
       ↓
Compare against quota limit
       ↓ (over limit)
Return 429 Too Many Requests
```

- Use **sliding window** (more accurate) or **fixed window** (simpler, cheaper).
- Redis TTL on keys to auto-expire counters.
- Lua scripts for atomic increment + check.

---

## Alerting & Anomaly Detection

### Threshold-Based Alerts
Simple, low latency, but brittle with seasonal patterns.

```yaml
# Example: Prometheus alert rule
- alert: HighErrorRate
  expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: "Error rate > 5% for 2 minutes"
```

### Anomaly Detection
For dynamic baselines where static thresholds fail.

| Technique | How It Works | Use Case |
|---|---|---|
| **Seasonal decomposition** | Separate trend, season, residual | API traffic patterns |
| **Z-score** | Deviation from rolling mean | Simple spike detection |
| **Percentile bands** | Alert when outside p95 range | Latency regressions |
| **ML models (ARIMA, LSTM)** | Learn complex seasonality | Billing anomaly detection |

### Alert Fatigue Mitigation
- **Alert grouping**: Group related alerts into single notifications.
- **Deduplication**: Don't re-fire the same alert repeatedly.
- **Inhibition rules**: Suppress lower-priority alerts when a root cause fires.
- **Silencing**: Mute during planned maintenance.
- Tools: PagerDuty, OpsGenie, Alertmanager.

---

## Trade-offs

### Accuracy vs. Cost

| Approach | Accuracy | Cost | Latency |
|---|---|---|---|
| Per-event tracking (no sampling) | 100% | Very High | Low |
| Sampled tracking (1%) | ~Statistical | Low | Low |
| Pre-aggregated counters | High (no sampling loss) | Medium | Low |
| Batch aggregation | High | Low | High (minutes-hours) |

> **Decision**: Use exact counting for billing; use sampling for operational traces.

### Real-Time vs. Batch

| Dimension | Real-Time | Batch |
|---|---|---|
| Quota enforcement | ✅ Yes (must be real-time) | ❌ No |
| Billing | Approximate only | ✅ More accurate |
| Cost | High (stream infra) | Low |
| Latency | Seconds | Minutes to hours |
| Complexity | High | Medium |

### Centralized vs. Federated Collection

| Model | Pros | Cons |
|---|---|---|
| **Centralized** | Single source of truth, easy correlation | Single point of failure, network bottleneck |
| **Federated** | Resilient, local isolation | Hard to get global view, duplicate infra |
| **Hybrid** | Balance of both | Most complex to operate |

> Large companies (Uber, Netflix) run federated collection with a global aggregation tier.

### Push vs. Pull

| Dimension | Push (e.g., StatsD, Kafka) | Pull (e.g., Prometheus) |
|---|---|---|
| **Latency** | Lower (event-driven) | Bounded by scrape interval |
| **Back-pressure** | Service decides when to send | Collector controls load |
| **Discovery** | Harder — must know targets | Easy with service discovery |
| **Reliability** | Data lost if collector down | Collector retries |
| **Firewall-friendly** | ✅ (outbound) | ❌ (inbound needed) |

### Granularity vs. Cardinality

High-cardinality labels (e.g., `user_id`, `request_id`) explode TSDB storage:

```
# BAD: Unlimited cardinality
http_requests_total{user_id="u-12345"} 42   ← millions of series

# GOOD: Aggregate cardinality, track users elsewhere
http_requests_total{tenant="acme", endpoint="/v1/process"} 42
```

- Prometheus can handle ~millions of series; beyond that, use Thanos, Cortex, or Mimir.

---

## Real-World Examples

### Stripe — Billing Metering Pipeline
- Every API call emits an event to an internal Kafka topic.
- A stream processor aggregates calls by API key, endpoint, and billing period.
- Pre-aggregated counters are checkpointed in PostgreSQL for billing queries.
- Real-time Redis counters enforce rate limits per API key.
- Stripe uses **idempotency keys** on all metering events to prevent double-billing.

### AWS — CloudWatch & Usage-Based Billing
- Every AWS service emits usage records to an internal bus.
- Usage records flow through a multi-stage pipeline: ingestion → dedup → aggregation → billing DB.
- CloudWatch stores metrics as time-series with 1-second resolution, with automatic rollup to 1-min, 5-min, 1-hour.
- Detailed Billing Reports available in S3 as CSVs — raw event data for enterprise customers.

### Uber — M3 & Operational Monitoring
- Uber built **M3**, an open-source distributed TSDB, to handle Prometheus at scale (billions of time series).
- Each city/region runs a local Prometheus; M3 provides global aggregation and long-term storage.
- Usage data feeds capacity planning models to predict surge demand by city.
- Kafka carries all driver/rider event streams; Flink aggregates for real-time dashboards.

### Netflix — Atlas & Telemetry
- Netflix built **Atlas** for in-memory time-series at massive scale.
- All microservices report metrics to a regional Atlas cluster using a push-based model.
- Spectator client library handles batching, buffering, and retry.
- Usage data feeds A/B testing systems — feature usage by cohort.
- Iceberg tables on S3 store historical usage for cost attribution.

### Shopify — Multi-Tenant API Rate Limiting
- Each Shopify store (merchant) has API usage tracked per billing plan.
- API requests go through a reverse proxy that increments Redis counters.
- Counters use a **leaky bucket** algorithm: allow bursts, smooth sustained traffic.
- Quota utilization shown in merchant dashboard in near-real-time.
- Exceeding quota returns `429` with `Retry-After` header.

### GitHub — Actions & Compute Metering
- GitHub Actions charges per minute of compute.
- Each runner emits start/stop events with job metadata.
- A billing pipeline aggregates minutes by org/repo/workflow.
- Usage visible in billing dashboard within ~5 minutes (near-real-time).
- Hard limits enforced at the runner allocation layer — jobs don't start if over quota.

### Discord — Telemetry at 4M Concurrent Users
- Discord uses a **push-based StatsD pipeline** for high-frequency metrics (message counts, presence updates).
- Metrics aggregate at the StatsD relay tier before flowing into InfluxDB.
- Grafana dashboards provide per-guild, per-channel usage breakdowns.
- Rust-based services emit extremely low-overhead counters — latency budget for metrics < 1ms.

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Synchronous billing writes** | Adds latency to every request | Async via queue; fire-and-forget |
| **High-cardinality labels in TSDB** | Metric explosion, OOM | Aggregate by tenant, not user |
| **No deduplication** | Double billing, inflated counts | Idempotency keys + dedup window |
| **Sampling billing events** | Inaccurate invoices, legal risk | Never sample billing-critical data |
| **Unbounded retention of raw events** | Storage cost explosion | Tiered retention + rollups |
| **Single-region monitoring** | Monitoring goes down with the region | Multi-region collection + global view |
| **Alert on every spike** | Alert fatigue, on-call burnout | Deadband, anomaly-based thresholds |
| **Tracking everything at max fidelity** | CPU/network overhead on hot paths | Sample traces, count everything |
| **No quota enforcement at ingress** | Runaway tenants starve others | Enforce at API gateway, not service |

---

## Decision Framework

```
START
  │
  ▼
Is the data used for BILLING?
  ├── YES → Exact counting, no sampling, dedup required
  │         Use: Kafka + stream processor + RDBMS
  │
  └── NO → Is it for REAL-TIME alerts or quota enforcement?
              ├── YES → Real-time counters in Redis / TSDB
              │         Sampling acceptable (tail-based)
              │
              └── NO → Is it OPERATIONAL OBSERVABILITY?
                          ├── YES → Prometheus / Atlas with sampling
                          │         Short retention, rollups
                          │
                          └── NO (Analytics / Product) →
                                Batch pipeline → Data warehouse
                                BigQuery / Snowflake / Redshift
```

---

## Key Metrics for the Monitoring System Itself

The monitoring system must monitor itself (meta-monitoring):

| Metric | What It Tells You |
|---|---|
| **Event ingestion lag** | How far behind real-time is the pipeline |
| **Event drop rate** | Data loss in the collection tier |
| **Dedup hit rate** | How many duplicates are arriving |
| **Counter flush latency** | Time from event to queryable metric |
| **TSDB cardinality** | Risk of OOM on metric store |
| **Alert evaluation latency** | How quickly alerts fire after threshold breach |
| **Storage cost per metric** | Cost efficiency of retention policy |

---

## Quick Reference — Technology Choices

| Need | Tool |
|---|---|
| Real-time counters & quota | Redis (INCR + TTL) |
| Operational metrics & alerts | Prometheus + Grafana |
| Metrics at Uber/Netflix scale | Thanos / M3 / Cortex / Atlas |
| Distributed tracing | Jaeger, Zipkin, Tempo |
| Event pipeline | Kafka, Kinesis, Pub/Sub |
| Stream processing | Flink, Spark Streaming |
| Analytics / billing store | BigQuery, Snowflake, Redshift |
| APM (all-in-one) | Datadog, New Relic, Dynatrace |
| Instrumentation standard | OpenTelemetry (OTel) |
| Log aggregation | ELK Stack, Loki, Splunk |