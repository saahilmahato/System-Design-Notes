# Performance Monitoring

## 1. What is Performance Monitoring?

Performance Monitoring is the practice of **continuously collecting, aggregating, analyzing, and alerting** on metrics that describe how a system is behaving — its speed, reliability, resource usage, and correctness — so that engineers can detect degradations, diagnose root causes, and drive improvements proactively rather than reactively.

---

## 2. Why It Matters in System Design

- **Detect failures before users do** — SLO breaches can be caught before complaints arrive.
- **Capacity planning** — trend data informs when and how to scale.
- **Accountability** — SLAs with customers require proof of uptime and latency.
- **Root cause analysis (RCA)** — correlating metrics, traces, and logs cuts MTTR.
- **Regression detection** — deploys can silently degrade performance; monitoring catches it.

---

## 3. Core Pillars of Observability

```
┌─────────────────────────────────────────────────────────────┐
│                    OBSERVABILITY PILLARS                    │
├───────────────┬──────────────────┬──────────────────────────┤
│    METRICS    │      LOGS        │        TRACES            │
│               │                  │                          │
│ Aggregated    │ Timestamped      │ End-to-end request       │
│ numeric data  │ discrete events  │ flow across services     │
│               │                  │                          │
│ "What is      │ "What happened   │ "Where did the           │
│  happening?"  │  at this time?"  │  latency come from?"     │
│               │                  │                          │
│ Prometheus    │ Elasticsearch    │ Jaeger, Zipkin,          │
│ Datadog       │ Splunk           │ AWS X-Ray                │
│ CloudWatch    │ Loki             │ Datadog APM              │
└───────────────┴──────────────────┴──────────────────────────┘
```

> **Golden Rule**: Use metrics for alerting, logs for diagnosis, traces for root cause.

---

## 4. The Four Golden Signals (Google SRE)

| Signal | Description | Example Metric |
|--------|-------------|----------------|
| **Latency** | Time to serve a request (success vs. error latency tracked separately) | `p50`, `p95`, `p99` response time |
| **Traffic** | Demand placed on the system | Requests/sec, messages/sec, QPS |
| **Errors** | Rate of failed requests | HTTP 5xx rate, exception rate |
| **Saturation** | How "full" the system is | CPU %, memory %, queue depth |

> **Interview tip**: When asked "how do you monitor X?", default to the Four Golden Signals.

---

## 5. RED and USE Methods

### RED Method (for services / microservices)
- **R**ate — requests per second
- **E**rrors — failed requests per second
- **D**uration — latency distribution of those requests

