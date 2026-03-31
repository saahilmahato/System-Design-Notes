# Monitoring: Visualization & Alerts

---

## 1. Overview

Visualization and alerting are the **human-facing layers** of an observability stack. Raw metrics, logs, and traces are machine data — visualization turns them into actionable insight, and alerting ensures engineers are notified before users notice a problem.

```
┌─────────────────────────────────────────────────────────────┐
│                  OBSERVABILITY STACK                        │
│                                                             │
│  Instrumentation → Collection → Storage → Visualization     │
│        ↑                                        ↓           │
│   (code, agents,                           Dashboards       │
│    exporters)                              Alert Rules       │
│                                                 ↓           │
│                                         On-Call Engineer    │
└─────────────────────────────────────────────────────────────┘
```

**Key goals:**
- Detect degradation **before** users report it
- Reduce Mean Time to Detect (MTTD) and Mean Time to Resolve (MTTR)
- Provide enough context so engineers can diagnose without guessing
- Avoid alert fatigue — noisy alerts are as dangerous as no alerts

---

## 2. Visualization

### 2.1 Dashboard Types

| Dashboard Type      | Purpose                                      | Audience           |
|---------------------|----------------------------------------------|--------------------|
| **Service Health**  | RED metrics (Rate, Errors, Duration)         | On-call engineers  |
| **Infrastructure**  | CPU, memory, disk, network per host/pod      | SREs, platform     |
| **Business KPIs**   | Revenue/min, signups, conversion rates       | Engineering + Exec |
| **SLO Dashboards**  | Error budget burn rate, remaining budget     | SRE, product       |
| **Trace Explorer**  | Distributed trace waterfalls per request     | Developers         |
| **Log Explorer**    | Filtered log streams with context            | Developers, SREs   |

### 2.2 The RED Method (Service-Level Dashboards)

```
RED = Rate + Errors + Duration

┌─────────────────────┬───────────────────────────────────────────┐
│ Rate                │ Requests per second (RPS / QPS)           │
│ Errors              │ % of requests returning 5xx or failing    │
│ Duration            │ Latency: p50, p95, p99, p999              │
└─────────────────────┴───────────────────────────────────────────┘
```

> Use RED for **every service** at every layer. If a dashboard doesn't have RED, it's incomplete.

### 2.3 The USE Method (Infrastructure/Resource Dashboards)

```
USE = Utilization + Saturation + Errors

┌───────────────────┬─────────────────────────────────────────────┐
│ Utilization       │ % time resource is busy (CPU %, disk IOPS %)│
│ Saturation        │ Queue depth, backlog, wait time             │
│ Errors            │ Hardware errors, network drops, disk faults │
└───────────────────┴─────────────────────────────────────────────┘
```

### 2.4 Visualization Best Practices

**Latency — always use percentiles, never averages:**
```
❌  avg(latency)       → hides tail latency, misleads on SLO compliance
✅  p50, p95, p99      → shows actual user experience distribution
✅  p999               → catches worst-case outliers at scale
```

**Time ranges:**
- Live dashboards: last 15–30 min, 10s–1min resolution
- Incident review: last 3 hrs, 30s resolution
- Weekly SLO review: 7–30 days, 1h resolution

**Color conventions (consistent across org):**
```
Green  → healthy, within SLO
Yellow → warning, approaching threshold
Red    → critical, SLO breached or system degraded
Grey   → no data / stale
```

**Panel layout — top to bottom, macro to micro:**
```
Row 1: Overall system health (synthetic/uptime checks)
Row 2: Service-level RED metrics
Row 3: Dependency health (DB, cache, queues)
Row 4: Infrastructure (CPU, memory, pods)
Row 5: Business metrics
```

### 2.5 Visualization Tools

