# Availability Monitoring

## Definition

Availability Monitoring is the continuous practice of measuring, tracking, and alerting on whether systems, services, and dependencies are reachable and functioning correctly. It answers the fundamental question: **"Is the system up and serving requests successfully?"**

Availability is expressed as a percentage of uptime over a time window:

```
Availability (%) = (Uptime / (Uptime + Downtime)) × 100
```

---

## The Nines of Availability

| SLA         | Downtime/Year | Downtime/Month | Downtime/Week |
|-------------|---------------|----------------|---------------|
| 99%         | 3.65 days     | 7.3 hours      | 1.68 hours    |
| 99.9%       | 8.77 hours    | 43.8 minutes   | 10.1 minutes  |
| 99.99%      | 52.6 minutes  | 4.38 minutes   | 1.01 minutes  |
| 99.999%     | 5.26 minutes  | 26.3 seconds   | 6.05 seconds  |
| 99.9999%    | 31.5 seconds  | 2.6 seconds    | ~0.6 seconds  |

> Most consumer-facing systems target **99.9%–99.99%**. Financial and telecom systems often target **99.999%+**.

---

## Core Concepts

### 1. Health Checks

The atomic unit of availability monitoring. A probe that verifies a component is alive and capable of serving traffic.

```
Types:
  ┌─────────────────────────────────────────────────────┐
  │  Liveness Check   → Is the process alive?           │
  │  Readiness Check  → Is it ready to serve traffic?   │
  │  Dependency Check → Are its dependencies healthy?   │
  │  Deep Check       → Can it complete a real request? │
  └─────────────────────────────────────────────────────┘
```

**HTTP Health Check Example:**
```http
GET /health HTTP/1.1
Host: api.example.com

HTTP/1.1 200 OK
{
  "status": "healthy",
  "uptime_seconds": 86400,
  "dependencies": {
    "database": "healthy",
    "cache": "healthy",
    "message_queue": "degraded"
  }
}
```

**Kubernetes Liveness vs Readiness:**
```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 1
```

---

### 2. Uptime Monitoring

External probes that simulate user requests from outside your infrastructure.

```
                 ┌─────────────────────┐
  Probe Agent    │  Monitoring Service │
  (Global PoPs)  │                     │
                 │  Every N seconds:   │
  US-East   ───► │  GET /              │
  US-West   ───► │  Measure:           │──► Alert if:
  EU-West   ───► │  - HTTP status      │    - Non-2xx response
  AP-South  ───► │  - Response time    │    - Timeout exceeded
                 │  - SSL validity     │    - Content mismatch
                 └─────────────────────┘
```

**Key Parameters:**
- **Check interval**: 30s–5min (trade-off: cost vs. detection speed)
- **Check locations**: Multi-region to avoid false positives from regional network issues
- **Timeout threshold**: Typically 5–30s
- **Confirmation checks**: Re-verify from multiple locations before alerting

---

### 3. Synthetic Monitoring

Scripted, automated transactions that simulate real user workflows end-to-end.

```
Login Flow Synthetic Test:
  1. POST /auth/login         → Expect 200 + token
  2. GET /api/user/profile    → Expect 200 + user object
  3. POST /api/cart/add       → Expect 201
  4. POST /api/checkout       → Expect 200 + order_id
  5. GET /api/orders/{id}     → Expect 200
  
  Total: Measure end-to-end latency, detect step failures
```

**Synthetic vs. Real User Monitoring (RUM):**

| Aspect            | Synthetic                    | RUM                           |
|-------------------|------------------------------|-------------------------------|
| Data source       | Scripted probes              | Actual user sessions          |
| Coverage          | Always-on, consistent        | Traffic-dependent             |
| Pre-launch        | Yes (can test staging)       | No (needs real users)         |
| Edge cases        | Limited to scripted paths    | Catches unexpected paths      |
| Latency overhead  | None on users                | Slight JS payload overhead    |
| Best for          | SLA enforcement, alerting    | UX trends, performance issues |

