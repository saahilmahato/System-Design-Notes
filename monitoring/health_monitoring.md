# Health Monitoring in System Design

---

## Table of Contents

1. [What is Health Monitoring?](#1-what-is-health-monitoring)
2. [Core Concepts](#2-core-concepts)
3. [Health Check Types](#3-health-check-types)
4. [Health Check Patterns](#4-health-check-patterns)
5. [Metrics & Signals](#5-metrics--signals)
6. [Alerting & Thresholds](#6-alerting--thresholds)
7. [Health Monitoring Architecture](#7-health-monitoring-architecture)
8. [Tools & Technologies](#8-tools--technologies)
9. [Trade-offs](#9-trade-offs)
10. [Real-World Systems & Applications](#10-real-world-systems--applications)
11. [Decision Framework](#11-decision-framework)
12. [Anti-Patterns](#12-anti-patterns)
13. [Key Metrics to Track](#13-key-metrics-to-track)

---

## 1. What is Health Monitoring?

Health monitoring is the continuous observation of a system's operational state to detect degradation, failure, or anomalies — enabling automated recovery, alerting, and informed capacity decisions.

**Primary Goals:**
- Detect failures **before** users notice them
- Drive automated remediation (restarts, rerouting, scaling)
- Provide operators with actionable signals rather than raw data
- Establish baselines for capacity planning and post-mortems

**The Three Questions Health Monitoring Answers:**
1. **Is this component alive?** (liveness)
2. **Is this component ready to serve traffic?** (readiness)
3. **Is this component performing within acceptable bounds?** (performance health)

---

## 2. Core Concepts

### Signal vs. Noise
Raw metrics are noise. Health monitoring distills them into **signals** — meaningful deviations from expected behavior.

### Golden Signals (Google SRE Model)
The four canonical signals for any system:

| Signal | Definition | Example |
|--------|-----------|---------|
| **Latency** | Time to service a request | p99 API response > 500ms |
| **Traffic** | Demand on the system | Requests/sec, messages/sec |
| **Errors** | Rate of failed requests | HTTP 5xx rate > 1% |
| **Saturation** | How "full" the service is | CPU > 85%, queue depth growing |

### RED Method (Request-Driven Services)
Focused on services handling requests:
- **Rate** — requests per second
- **Errors** — error rate
- **Duration** — distribution of request latency

### USE Method (Infrastructure / Resources)
Focused on hardware and system resources:
- **Utilization** — % time resource is busy
- **Saturation** — work queued that resource cannot process
- **Errors** — error events for that resource

---

## 3. Health Check Types

### 3.1 Liveness Check
- **Question:** Is the process running and not deadlocked?
- **Behavior on failure:** Restart the container/process
- **Implementation:** Lightweight HTTP endpoint (`/healthz`) that returns `200 OK` as long as the process is alive
- **Warning:** Must be cheap — never block on DB or external calls

```http
GET /healthz
→ 200 OK
{ "status": "alive" }
```

### 3.2 Readiness Check
- **Question:** Is the component ready to accept traffic?
- **Behavior on failure:** Remove from load balancer pool; do NOT restart
- **Implementation:** Checks dependent resources (DB connection, cache, upstream services)
- **Use case:** Startup warmup, graceful rolling deploys, drain before shutdown

```http
GET /readyz
→ 503 Service Unavailable (during startup or degraded dependency)
{ "status": "not_ready", "reason": "db_connection_failed" }
```

### 3.3 Startup Check
- **Question:** Has the application finished initializing?
- **Behavior on failure:** Delay liveness/readiness probes until startup completes
- **Use case:** Apps with slow bootstrap (loading ML models, large config files, schema migrations)

```http
GET /startupz
→ 503 until init complete
→ 200 once ready
```

### 3.4 Deep Health Check
- **Question:** Are all downstream dependencies healthy?
- **Includes:** DB query, cache ping, message queue connection, external API reachability
- **Risk:** Can cause cascading failures if probed too aggressively; should be rate-limited and never used for liveness

```json
{
  "status": "degraded",
  "components": {
    "database": "healthy",
    "redis": "healthy",
    "payment_gateway": "unhealthy",
    "email_service": "healthy"
  }
}
```

---

## 4. Health Check Patterns

### 4.1 Pull-Based (Polling)
- Load balancer or monitoring system **polls** the health endpoint at a fixed interval
- Simple to implement; works well for homogeneous fleets
- Examples: AWS ELB, Kubernetes liveness probes, Prometheus scraping

```
[Load Balancer] → GET /healthz every 10s → [Service Instance]
```

**Parameters to tune:**
- `initialDelaySeconds` — grace period before first probe
- `periodSeconds` — frequency of checks
- `failureThreshold` — consecutive failures before action
- `timeoutSeconds` — max probe wait time

### 4.2 Push-Based (Heartbeat)
- Service **emits** health signals to a central collector on a schedule
- Better for short-lived jobs, batch workers, or firewalled services
- Absence of heartbeat triggers an alert (dead-man's switch pattern)

```
[Worker] → POST /heartbeat every 30s → [Monitoring Server]
                                         ↓ no signal for 90s?
                                       ALERT: worker presumed dead
```

### 4.3 Synthetic Monitoring (Active Probing)
- An external agent executes **real user journeys** against production or staging
- Catches issues that raw metrics miss (broken checkout flow, SSL expiry)
- Tools: Datadog Synthetics, Pingdom, Checkly, New Relic Synthetics

### 4.4 Passive / Sidecar Health Monitoring
- A sidecar proxy (Envoy, Linkerd) observes real traffic and infers health
- No separate health endpoint needed; works transparently in a service mesh
- Supports outlier detection — automatically ejects unhealthy instances

### 4.5 Circuit Breaker Integration
Health state directly feeds circuit breakers:

```
CLOSED → requests flow normally
    ↓ error rate crosses threshold
OPEN → requests fail-fast; health re-checked periodically
    ↓ probe succeeds
HALF-OPEN → small % of traffic allowed through to verify recovery
```

---

## 5. Metrics & Signals

### 5.1 Infrastructure Metrics

| Metric | Healthy Range (typical) | Alert Threshold |
|--------|------------------------|-----------------|
| CPU Utilization | < 70% sustained | > 85% for 5 min |
| Memory Usage | < 75% | > 90% or swap used |
| Disk I/O Wait | < 10% | > 30% sustained |
| Disk Space | < 80% full | > 90% full |
| Network Packet Loss | < 0.1% | > 1% |
| Open File Descriptors | < 80% of ulimit | > 90% of ulimit |

### 5.2 Application Metrics

| Metric | Description |
|--------|-------------|
| Request Rate (RPS) | Requests per second; drop can indicate upstream failure |
| Error Rate | % of 5xx/4xx; >1% 5xx is typically critical |
| p50/p95/p99 Latency | Tail latency reveals real user experience |
| Active Connections | Pool exhaustion leads to queuing and cascading failure |
| Thread/Goroutine Count | Leaks cause OOM; spikes indicate processing backlog |
| GC Pause Time | Long GC pauses cause latency spikes (JVM, Go) |

### 5.3 Database Metrics

| Metric | Alert Signal |
|--------|-------------|
| Connection Pool Utilization | > 80% — risk of exhaustion |
| Query Latency (p99) | Spike > 2x baseline |
| Replication Lag | > 10s for read replicas |
| Lock Wait Time | Growing trend indicates contention |
| Slow Query Rate | Sudden spike indicates missing index or schema change |
| Dead Tuples (PostgreSQL) | Signals autovacuum falling behind |

### 5.4 Queue / Messaging Metrics

| Metric | Alert Signal |
|--------|-------------|
| Queue Depth | Growing unboundedly — consumer is falling behind |
| Consumer Lag (Kafka) | Offset lag increasing — partition consumers are slow |
| Message Age | Oldest unprocessed message exceeds SLA |
| Dead Letter Queue (DLQ) Size | Growing DLQ — messages failing repeatedly |
| Throughput Drop | Sudden decrease → producer or broker issue |

---

## 6. Alerting & Thresholds

### Alert Levels

| Severity | Response | Example |
|----------|----------|---------|
| **P0 / Critical** | Page immediately, 24/7 | Service down, error rate > 10% |
| **P1 / High** | Page during business hours | p99 latency > 2s for 5 min |
| **P2 / Medium** | Ticket, next business day | Disk usage > 80% |
| **P3 / Low** | Dashboard, weekly review | Background job delayed |

### Alerting Best Practices

**Symptom-Based vs. Cause-Based Alerting:**
- Alert on **symptoms** (user-visible impact) not causes (CPU at 80%)
- "User checkout is failing" > "DB CPU is high"

**Multi-Window / Burn Rate Alerts (SLO-based):**
Used to catch both fast burns (sudden outage) and slow burns (gradual degradation):

```
Error Budget Burn Rate > 14.4x for 1h  →  P0 page
Error Budget Burn Rate > 6x for 6h     →  P1 page
Error Budget Burn Rate > 3x for 3d     →  P2 ticket
```

**Flap Prevention:**
- Require N consecutive failures before alerting
- Use hysteresis: alert at > 90%, recover at < 75%

**Dead Man's Switch:**
- Alert fires if no heartbeat received in X minutes
- Catches monitoring pipeline failures and silent crashes

---

## 7. Health Monitoring Architecture

### 7.1 Single-Service Architecture

```
┌──────────────────────────────────────────────────────┐
│                     Service Instance                 │
│                                                      │
│  ┌─────────────────┐   ┌──────────────────────────┐  │
│  │  Business Logic  │   │   Health Endpoints       │  │
│  │                 │   │  GET /healthz  (liveness) │  │
│  │                 │   │  GET /readyz   (readiness) │ │
│  └─────────────────┘   │  GET /metrics  (prometheus)│ │
│                        └──────────────────────────┘  │
└──────────────────────────────────────────────────────┘
         ↑                        ↑
    [Load Balancer]          [Prometheus]
    polls /readyz             scrapes /metrics
    every 10s                 every 15s
```

### 7.2 Distributed System Architecture

```
                        ┌─────────────────────┐
                        │   Alertmanager      │
                        │  (dedupe, route,    │
                        │   silence)          │
                        └────────┬────────────┘
                                 │
                        ┌────────▼────────────┐
                        │    Prometheus       │◄──── scrape /metrics
                        │  (time-series DB)   │      from all services
                        └────────┬────────────┘
                                 │
               ┌─────────────────┼─────────────────┐
               ▼                 ▼                 ▼
        ┌────────────┐  ┌────────────────┐  ┌────────────────┐
        │  Grafana   │  │  PagerDuty /   │  │  Slack /       │
        │ Dashboards │  │  OpsGenie      │  │  Email         │
        └────────────┘  └────────────────┘  └────────────────┘
```

### 7.3 Kubernetes Health Monitoring Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Kubernetes Cluster                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                         Pod                             │    │
│  │  ┌───────────────────┐  ┌─────────────────────────────┐ │    │
│  │  │  App Container    │  │      Sidecar (Envoy)        │ │    │
│  │  │  /healthz         │  │  - mTLS                     │ │    │
│  │  │  /readyz          │  │  - outlier detection        │ │    │
│  │  │  /metrics         │  │  - circuit breaking         │ │    │
│  │  └───────────────────┘  └─────────────────────────────┘ │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  kubelet ──────► livenessProbe  ──► restart pod if fails        │
│  kubelet ──────► readinessProbe ──► remove from Service Endpoints│
│  kubelet ──────► startupProbe   ──► delay other probes           │
└──────────────────────────────────────────────────────────────────┘
```

### 7.4 Aggregated Health Dashboard Pattern

```
Service A ─┐
Service B ─┤──► Health Aggregator ──► Overall System Health Score
Service C ─┤         │
   DB    ──┘         │
                     ▼
            ┌─────────────────┐
            │  Status Page    │  (Statuspage.io, Atlassian)
            │  (public-facing)│
            └─────────────────┘
```

---

## 8. Tools & Technologies

### Health Check & Probing

| Tool | Use Case |
|------|----------|
| **Kubernetes Probes** | Native liveness/readiness/startup for containerized apps |
| **AWS ELB Health Checks** | HTTP/TCP checks for EC2 and ECS targets |
| **HAProxy** | TCP/HTTP checks with active removal |
| **Consul** | Service registry with health checking and DNS |
| **Envoy / Linkerd** | Sidecar-based passive health monitoring |

### Metrics Collection

| Tool | Use Case |
|------|----------|
| **Prometheus** | Pull-based metrics collection; PromQL for querying |
| **Datadog Agent** | Push/pull hybrid; cloud-native with APM |
| **CloudWatch** | AWS-native metrics with deep AWS integration |
| **OpenTelemetry** | Vendor-neutral instrumentation standard |
| **StatsD** | UDP-based push metrics (lightweight, fire-and-forget) |

### Visualization & Dashboarding

| Tool | Use Case |
|------|----------|
| **Grafana** | Industry standard for Prometheus/InfluxDB/CloudWatch dashboards |
| **Datadog Dashboards** | Turnkey dashboards with ML anomaly detection |
| **Kibana** | Log-driven dashboards (ELK Stack) |
| **AWS CloudWatch Dashboards** | Native AWS metrics visualization |

### Alerting & Incident Management

| Tool | Use Case |
|------|----------|
| **Alertmanager** | Prometheus alerting pipeline |
| **PagerDuty** | On-call scheduling, escalation policies |
| **OpsGenie** | Alerting with integrations |
| **VictorOps** | Incident collaboration and routing |

### Synthetic Monitoring

| Tool | Use Case |
|------|----------|
| **Datadog Synthetics** | Browser and API tests from 30+ global locations |
| **Checkly** | Playwright-based synthetic tests as code |
| **Pingdom** | Simple uptime and page speed monitoring |
| **New Relic Synthetics** | Multi-step scripted browser monitors |

---

## 9. Trade-offs

### 9.1 Liveness vs. Readiness Probes

| Dimension | Liveness Only | Readiness Only | Both |
|-----------|--------------|----------------|------|
| **Behavior on DB failure** | Restart loop → makes things worse | Remove from pool → graceful degradation | Best of both |
| **Behavior on OOM / deadlock** | Restarts to recover | Keeps broken instance in pool | Best of both |
| **Complexity** | Simple | Simple | More to configure and tune |
| **Risk of cascading restart** | High if misconfigured | None | Moderate |

> **Rule:** Always separate liveness and readiness. Never have your liveness probe check external dependencies.

---

### 9.2 Deep vs. Shallow Health Checks

| Dimension | Shallow Check (`/healthz`) | Deep Check (all deps) |
|-----------|--------------------------|----------------------|
| **Cost** | Extremely cheap | Expensive — hits DB, cache, etc. |
| **Accuracy** | Only catches process-level failures | Catches dependency failures |
| **Risk** | Safe at high frequency | Can cause cascading failures if used for liveness |
| **Use for liveness?** | ✅ Yes | ❌ Never |
| **Use for readiness?** | ❌ Insufficient | ✅ Yes |

---

### 9.3 Push vs. Pull Metrics

| Dimension | Pull (Prometheus) | Push (StatsD, Datadog) |
|-----------|-------------------|----------------------|
| **Control** | Monitoring system controls scrape rate | Service controls emission rate |
| **Discovery** | Requires service discovery | Works behind NAT/firewall |
| **Failure mode** | Scrape fails if service is down | No data = service may be down or just not emitting |
| **Ephemeral jobs** | Hard — job may finish before scrape | Easy — push at end of job |
| **Cardinality** | Must limit label cardinality | Must avoid metric storms |

---

### 9.4 Polling Frequency vs. Detection Speed

| Interval | Detection Latency | Cost | Risk |
|----------|-------------------|------|------|
| 1 second | ~1–2 seconds | High | Can overwhelm slow services |
| 10 seconds | ~10–20 seconds | Moderate | Acceptable for most services |
| 30 seconds | ~30–60 seconds | Low | May be too slow for SLA requirements |
| 60 seconds | ~1–2 minutes | Very low | Not appropriate for critical paths |

---

### 9.5 Alert Sensitivity vs. Alert Fatigue

| Approach | Pro | Con |
|----------|-----|-----|
| Alert on every threshold breach | Never miss an issue | Alert fatigue, false positives |
| Require N consecutive failures | Reduces flapping | Delays detection |
| SLO-based burn rate alerting | Actionable, business-relevant | Complex to set up |
| Anomaly detection (ML-based) | Catches unknown unknowns | False positives during legitimate traffic changes |

---

### 9.6 Centralized vs. Distributed Health Monitoring

| Dimension | Centralized | Distributed / Federated |
|-----------|-------------|------------------------|
| **Consistency** | Single source of truth | Divergent views possible |
| **Scale** | Single point of failure | More resilient |
| **Cost** | Lower infrastructure cost | Higher operational overhead |
| **Query** | Global queries easy | Cross-region queries hard |
| **Examples** | Single Prometheus | Prometheus federation, Thanos, Cortex |

---

## 10. Real-World Systems & Applications

### Netflix — Hystrix & Adaptive Health
- Uses **Hystrix** (circuit breaker library) with real-time health streams per dependency
- Each service exposes a **health stream** (Server-Sent Events) consumed by **Hystrix Dashboard** for live visualization
- **Simian Army** (Chaos Monkey) continuously validates that health monitoring correctly detects and recovers from failures
- Playback health is measured at the **stream quality level** — not just "is the service up?" but "are users experiencing good video quality?"
- **Eureka** (service registry) performs periodic health checks; unhealthy instances are deregistered automatically

### Uber — Multi-Signal Health
- Services expose `/health` endpoints consumed by internal load balancers
- Uses **M3** (time-series metrics platform) for storing billions of metrics per minute
- **Cadence** (workflow engine) monitors health of long-running trip workflows
- Real-time **driver/rider matching health** is monitored via throughput and latency of the dispatch service

### AWS — Elastic Load Balancer Health Checks
- ALB performs HTTP health checks every 5–300 seconds
- Instance must return `200` within the configured timeout
- After `unhealthyThreshold` consecutive failures, the instance is marked unhealthy and removed from the target group
- After `healthyThreshold` consecutive successes, the instance is marked healthy and added back
- Integrates with Auto Scaling to replace unhealthy instances automatically

### Kubernetes (Google / GKE)
- **kubelet** manages liveness, readiness, and startup probes natively
- Failed liveness probe → restart; failed readiness probe → remove from Service endpoints
- **kube-state-metrics** exposes cluster state (pod restarts, deployment health) to Prometheus
- HPA (Horizontal Pod Autoscaler) uses CPU/memory metrics to scale based on utilization — a form of saturation-driven health response

### Google — Site Reliability Engineering Model
- Every production service has an **SLO** (Service Level Objective) — e.g., 99.9% of requests < 200ms
- **Error budgets** derived from SLOs drive alerting: burn rate alerts fire when the error budget is being spent too fast
- **Borgmon** (predecessor to Prometheus) pioneered the white-box monitoring model now used industry-wide

### Stripe — Payment Health Monitoring
- Monitors **payment success rates** broken down by payment method, geography, and card network
- A drop in success rate for VISA payments in Europe triggers automatic alerting and investigation
- Uses **synthetic transactions** — real test charges are submitted every minute to detect processing failures before customers do
- Health data feeds into automatic retries and intelligent routing (fallback to alternative processors)

### Facebook (Meta) — Canary Health Analysis
- New code deploys are **canary deployed** to 1% of traffic
- Health monitoring compares canary vs. control cohort on error rates, latency, and custom business metrics
- If canary health deviates beyond threshold, rollback is triggered automatically without human intervention

### Shopify — Database Health
- Monitors **MySQL replication lag** across 100+ database shards
- An increase in lag triggers automatic traffic shifting from read replicas to primary
- `SHOW REPLICA STATUS` lag metrics are scraped into Prometheus and trigger alerts if lag exceeds 30 seconds

### Discord — Real-Time Message Health
- Monitors **message delivery success rate** and **WebSocket connection health** per region
- Tracks **presence service health** — detecting when the fan-out for user status updates is falling behind
- Deploys **synthetic bots** that send and receive messages to verify end-to-end message delivery

---

## 11. Decision Framework

### Choosing Health Check Strategy

```
Is the service handling live user traffic?
├── Yes → Implement BOTH liveness and readiness probes
│         └── Does it have slow startup (>30s)?
│             ├── Yes → Add startup probe
│             └── No  → Skip startup probe
└── No → Heartbeat / dead man's switch is sufficient

Does the service have external dependencies?
├── Yes → Readiness probe checks dependency reachability
│         Liveness probe NEVER checks external deps
└── No  → Simple process-alive check is sufficient

Is the service ephemeral (cron job, batch)?
├── Yes → Push-based heartbeat with dead man's switch
└── No  → Pull-based polling from load balancer / Prometheus
```

### Choosing Alert Type

```
Is the alert user-visible?
├── Yes → Symptom-based alert (error rate, latency SLO)
└── No  → Cause-based alert (disk, memory) for preventive ops

How fast does this burn the error budget?
├── Fast (>14x) → P0, immediate page
├── Medium (>6x) → P1, page with delay
└── Slow (<3x)  → P2/P3, ticket

Does the metric flap frequently?
├── Yes → Require consecutive failures threshold
└── No  → Alert immediately on threshold breach
```

---

## 12. Anti-Patterns

### 1. Using Liveness Probe to Check External Dependencies
**Problem:** If DB goes down, every instance fails its liveness probe → Kubernetes restarts all pods simultaneously → thundering herd on DB recovery.
**Fix:** Liveness = process-level only. Dependency checks go in readiness probe.

### 2. Health Check That Takes Too Long
**Problem:** A health endpoint that queries the DB takes 2–3 seconds. Under load, probes time out, triggering false-positive failures.
**Fix:** Set a tight timeout on the check. Cache dependency status with a short TTL. Never do N+1 queries in health checks.

### 3. Alert on Everything
**Problem:** 200+ alerts per day → engineers stop caring → P0 missed in the noise.
**Fix:** Alert only on user-visible symptoms. Use dashboards for informational metrics. Fewer, higher-quality alerts.

### 4. Checking Health of the Health System
**Problem:** Prometheus is down → no alerts fire → major outage goes undetected.
**Fix:** Deploy monitoring redundantly. Use an external watchdog service (e.g., a separate region's monitoring checking the primary). Use dead man's switches.

### 5. Single-Signal Health Determination
**Problem:** A service is "green" on HTTP 200 but all responses return empty data due to a logic bug.
**Fix:** Combine multiple signals — HTTP status, response body validation, business metric thresholds, synthetic transactions.

### 6. Ignoring Tail Latency
**Problem:** Average response time looks fine (50ms) but p99 is 5 seconds — affecting 1% of users.
**Fix:** Always alert on p99 (and p999 for high-volume services). Mean hides multimodal distributions.

### 7. Static Thresholds on Dynamic Traffic
**Problem:** Alert fires every morning as traffic ramps up, causing alert fatigue.
**Fix:** Use relative thresholds (% change from baseline), time-of-day baselines, or SLO burn rate alerting.

### 8. Not Testing Health Checks
**Problem:** Health check endpoint exists but has a bug — always returns 200 even when the service is broken.
**Fix:** Include health check behavior in integration tests. Periodically inject synthetic failures to validate that health monitoring detects them (chaos testing).

### 9. Missing Runbooks
**Problem:** Alert fires at 3am. On-call engineer doesn't know what it means or how to respond.
**Fix:** Every alert must link to a **runbook** with: what this means, likely causes, step-by-step remediation, escalation path.

---

## 13. Key Metrics to Track

### Service Health Dashboard — Minimum Viable Metrics

```
┌────────────────────────────────────────────────────────────────┐
│                     Service Health Dashboard                   │
├─────────────────────────┬──────────────────────────────────────┤
│ Request Rate            │ requests/sec (by endpoint)           │
│ Error Rate              │ % 5xx (by endpoint, by status code)  │
│ Latency (p50/p95/p99)  │ ms (by endpoint)                     │
│ Active Instances        │ count in healthy/unhealthy state     │
│ Deployment Status       │ current version, rollout %          │
├─────────────────────────┼──────────────────────────────────────┤
│ CPU Utilization         │ % per instance + fleet average       │
│ Memory Usage            │ % + heap vs. non-heap (JVM)          │
│ DB Connection Pool      │ active / idle / pending              │
│ Cache Hit Rate          │ % (drop indicates cache invalidation)│
│ Error Budget Remaining  │ % of monthly budget left             │
└─────────────────────────┴──────────────────────────────────────┘
```

### Health Monitoring SLIs

| SLI | Description | Typical Target |
|-----|-------------|----------------|
| Availability | % of time service responds with non-5xx | 99.9% – 99.99% |
| Latency | % of requests below latency threshold | 95% < 200ms |
| Error Rate | % of requests that succeed | > 99.5% success |
| Health Check Freshness | Age of last successful health data | < 60 seconds |
| MTTD | Mean time to detect an issue | < 5 minutes |
| MTTR | Mean time to recover | < 30 minutes |

---

## Summary

| Concept | Key Takeaway |
|---------|-------------|
| Liveness vs. Readiness | Separate concerns — liveness restarts, readiness removes from pool |
| Golden Signals | Latency, Traffic, Errors, Saturation — monitor these first |
| Deep Checks | Only for readiness; never for liveness |
| Alerting | Alert on symptoms, not causes; fewer high-quality alerts beat alert fatigue |
| SLO Burn Rate | The modern standard for actionable, user-impact-correlated alerting |
| Tail Latency | Always track p99 — mean hides the worst user experiences |
| Runbooks | Every alert must have one; no alert should fire without a clear response |