| Tool           | Type             | Strengths                                    | When to Use                              |
|----------------|------------------|----------------------------------------------|------------------------------------------|
| **Grafana**    | Open-source      | Flexible, multi-datasource, templating       | Primary dashboard layer for most stacks  |
| **Datadog**    | SaaS             | APM + infra + logs in one UI, fast onboarding| Teams wanting unified SaaS observability |
| **Kibana**     | Open-source      | ELK-native, excellent log exploration        | Log-heavy analysis on Elasticsearch      |
| **Prometheus** | Open-source      | Native PromQL visualization (basic)          | Lightweight, k8s-native setups           |
| **New Relic**  | SaaS             | Full-stack tracing, NRQL query language      | App-centric monitoring                   |
| **Honeycomb**  | SaaS             | High-cardinality event exploration           | Distributed tracing, debugging prod      |
| **CloudWatch** | AWS SaaS         | Native AWS integration, dashboards + logs    | AWS-heavy workloads                      |

---

## 3. Alerting

### 3.1 Alert Anatomy

Every alert should answer:

```
┌──────────────────────────────────────────────────────────────┐
│  WHAT  → Which service/component is affected?                │
│  WHY   → What metric/condition triggered this?               │
│  HOW BAD → Severity: P1 (critical) → P4 (low)               │
│  WHERE → Dashboard link, runbook link, affected region       │
│  SINCE → When did this start? Duration of the condition      │
└──────────────────────────────────────────────────────────────┘
```

**Example alert payload:**
```json
{
  "alert_name": "PaymentService_HighErrorRate",
  "severity": "P1",
  "condition": "error_rate > 5% for 5 minutes",
  "current_value": "12.4%",
  "service": "payment-service",
  "region": "us-east-1",
  "started_at": "2024-03-15T14:32:00Z",
  "dashboard_url": "https://grafana.internal/d/payment-svc",
  "runbook_url": "https://wiki.internal/runbooks/payment-high-errors"
}
```

### 3.2 Alert Types

| Alert Type              | Trigger Mechanism                              | Example                                     |
|-------------------------|------------------------------------------------|---------------------------------------------|
| **Threshold**           | Metric crosses a static value                  | CPU > 90%                                   |
| **Rate of Change**      | Metric changes too fast (spike/drop)           | Request rate drops 50% in 5 min             |
| **Anomaly Detection**   | ML model detects deviation from baseline       | Traffic 3σ below weekly pattern             |
| **Absence / Heartbeat** | Expected signal stops arriving                 | No metrics received from host for 5 min     |
| **Composite**           | Multiple conditions combined                   | High latency AND high error rate            |
| **SLO Burn Rate**       | Error budget consumed faster than allowed      | Burning 14x budget rate = alert in 1 hr     |

### 3.3 SLO-Based Alerting (Multi-Window, Multi-Burn-Rate)

Standard threshold alerts are too noisy (too many false positives) or too slow (catch incidents late). SLO burn-rate alerting is the industry best practice.

**Concept:**
```
Error Budget = 1 - SLO target
  e.g., 99.9% SLO → 0.1% budget → 43.8 min/month of allowed downtime

Burn Rate = actual error rate / allowable error rate
  Burn Rate = 1  → consuming budget at exactly the right pace
  Burn Rate = 14 → budget exhausted in 2 hours (1/14 of a 28-day window)
```

**Multi-window approach (Google SRE Book):**

| Severity | Burn Rate | Short Window | Long Window | Action          |
|----------|-----------|--------------|-------------|-----------------|
| P1       | 14x       | 5 min        | 1 hr        | Page on-call now|
| P2       | 6x        | 30 min       | 6 hr        | Page on-call    |
| P3       | 3x        | 2 hr         | 24 hr       | Ticket + Slack  |
| P4       | 1x        | 6 hr         | 3 days      | Weekly review   |

**Why two windows?** Short window catches fast burns; long window confirms it's not a transient spike.

```
PromQL example (P1 alert):
  (
    sum(rate(http_requests_errors_total[5m])) /
    sum(rate(http_requests_total[5m]))
  ) > (14 * 0.001)   # 14x burn on 99.9% SLO
  AND
  (
    sum(rate(http_requests_errors_total[1h])) /
    sum(rate(http_requests_total[1h]))
  ) > (14 * 0.001)
```

### 3.4 Alert Routing & Notification Channels