---

### 4. Dependency Monitoring

Track the availability of every external system your service depends on.

```
Service Dependency Map:
                          ┌─────────────┐
                    ┌────►│  PostgreSQL │ (critical)
                    │     └─────────────┘
  ┌─────────────┐   │     ┌─────────────┐
  │   API       │───┼────►│    Redis    │ (critical)
  │   Service   │   │     └─────────────┘
  └─────────────┘   │     ┌─────────────┐
                    ├────►│    Kafka    │ (non-critical)
                    │     └─────────────┘
                    │     ┌─────────────┐
                    └────►│  Stripe API │ (external)
                          └─────────────┘
```

**Criticality Classification:**
- **Critical**: Failure causes full service outage (database, auth service)
- **Non-critical**: Failure causes degraded experience (analytics, recommendations)
- **External**: Third-party APIs (payment, email) — monitor + have fallbacks

---

### 5. SLI / SLO / SLA Framework (Google SRE Model)

```
  SLI (Service Level Indicator) — What you measure
  SLO (Service Level Objective)  — Internal target
  SLA (Service Level Agreement)  — External commitment

  Example:
  ┌──────────────────────────────────────────────────────┐
  │  SLI: % of HTTP requests returning 2xx in 30 days    │
  │  SLO: SLI ≥ 99.9%  (internal target)                 │
  │  SLA: SLI ≥ 99.5%  (customer-facing, with penalty)   │
  └──────────────────────────────────────────────────────┘

  Error Budget = 1 - SLO
  Error Budget (99.9%) = 0.1% = ~43.8 min/month of allowed downtime
```

**Common SLIs for Availability:**
- Request success rate (non-5xx / total requests)
- Health check pass rate
- Dependency availability ratio
- Circuit breaker open ratio

---

### 6. Alerting & Escalation

```
Alert Pipeline:

  Metric Breach
       │
       ▼
  ┌────────────┐    No     ┌──────────────────┐
  │ Above      │──────────►│  Continue        │
  │ Threshold? │           │  Monitoring      │
  └────────────┘           └──────────────────┘
       │ Yes
       ▼
  ┌────────────┐
  │ Confirm    │◄── Re-check from 2+ locations
  │ Alert      │    Wait N minutes (avoid flapping)
  └────────────┘
       │
       ▼
  ┌────────────────────────────────────────┐
  │  Severity Classification               │
  │  P1: Full outage   → Page on-call NOW  │
  │  P2: Degraded      → Page in 5 min     │
  │  P3: Warning       → Slack + ticket    │
  │  P4: Informational → Dashboard only    │
  └────────────────────────────────────────┘
       │
       ▼
  ┌────────────┐
  │ Escalation │  15 min no ack → escalate to team lead
  │ Policy     │  30 min no ack → escalate to manager
  └────────────┘
```

**Alert Fatigue Prevention:**
- Use **multi-window alerting**: alert only if threshold breached for N consecutive checks
- Apply **burn rate alerting** on error budgets instead of raw thresholds
- Group related alerts into a single incident
- Tune thresholds regularly based on false positive rate

---

### 7. Status Pages

Public-facing availability communication, critical for trust and SLA transparency.

**Structure:**
```
  ┌────────────────────────────────────────────────┐
  │  status.example.com                            │
  ├────────────────────────────────────────────────┤
  │  ● API Gateway          — Operational          │
  │  ● Authentication       — Operational          │
  │  ◑ Payment Processing   — Degraded Performance │
  │  ○ Notifications        — Major Outage         │
  │                                                │
  │  Current Incident: [Nov 15] Payment delays     │
  │  Last updated: 2 minutes ago                   │
  │                                                │
  │  Uptime history:  [████████████░] 99.7%        │
  └────────────────────────────────────────────────┘
```