### USE Method (for resources / infrastructure)
- **U**tilization — % time the resource is busy
- **S**aturation — work queue depth (extra work it can't serve yet)
- **E**rrors — error events (e.g., disk I/O errors, dropped packets)

```
USE → apply to: CPU, Memory, Disk, Network, Queues
RED → apply to: HTTP services, gRPC endpoints, DB query paths
```

---

## 6. Key Metrics by Layer

### 6.1 Application Metrics
```
- Request rate (QPS)
- Error rate (4xx, 5xx)
- Latency percentiles (p50, p95, p99, p999)
- Apdex score (user satisfaction score)
- Active sessions / concurrent users
- Cache hit rate
- Queue length and processing lag
- Background job success/failure/duration
```

### 6.2 Database Metrics
```
- Query execution time (avg, p95, p99)
- Slow query count (above threshold)
- Connection pool utilization (active/idle/waiting)
- Replication lag (for replica reads)
- Lock wait time / deadlock count
- Index hit ratio
- Rows read vs. rows returned (scan efficiency)
- Buffer/cache hit ratio
```

### 6.3 Infrastructure Metrics
```
- CPU utilization (user, system, iowait, steal)
- Memory usage (used, free, swap)
- Disk I/O (IOPS, throughput, await time)
- Network I/O (bytes in/out, packet loss, retransmits)
- File descriptors (open vs. limit)
- Thread pool saturation
- GC pause duration and frequency (JVM/Go)
```

### 6.4 Messaging / Queue Metrics
```
- Consumer lag (Kafka: offset lag per partition)
- Message throughput (produced/consumed per sec)
- Dead letter queue (DLQ) growth
- End-to-end delivery latency
- Re-delivery count
```

---

## 7. Metrics Collection Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      COLLECTION PIPELINE                         │
│                                                                  │
│  App/Service             Agent            Storage      Frontend  │
│  ──────────             ───────           ───────      ────────  │
│                                                                  │
│  [Service A] ──push──► [StatsD/    ]                             │
│  [Service B] ──pull──► [Prometheus ]──► [TSDB     ]──► [Grafana] │
│  [Service C] ──push──► [OTel Coll. ]    [Datadog  ]    [Kibana ] │
│  [Host OS  ] ──pull──► [Node Export]    [CloudWatch]   [PagerD.] │
│  [Kafka    ] ──pull──► [JMX Export ]                             │
│                                                                  │
│  Pull model: Prometheus scrapes endpoints                        │
│  Push model: App pushes to aggregator (StatsD, InfluxDB)         │
└──────────────────────────────────────────────────────────────────┘
```

### Pull vs. Push

| Aspect | Pull (Prometheus) | Push (StatsD / Datadog agent) |
|--------|-------------------|-------------------------------|
| Discovery | Scrape config / service discovery | Agent knows targets |
| Firewall | Scraper needs network access to targets | Agent pushes out, easier in NAT |
| Short-lived jobs | Misses if job ends before scrape | Works via pushgateway |
| Complexity | Needs scrape config | Agent config per host |
| Common in | Kubernetes, on-prem | SaaS, serverless, ephemeral infra |

---

## 8. Time-Series Data and Cardinality

Metrics are stored in **time-series databases (TSDB)**: each metric is a unique combination of `(metric_name, label_set)`.

```
http_requests_total{service="checkout", method="POST", status="200"} 1024
http_requests_total{service="checkout", method="POST", status="500"} 3
```

### Cardinality Problem
High-cardinality labels explode the number of time series:

```
BAD:  http_requests_total{user_id="12345"}   ← millions of users = millions of series
GOOD: http_requests_total{status="500"}       ← bounded set of values
```

> **Rule**: Never use unbounded values (user IDs, UUIDs, IP addresses) as metric labels. Move them to logs/traces.

---

## 9. Alerting Design

### Alert Hierarchy

```
SYMPTOM-BASED (user-facing) ─── preferred for paging
   └── "p99 latency > 500ms for 5 minutes"
   └── "error rate > 1% for 2 minutes"

CAUSE-BASED (internal)  ─── preferred for tickets/investigation
   └── "CPU > 90% for 10 minutes"
   └── "Replication lag > 30s"
```

### SLO-Based Alerting (Multi-Window)
```
Fast burn:  error budget burned 14x in last 1h  → page immediately
Slow burn:  error budget burned 6x in last 6h   → ticket / urgent
Trend:      error budget burned 3x in last 3d   → backlog
```

### Alert Fatigue Avoidance
- Only page on **user-visible symptoms**
- Use **inhibition** (suppress downstream alerts when upstream is down)
- Use **deduplication** (group related alerts)
- Define **runbooks** for every alert

---

## 10. SLIs, SLOs, and SLAs

```
SLI (Service Level Indicator)
  └── A quantitative measure of a service dimension
  └── e.g., "fraction of valid requests served in < 200ms"

SLO (Service Level Objective)
  └── Target value for an SLI, internal agreement
  └── e.g., "99.9% of requests in < 200ms over a 30-day window"

SLA (Service Level Agreement)
  └── External contractual commitment with penalties
  └── e.g., "99.5% monthly uptime or 10% credit issued"
```

### Error Budget
```
SLO = 99.9%  →  Error budget = 0.1% = 43.8 min/month downtime allowed

If budget is consumed:   freeze features, focus on reliability
If budget is healthy:    ship faster, take more risk
```

---

## 11. Distributed Tracing

### How it works
```
User Request
│
├─► [API Gateway]        trace_id=abc, span_id=001, duration=120ms
│        │
│        ├─► [Auth Service]    trace_id=abc, span_id=002, duration=8ms
│        │
│        └─► [Order Service]   trace_id=abc, span_id=003, duration=105ms
│                 │
│                 ├─► [Inventory DB]  trace_id=abc, span_id=004, duration=80ms
│                 │
│                 └─► [Payment RPC]  trace_id=abc, span_id=005, duration=20ms
```

- **Trace**: One request's full journey across services
- **Span**: A single unit of work (one service call)
- **Context propagation**: `trace_id` passed via HTTP headers (`X-B3-TraceId`, W3C `traceparent`)

### Sampling Strategies
| Strategy | Description | Use Case |
|----------|-------------|----------|
| Head-based | Decision made at trace entry | Simple, low overhead |
| Tail-based | Decision after full trace collected | Capture errors & slow requests |
| Rate-based | Sample N% of all traces | Volume control |
| Adaptive | Dynamic sampling by endpoint/error | Best of both |

---

## 12. Dashboards and Visualization

### Dashboard Design Principles
- **Top of dashboard**: SLO status, error budget burn, user-visible health
- **Middle**: Service RED metrics per endpoint
- **Bottom**: Infrastructure USE metrics
- Use **heatmaps** for latency distributions (not just averages)
- Use **rate of change** graphs for trend detection
- Separate **overview** (NOC/on-call) from **debug** (deep-dive) dashboards

### Latency Histogram vs. Summary
| | Histogram | Summary |
|--|-----------|---------|
| Quantiles | Computed at query time (flexible) | Pre-computed (fixed) |
| Aggregation across instances | ✅ Possible | ❌ Not safe |
| Client cost | Low | High (quantile estimation) |
| Prometheus recommendation | Prefer histogram | Avoid for aggregated quantiles |

---

## 13. Trade-offs

| Decision | Option A | Option B | Consideration |
|----------|----------|----------|---------------|
| **Alert on symptoms vs. causes** | Symptom (latency up) | Cause (CPU high) | Symptom = fewer false positives; cause = earlier warning |
| **Pull vs. Push metrics** | Pull (Prometheus) | Push (StatsD) | Pull better for long-running; push for ephemeral |
| **Sampling rate (traces)** | 100% (all traces) | 1-10% (sampled) | 100% = accurate but expensive; sampling = cost control |
| **Metric cardinality** | Rich label sets | Sparse labels | High cardinality = flexible but expensive in TSDB |
| **Centralized vs. distributed monitoring** | Central collector | Agent per service | Centralized = simpler ops; distributed = lower latency, more resilient |
| **Aggregated metrics vs. raw events** | Pre-aggregated (counters) | Raw events (logs) | Metrics = fast query, low storage; logs = full detail, expensive |
| **Alert precision vs. recall** | Precise (fewer false positives) | High recall (miss nothing) | Over-alerting causes fatigue; under-alerting causes blindspots |
| **SLO window: rolling vs. calendar** | Rolling 30-day | Calendar month | Rolling = more sensitive to recent events; calendar = easier billing |

---

## 14. Real-World Examples

### Netflix
- Operates **Atlas**, a custom in-memory time-series database built for extreme scale (billions of metrics/min).
- Uses **Kayenta** for automated canary analysis — compares metrics between canary and baseline to decide if a deploy is safe.
- Employs **Chaos Monkey / Simian Army** to proactively trigger failures and verify monitoring surfaces them.
- All microservices emit RED metrics; dashboards auto-generated from service metadata.

### Uber
- Built **M3DB**, an open-source distributed TSDB for storing petabytes of metrics with high write throughput.
- Uses **Jaeger** (open-sourced by Uber) for distributed tracing across hundreds of microservices.
- Alerts on **ride request P99 latency** across geographies independently; regional degradation doesn't mask global averages.
- Run **dynamic SLOs** that adjust based on city, time-of-day, and event context.

### Stripe
- Monitors **payment API p99 latency** and **error rates** per payment method, currency, and bank — high cardinality managed via aggregation layers.
- Uses **multi-window, multi-burn-rate alerting** tightly coupled to error budget consumption.
- Engineers on-call get runbooks automatically linked to alerts; no alert fires without a documented response.
- Tracks **idempotency key collision rate** and **retry amplification factor** as custom business metrics.

### Shopify
- Monitors **Flash Sale readiness** — pre-event capacity checks fire synthetic traffic and compare against thresholds.
- Uses **Grafana + Prometheus** extensively at the platform level; Datadog for APM in application layer.
- Tracks **checkout funnel conversion rate** as an SLI — not just technical latency but business correctness.
- Maintains a **"degraded mode" dashboard** showing which features are turned off during incidents.

### Discord
- Monitors **WebSocket connection counts** and **message delivery latency** as primary SLIs (chat delivery SLO < 100ms p99).
- Migrated from Cassandra to ScyllaDB partly driven by **monitoring data showing GC pause spikes** in Cassandra under load.
- Uses **Prometheus + Grafana** with per-guild aggregation; guild_id is bucketed to avoid cardinality explosion.
- Maintains **golden path dashboards** — one per critical user journey (send message, join voice, login).

### Google
- Pioneered the **Four Golden Signals** methodology documented in the SRE Book.
- **Borgmon** (internal predecessor to Prometheus) was the model for modern metric-based monitoring.
- Uses **Dapper** (internal) for distributed tracing — inspired OpenTelemetry and Zipkin.
- SLO-based error budgets are the primary mechanism for feature velocity vs. reliability balance.

### Cloudflare
- Monitors **DNS query latency globally** across 300+ PoPs; regional SLOs independently tracked.
- Uses **Prometheus + Thanos** (long-term storage layer for Prometheus) to query months of metrics.
- Real-time traffic dashboards show **DDoS detection signals** — packet rate anomalies, source IP diversity, protocol distribution.

---

## 15. Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Monitoring the average** | Averages hide tail latency; p99 issues invisible | Use percentiles (p95, p99, p999) |
| **Alert on everything** | Alert fatigue; on-call ignores pages | Alert only on user-visible symptoms |
| **No runbooks** | Responder doesn't know what to do | Every alert links to a runbook |
| **High-cardinality labels** | TSDB OOM or cost explosion | Use logs/traces for high-cardinality dimensions |
| **Dashboard sprawl** | Too many dashboards, none trusted | Maintain 1 golden dashboard per service |
| **Monitoring only the happy path** | Errors not caught until users complain | Explicitly monitor error rates and edge cases |
| **Treating all errors equally** | Transient retries ≠ hard failures | Separate retry-resolved errors from user-visible failures |
| **No baseline** | Can't tell what "normal" looks like | Capture week-over-week, time-of-day baselines |
| **Missing dependencies** | DB fails silently, app looks degraded | Monitor downstream health, not just your own service |
| **Synthetic only** | Lab perf ≠ production reality | Combine synthetic + real user monitoring (RUM) |

---

## 16. Tooling Reference

| Category | Tools |
|---|---|
| **Metrics collection** | Prometheus, StatsD, Datadog Agent, CloudWatch Agent, OpenTelemetry Collector |
| **TSDB storage** | Prometheus (local), Thanos/Cortex/Mimir (long-term), InfluxDB, M3DB, TimescaleDB |
| **Tracing** | Jaeger, Zipkin, AWS X-Ray, Datadog APM, Honeycomb, Tempo |
| **Logging** | Elasticsearch + Logstash + Kibana (ELK), Grafana Loki, Splunk, Datadog Logs |
| **Dashboards** | Grafana, Datadog, Kibana, AWS CloudWatch Dashboards |
| **Alerting** | Alertmanager (Prometheus), PagerDuty, OpsGenie, VictorOps |
| **APM** | Datadog APM, New Relic, Dynatrace, AppDynamics |
| **Synthetic monitoring** | Pingdom, Checkly, AWS Synthetics, Datadog Synthetics |
| **RUM** | Datadog RUM, New Relic Browser, Sentry Performance |

---

## 17. Interview Decision Framework

```
When asked "How would you monitor system X?":

1. Define SLIs
   └─► What does "healthy" mean to a user of this system?
   └─► Latency? Correctness? Availability?

2. Set SLOs
   └─► 99.9%? 99.99%? (Each 9 = 10x more engineering cost)
   └─► Error budget = 1 - SLO

3. Identify the Four Golden Signals for your service
   └─► Traffic, Latency, Errors, Saturation

4. Add domain-specific metrics
   └─► Queue lag, cache hit rate, DB replication lag, etc.

5. Design alerting
   └─► Symptom-based, SLO burn rate alerts
   └─► Link to runbooks

6. Add traces for root cause
   └─► Instrument critical paths
   └─► Sample intelligently (tail-based for errors)

7. Centralize logs
   └─► Structured logging (JSON)
   └─► Correlation via trace_id

8. Build dashboards
   └─► Overview → Service → Infrastructure hierarchy
```

---

## 18. Monitoring in Microservices vs. Monolith

| Aspect | Monolith | Microservices |
|---|---|---|
| **Tracing** | Simple call stack | Distributed tracing required |
| **Alerting** | One service to watch | Per-service SLOs; cascading failure detection |
| **Metric volume** | Low | High (per service, per endpoint) |
| **Root cause** | Log search + profiler | Traces + service dependency maps |
| **Deployment impact** | One deploy, one signal | Canary per service; independent signals |
| **Dashboard** | One dashboard | Service catalog with auto-generated dashboards |

---