```
Alert Fires
    │
    ▼
Alertmanager / PagerDuty / OpsGenie
    │
    ├─── P1/P2 ──► PagerDuty → Phone call + SMS → On-call engineer
    │
    ├─── P3     ──► Slack #alerts-{team} + PagerDuty (no phone)
    │
    └─── P4     ──► Slack #monitoring-low-priority (no page)
```

**Routing rules by team (label-based):**
```yaml
# Alertmanager routing example
routes:
  - match:
      team: payments
      severity: critical
    receiver: payments-pagerduty
  - match:
      team: infrastructure
    receiver: infra-slack
```

### 3.5 Alert Fatigue — The Silent Killer

Alert fatigue occurs when engineers receive so many alerts they begin ignoring them, including real incidents.

**Causes:**
- Thresholds set too low or on noisy metrics
- Alerts that fire but don't require action (no runbook, no clear owner)
- Flapping alerts (fire → resolve → fire within minutes)
- Duplicate alerts for the same root cause

**Mitigations:**

| Technique            | Description                                                         |
|----------------------|---------------------------------------------------------------------|
| **Inhibition**       | Suppress child alerts when parent alert fires (DB down → suppress all DB-dependent service alerts) |
| **Grouping**         | Batch alerts from the same source into one notification             |
| **Silencing**        | Mute alerts during known maintenance windows                        |
| **Deduplication**    | Collapse identical alerts firing from multiple replicas             |
| **Alert review cadence** | Weekly meeting to audit alert signal quality, remove unused ones |
| **Ownership tagging** | Every alert must have a team owner; orphan alerts get deleted      |

```
Alertmanager inhibition example:
inhibit_rules:
  - source_match:
      alertname: DatabaseDown
    target_match:
      component: database
    equal: ['env', 'region']
```

### 3.6 Runbooks

Every actionable alert MUST link to a runbook. A runbook answers:

```
1. What does this alert mean?
2. What is the impact on users?
3. What are the first 3 diagnostic steps?
4. What are common root causes and their fixes?
5. When to escalate and to whom?
6. How to verify the alert has resolved?
```

---

## 4. On-Call Best Practices

### 4.1 On-Call Rotation Design

```
┌─────────────────────────────────────────────────────────────┐
│  PRIMARY on-call  → First responder, handles all P1/P2      │
│  SECONDARY on-call → Backup if primary is unreachable       │
│  ESCALATION path   → Engineering manager → VP if unresolved │
└─────────────────────────────────────────────────────────────┘
```

- Rotate weekly; never longer than 2 weeks without a break
- Respect business hours for P3/P4; page only for P1/P2 at night
- Compensate on-call load (time off or financial)
- Keep a post-mortem culture — no blame, fix systems

### 4.2 Incident Response Flow

```
Alert Fires
    │
    ▼
Acknowledge (within SLA: 5 min for P1)
    │
    ▼
Assess Severity → Escalate if needed
    │
    ▼
Diagnose (use dashboard, runbook, traces, logs)
    │
    ▼
Mitigate (rollback, restart, scale out, failover)
    │
    ▼
Resolve → Update status page
    │
    ▼
Post-mortem within 48 hrs (5 Whys, timeline, action items)
```

---

## 5. Trade-offs

| Dimension                | Option A                          | Option B                          | Recommendation                                          |
|--------------------------|-----------------------------------|-----------------------------------|---------------------------------------------------------|
| **Alert sensitivity**    | Low threshold → more alerts       | High threshold → missed incidents | Tune with SLO burn rate; avoid static thresholds        |
| **Dashboard granularity**| High resolution (1s) → high cost  | Low resolution (1m) → blind spots | Use tiered retention: 1m for 15 days, 5m for 90 days   |
| **Alerting on symptoms** | Catches real user impact          | May miss root cause               | Always alert on symptoms; use metrics for root cause    |
| **Alerting on causes**   | Predictive, catches before impact | High false-positive rate          | Use as supplementary, not primary alert signal          |
| **SaaS vs self-hosted**  | SaaS: fast, expensive at scale    | Self-hosted: cheap, ops burden    | SaaS up to ~$50k/yr; self-host beyond that              |
| **Page vs ticket**       | Page: fast response, burnout risk | Ticket: sustainable, slower       | Page only for user-impacting events; rest as tickets    |
| **Cardinality**          | High-cardinality labels (per-user)| Low-cardinality (per-service)     | Keep metric cardinality low; use logs/traces for detail |