**Tools:** Atlassian Statuspage, Cachet, Instatus, PagerDuty Status

---

### 8. Monitoring Architecture

```
Production Environment:
  ┌─────────┐  ┌─────────┐  ┌─────────┐
  │Service A│  │Service B│  │Service C│
  └────┬────┘  └────┬────┘  └────┬────┘
       │            │            │
       └─────────── ▼  ──────────┘
              ┌─────────────┐
              │  Metrics    │   (Prometheus, Datadog)
              │  Collector  │
              └──────┬──────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
   ┌───────────┐ ┌─────────┐ ┌────────┐
   │Time-Series│ │  Alert  │ │  Log   │
   │  Storage  │ │ Manager │ │Storage │
   └─────┬─────┘ └────┬────┘ └───┬────┘
         │            │          │
         ▼            ▼          ▼
   ┌──────────────────────────────┐
   │         Dashboard            │
   │   (Grafana, Datadog, etc.)   │
   └──────────────────────────────┘
                   │
                   ▼
         ┌──────────────────┐
         │  PagerDuty /     │
         │  OpsGenie Alert  │
         └──────────────────┘
```

---

## Trade-offs

### 1. Check Frequency vs. Cost & Noise

| Factor             | High Frequency (10s)         | Low Frequency (5 min)        |
|--------------------|------------------------------|------------------------------|
| Detection speed    | Fast (seconds)               | Slow (minutes)               |
| False positives    | Higher (transient blips)     | Lower                        |
| Cost               | High (API calls, egress)     | Low                          |
| Load on service    | Non-trivial at scale         | Negligible                   |
| Best for           | Payment, auth, core API      | Background jobs, batch APIs  |

### 2. Active vs. Passive Monitoring

| Aspect            | Active (Synthetic)           | Passive (Real Traffic)        |
|-------------------|------------------------------|-------------------------------|
| Always-on         | Yes                          | No (needs traffic)            |
| Low-traffic gaps  | Detected                     | Silent gaps missed            |
| Overhead          | External requests            | Log/metric pipeline overhead  |
| Accuracy          | Simulated, not real UX       | Real user experience          |
| Use case          | SLA checks, pre-prod         | Production trend analysis     |

### 3. Shallow vs. Deep Health Checks

| Type    | What it checks             | Latency   | Risk                              |
|---------|----------------------------|-----------|-----------------------------------|
| Shallow | Process alive, port open   | ~1ms      | May pass even when DB is down     |
| Medium  | DB connection pool check   | ~10ms     | DB query load from health checks  |
| Deep    | Full transaction roundtrip | ~100ms+   | Can cascade failures to monitoring|

> **Rule**: Default to medium checks. Use deep checks only for critical path validation at low frequency.

### 4. Single-Region vs. Multi-Region Monitoring

| Factor           | Single-Region               | Multi-Region                     |
|------------------|-----------------------------|----------------------------------|
| False positives  | High (regional ISP issues)  | Low (consensus-based alerting)   |
| Cost             | Low                         | High (multiple probe agents)     |
| Geo coverage     | None                        | Detects regional outages         |
| Complexity       | Simple                      | Alert correlation needed         |

### 5. Alerting Sensitivity

| Approach         | Pro                         | Con                              |
|------------------|-----------------------------|----------------------------------|
| Alert on any failure | Never miss an outage    | Alert fatigue, false positives   |
| Alert on sustained failure | Reduces noise     | May delay P1 detection by minutes|
| Burn rate alerting  | Tied to SLO, accurate    | Complex to configure             |

---

## Decision Framework

```
Is the component user-facing?
  ├── Yes → High frequency checks (30s–1min), multi-region, P1 on failure
  └── No  → Standard frequency (1–5min), single region ok

Does failure of this component cause full outage?
  ├── Yes → Critical dependency, deep check, aggressive alerting
  └── No  → Non-critical, shallow check, P3 alert or informational

Is the component external (third-party)?
  ├── Yes → Monitor + implement fallback/circuit breaker
  └── No  → Internal SLA targets sufficient

Is there user-facing traffic to monitor passively?
  ├── Yes → Use both RUM + synthetic for coverage
  └── No  → Synthetic monitoring only

What is the SLO?
  ├── ≥ 99.99% → Error budget is tiny; alert on burn rate
  ├── 99.9%    → Standard SLO alerting, 5-min confirmation
  └── < 99.9%  → Relaxed alerting, batch reporting
```

---

## Monitoring Metrics

### Golden Signals (Google SRE)

| Signal     | What to Measure                          | Example Metric                        |
|------------|------------------------------------------|---------------------------------------|
| Latency    | Time to serve a request                  | `p50`, `p95`, `p99` response time     |
| Traffic    | Demand on the system                     | Requests/sec, events/sec              |
| Errors     | Rate of failed requests                  | HTTP 5xx rate, exception rate         |
| Saturation | How "full" the service is                | CPU %, memory %, queue depth          |

### Availability-Specific Metrics

```
# Prometheus examples

# Uptime ratio over 30 days
sum_over_time(up[30d]) / count_over_time(up[30d])

# Error rate
rate(http_requests_total{status=~"5.."}[5m])
  / rate(http_requests_total[5m])

# Dependency health
probe_success{job="blackbox-exporter"}

# Error budget burn rate (fast burn = alert now)
(
  rate(http_requests_total{status=~"5.."}[1h]) /
  rate(http_requests_total[1h])
) / (1 - 0.999)  # where 0.999 = SLO
```

### Key Dashboards to Maintain

1. **Service Overview** — uptime %, error rate, p99 latency, current incident status
2. **Dependency Health** — status of each critical dependency
3. **SLO/Error Budget** — remaining error budget for the month
4. **Alert History** — false positive rate, MTTA (mean time to acknowledge), MTTR

---

## Anti-Patterns

| Anti-Pattern                    | Problem                                              | Fix                                          |
|---------------------------------|------------------------------------------------------|----------------------------------------------|
| Monitoring only the happy path  | Misses edge-case failures                            | Add synthetic tests for error and edge flows |
| Health check hits production DB | Every check adds DB load; can cause cascading failure| Use a lightweight read (SELECT 1) or replica |
| Single-region monitoring        | Regional ISP failures cause false positives          | Use 3+ globally distributed probe locations  |
| No confirmation before alerting | Transient network blips trigger pages                | Require 2/3 checks to fail before alerting   |
| Alerting on every metric        | Alert fatigue; on-call ignores pages                 | Alert only on symptoms, not causes           |
| Ignoring error budget           | No principled decision on when to halt features      | Review burn rate weekly; halt deploys at 0%  |
| Shallow-only health checks      | Service appears healthy when DB is unreachable       | Add dependency checks to health endpoint     |
| No runbooks linked to alerts    | On-call wastes time investigating from scratch       | Every alert must link to a runbook           |
| Status page updated manually    | Status page lags the actual incident by 20+ minutes  | Auto-update status page from monitoring tool |

---

## Real-World Examples

### Netflix — Chaos + Availability

- Uses **Hystrix** (now resilience4j) for circuit breaking — if a downstream service fails health checks, traffic is automatically cut off before cascading.
- **Simian Army / Chaos Monkey** deliberately kills instances to validate that monitoring correctly detects and alerts on failures.
- Tracks availability per region and per device type; a US outage is treated differently from a global outage.
- Status page auto-updates when internal monitors breach thresholds; no manual intervention needed.

### AWS — Multi-Layer Monitoring