---

## 6. Real-World Systems & Applications

### 6.1 Netflix
- Uses **Atlas** (in-house time-series DB) + **Spectator** client libraries for metric collection
- Visualization via internal dashboards backed by Atlas
- Alerting via **Pager Duty** for P1/P2; Slack for lower severity
- **Chaos Monkey** generates intentional failures; monitoring validates resilience
- Red/black deployment monitoring: traffic split visualized in real time to catch regressions

### 6.2 Uber
- Built **uMonitor** — an internal platform for threshold-based and anomaly-based alerting
- Uses **M3** (open-sourced) as their high-scale time-series metrics platform
- Alerting on **city-level** metrics (trips per city per minute) — sudden drops trigger incidents
- Business KPI dashboards for supply/demand balance per market region

### 6.3 Stripe
- SLO-based alerting with burn rate for payment API uptime (99.99% SLO target)
- Separate dashboards per product surface (Payments, Billing, Connect, Radar)
- Status page (status.stripe.com) is automatically updated by internal incident tooling
- Engineers must acknowledge pages within 5 minutes for P1; automated escalation otherwise

### 6.4 GitHub
- Uses **Grafana** + **Prometheus** for visualization and alerting
- **Octolytics** (internal) for business metric dashboards (PR merges/min, pipeline runs)
- Alerting integrated with internal **ChatOps** (Hubot) — alerts posted to Slack with `!ack` commands
- Repository availability and Actions compute tracked as separate SLOs

### 6.5 Shopify
- Uses **Datadog** for unified metrics, APM traces, and logs
- Business metric dashboards tracking GMV (Gross Merchandise Volume) per minute — any drop is a P1
- Flash sale readiness: pre-event dashboards go live 30 min before high-traffic events (Black Friday)
- Auto-scaling triggers visualized in dashboards to confirm scale-out happened in time

### 6.6 Discord
- Monitoring WebSocket connection counts per region in real time
- Alert if connection count drops unexpectedly → may indicate a gateway crash
- Uses **Prometheus + Grafana** stack; heavily leverages recording rules for expensive queries
- Voice server quality metrics (packet loss, jitter) visualized per region per codec

### 6.7 Cloudflare
- Global edge monitoring: latency and error rates visualized per PoP (Point of Presence)
- Anomaly detection alerts on traffic patterns (DDoS signature: traffic spike + error rate spike)
- Public **Cloudflare Radar** is itself a real-time visualization of global internet health
- Internal alerts distinguish between customer-side origin failures vs. Cloudflare-side failures

---

## 7. Key Metrics to Monitor (by Layer)

### Application Layer
```
http_request_duration_seconds{p50, p95, p99}
http_requests_total{status="5xx"}
http_requests_total{status="4xx"}
active_connections
queue_depth
background_job_failure_rate
```

### Database Layer
```
db_query_duration_seconds{p99}
db_connections_active / db_connections_max
db_replication_lag_seconds
db_deadlocks_total
db_cache_hit_ratio          # target: > 99%
db_slow_queries_total       # queries > 100ms
```

### Cache Layer (Redis)
```
redis_hit_rate              # target: > 90%
redis_memory_used_bytes / redis_maxmemory
redis_evicted_keys_total    # evictions = memory pressure
redis_connected_clients
redis_commands_per_second
```

### Infrastructure Layer
```
node_cpu_utilization        # alert: > 80%
node_memory_utilization     # alert: > 85%
node_disk_utilization       # alert: > 80%
network_bytes_transmitted
pod_restart_count           # k8s
```