- **Route 53 Health Checks**: HTTP/HTTPS probes from 18+ global edge locations. Consensus-based: 3 of 5 must fail before triggering DNS failover.
- **CloudWatch Synthetics**: Headless browser canaries for end-to-end flow monitoring.
- **Service Health Dashboard** and **Personal Health Dashboard** separate global incidents from account-specific ones.
- Internal SLOs are monitored with per-service error budgets; teams that exhaust their budget are blocked from deploying new features.

### Stripe — Payment Availability Focus

- Maintains **99.9999% availability** for their API core.
- Uses **multi-region active-active** deployment; health monitors route traffic away from degraded regions in under 30 seconds.
- Every payment endpoint has a synthetic test that runs a test-mode transaction every minute from 5 global locations.
- Alerts are tied to burn rate on error budgets, not raw error counts — avoids noisy alerts during traffic spikes.
- Public status page at `status.stripe.com` is updated automatically when health checks fail; commitment is to update within 5 minutes of incident start.

### Shopify — Flash Sale Resilience

- Runs **aggressive pre-event synthetic monitoring** before Black Friday — simulating checkout flows at 10x normal frequency.
- Uses **canary deployments** with automated health check gates — a new version must pass availability checks for 5 minutes before full rollout.
- Dependency monitoring on Stripe, Shopify Payments, tax APIs; each has a circuit breaker so a payment provider failure degrades gracefully rather than causing a checkout outage.
- Internal SLO: 99.99% for checkout; 99.9% for storefront; 99.5% for admin/reporting.

### PagerDuty — Monitoring the Monitor

- Has a dedicated "always-on" secondary monitoring stack in a separate cloud region that checks whether the *primary* monitoring infrastructure is healthy.
- Uses **dead man's switch** pattern — the primary system must "check in" every 60 seconds; if it misses a check-in, the secondary fires alerts.
- Response time SLAs are monitored separately from availability — a slow page is tracked distinctly from a down page.

### GitHub — Actions and API Availability

- Uses **Octolytics** (internal) to track per-endpoint availability.
- Pull request merges are blocked automatically if the CI/CD pipeline's health checks detect the Actions infrastructure is degraded.
- External monitoring via **Pingdom + custom agents** checks `api.github.com`, `github.com`, `objects.githubusercontent.com` independently.
- Incidents are automatically cross-posted to `githubstatus.com` when monitors breach P1 thresholds.

---

## Tooling Reference

| Tool             | Category                    | Best For                               |
|------------------|-----------------------------|----------------------------------------|
| **Prometheus**   | Metrics collection          | Self-hosted, k8s-native monitoring     |
| **Grafana**      | Dashboards                  | Visualizing Prometheus/Datadog metrics |
| **Datadog**      | Full-stack APM              | Enterprise, multi-cloud, SaaS          |
| **PagerDuty**    | Alerting & on-call          | Escalation policies, incident response |
| **OpsGenie**     | Alerting & on-call          | Atlassian ecosystem alternative        |
| **Pingdom**      | Uptime monitoring           | External HTTP/HTTPS probes             |
| **Statuspage**   | Status pages                | Public incident communication          |
| **Checkly**      | Synthetic monitoring        | API + browser synthetic checks         |
| **New Relic**    | Full-stack observability    | Application-level + infra monitoring   |
| **Blackbox Exporter** | Prometheus probe       | HTTP, TCP, ICMP probes via Prometheus   |

---

## Summary

```
Availability Monitoring = Know Before Your Users Know

Core loop:
  1. Define SLOs with error budgets
  2. Instrument health checks (liveness, readiness, dependency)
  3. Run synthetic + passive monitoring
  4. Alert on symptoms (burn rate), not causes
  5. Auto-update status page on breach
  6. Review error budget weekly, halt features at 0%
  7. Conduct post-mortems → improve checks

Key principle:
  ┌─────────────────────────────────────────────────────┐
  │  Monitor from the outside in (user's perspective)   │
  │  Alert on user impact, not internal metrics         │
  │  Every alert must be actionable or it's noise       │
  └─────────────────────────────────────────────────────┘
```