### Queue / Async Layer
```
queue_depth                 # growing = consumers falling behind
consumer_lag                # Kafka: partition lag per consumer group
message_processing_duration_seconds
dead_letter_queue_size      # growing = processing failures
```

---

## 8. SLI → SLO → Alert Mapping

```
SLI (Service Level Indicator)
  └─ Measurement: "99.2% of requests completed in < 200ms"

SLO (Service Level Objective)
  └─ Target:      "99.5% of requests must complete in < 200ms (28-day rolling)"

Error Budget
  └─ Remaining:   "0.5% - 0.8% = -0.3% → budget exhausted → freeze deployments"

Alert
  └─ Fires when:  "Burn rate > 6x for 30-min window AND 6-hr window"
```

**SLI types:**
| SLI Type      | Formula                                      |
|---------------|----------------------------------------------|
| Availability  | good_requests / total_requests               |
| Latency       | requests_under_threshold / total_requests    |
| Throughput    | successful_bytes / total_bytes               |
| Error Rate    | failed_requests / total_requests             |
| Freshness     | % data updated within acceptable window      |

---

## 9. Anti-Patterns

| Anti-Pattern                  | Description                                                       | Fix                                                          |
|-------------------------------|-------------------------------------------------------------------|--------------------------------------------------------------|
| **Alert on every metric**     | Every metric has a threshold alert → massive noise               | Alert on symptoms (error rate, latency), not causes          |
| **Static thresholds**         | Fixed CPU > 80% alerts on variable-load systems                  | Use dynamic baselines or SLO burn rate                       |
| **Averaged latency**          | Dashboard shows avg latency, hides p99 spikes                    | Always show p95/p99 alongside p50                            |
| **Orphaned alerts**           | Alerts with no owner, no runbook, no one acts on them            | Require team label + runbook URL on every alert              |
| **Dashboard sprawl**          | Hundreds of dashboards, no canonical source of truth             | Designate 1 golden dashboard per service; archive the rest   |
| **Alert without runbook**     | Engineer woken at 3am with no guidance on next step              | Block alert creation without runbook link                    |
| **Ignoring flapping alerts**  | Alert fires/resolves every 2 min; engineers mute it entirely     | Add min-duration windows; use `for: 5m` in Prometheus rules  |
| **Dashboards only in prod**   | No visibility in staging → bugs surface in prod                  | Mirror critical dashboards to staging environment            |

---

## 10. Tooling Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                 MODERN OBSERVABILITY STACK                      │
│                                                                 │
│  Metrics      Prometheus → Thanos/Cortex → Grafana             │
│  Logs         Fluentd/Logstash → Elasticsearch → Kibana        │
│  Traces       OpenTelemetry → Jaeger / Tempo → Grafana         │
│  Alerting     Alertmanager → PagerDuty / OpsGenie              │
│  SLO Mgmt     Sloth / SLO Burn Rate Recording Rules            │
│  Status Page  Statuspage.io / Atlassian / self-hosted          │
│                                                                 │
│  SaaS Alt:    Datadog (all-in-one)                             │
│               New Relic (all-in-one)                           │
│               Honeycomb (traces, high-cardinality)             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. Interview Cheat Sheet

| Question                                  | Answer                                                                               |
|-------------------------------------------|--------------------------------------------------------------------------------------|
| How do you reduce alert fatigue?          | SLO burn rate alerting, inhibition rules, grouping, alert ownership, weekly review   |
| Avg vs p99 latency — which to alert on?  | p99 always; avg hides tail latency that represents worst user experiences            |
| What's a burn rate alert?                 | Alerts when error budget is being consumed faster than allowable (e.g., 14x in 1hr) |
| RED vs USE?                               | RED for services (Rate/Errors/Duration), USE for resources (Util/Saturation/Errors)  |
| What makes a good dashboard?              | Macro → micro layout, consistent color, RED at top, links to runbooks, team-owned    |
| How do you handle a noisy alert?          | Add `for:` duration, switch to burn rate, or silence + fix root cause metric         |
| What's an SLI?                            | A quantitative measure of a service's behavior (e.g., request success rate)          |