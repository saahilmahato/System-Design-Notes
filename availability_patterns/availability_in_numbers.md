# Availability Patterns

> **Core Idea:** Availability is the percentage of time a system is operational and accessible. It is a cornerstone SLA metric and dictates architecture decisions around redundancy, replication, and failure tolerance.

---

## Availability Tiers ("The Nines")

Availability is expressed as a percentage of uptime per year. Each additional "9" represents an order-of-magnitude improvement in reliability — and a corresponding increase in cost and complexity.

| Tier   | Availability | Downtime / Year | Downtime / Month | Downtime / Week |
|--------|-------------|-----------------|------------------|-----------------|
| 2 Nines | 99%        | ~3.65 days      | ~7.2 hours       | ~1.68 hours     |
| 3 Nines | 99.9%      | ~8.76 hours     | ~43.8 minutes    | ~10.1 minutes   |
| 4 Nines | 99.99%     | ~52.6 minutes   | ~4.38 minutes    | ~1.01 minutes   |
| 5 Nines | 99.999%    | ~5.26 minutes   | ~26.3 seconds    | ~6.05 seconds   |

---

### 2 Nines (99%)

**~3.65 days of downtime per year**

- Acceptable for **non-critical internal tools**, batch processing pipelines, dev/staging environments, or analytics dashboards.
- A single server with basic monitoring can often achieve this naturally.
- No significant redundancy required; single-AZ deployments are common.

**Characteristics:**
- Manual failover is acceptable.
- Scheduled maintenance windows can be taken without impacting the SLA.
- Simple, low-cost infrastructure.

**When to aim for this:**
- Internal admin panels, nightly ETL jobs, developer tooling, MVP products.

---

### 3 Nines (99.9%)

**~8.76 hours of downtime per year (~43 min/month)**

- The baseline for most **production consumer-facing services**.
- Requires basic redundancy: multi-instance deployments, health checks, and automated restarts.
- Load balancers + 2 application servers in the same region can achieve this.

**Characteristics:**
- Automated recovery expected (e.g., auto-scaling, process supervisors).
- Planned maintenance must be scheduled carefully.
- A single database with a read replica and automated failover typically suffices.

**When to aim for this:**
- SaaS products, e-commerce stores, internal APIs, standard web apps.

---

### 4 Nines (99.99%)

**~52 minutes of downtime per year (~4.4 min/month)**

- Required for **business-critical** and **revenue-generating** systems.
- Demands: Multi-AZ deployments, automatic failover, active health monitoring, zero-downtime deployments (blue/green or canary), and chaos engineering.
- Requires substantial investment in redundancy at every layer (compute, database, networking, DNS).

**Characteristics:**
- No single point of failure tolerated.
- RTO (Recovery Time Objective) must be measured in seconds, not minutes.
- Database replication must be synchronous or near-synchronous.
- Requires on-call engineering, automated runbooks, and alerting pipelines.

**When to aim for this:**
- Payment processing, financial platforms, healthcare systems, cloud infrastructure services (e.g., AWS EC2, GCP).

---

### 5 Nines (99.999%) — Reference Tier

**~5.26 minutes of downtime per year**

- Extremely rare and extraordinarily expensive.
- Requires multi-region active-active deployments, purpose-built hardware, and specialized networking.
- Reserved for **telecommunications infrastructure**, **power grid systems**, **air traffic control**, and certain financial clearinghouses.

---

## Availability Patterns: Parallel vs. Sequential

When components are combined into a system, the **overall availability** depends on how those components are arranged.

---

### Sequential (Series) Availability

All components must be **simultaneously available** for the system to function. A failure in **any one** component causes a total system failure.

```
Request → [Component A] → [Component B] → [Component C] → Response
```

**Formula:**
```
System Availability = A × B × C
```

**Example:**
- Component A: 99.9%
- Component B: 99.9%
- Component C: 99.9%

```
System Availability = 0.999 × 0.999 × 0.999 = 99.7%
```

> **Key Insight:** Chaining components in sequence *degrades* availability. Each added dependency is a new failure point. A system with 10 services at 99.9% each yields only **99.0%** availability.

**Real-World Implication:**
- Microservice chains: a request passing through 5 services is only as reliable as the product of all their availabilities.
- Synchronous API calls compound failure risk.
- Long synchronous pipelines (Auth → Rate Limiter → Business Logic → DB → Cache) are vulnerable.

---

### Parallel (Redundant) Availability

Multiple components perform the **same function**. The system fails only when **all** components fail simultaneously.

```
          ┌─[Component A]─┐
Request ──┤               ├──▶ Response
          └─[Component B]─┘
```

**Formula:**
```
System Availability = 1 - (1 - A) × (1 - B)
```

**Example:**
- Component A: 99%
- Component B: 99%

```
System Availability = 1 - (0.01 × 0.01) = 1 - 0.0001 = 99.99%
```

> **Key Insight:** Parallel components dramatically improve availability. Two 99% components in parallel yield **99.99%** — a jump from 2 nines to 4 nines.

**Patterns that implement parallel availability:**
- **Active-Active:** All nodes serve traffic simultaneously. Load is distributed. Any node failure is seamless to users. Highest throughput.
- **Active-Passive (Hot Standby):** Primary serves traffic; secondary is warm and ready. Failover is near-instant.
- **Active-Passive (Cold Standby):** Secondary must be started before it can serve traffic. Cheaper but slower failover.

---

## Trade-offs

### 2 Nines vs. 3 Nines
| Factor | 2 Nines | 3 Nines |
|---|---|---|
| Cost | Low | Moderate |
| Infrastructure | Single instance | Multi-instance + LB |
| Failover | Manual | Semi-automated |
| Suitable For | Internal tools | Standard web apps |

### 3 Nines vs. 4 Nines
| Factor | 3 Nines | 4 Nines |
|---|---|---|
| Cost | Moderate | High |
| Deployment | Single-AZ | Multi-AZ |
| DB Replication | Async | Sync/Near-sync |
| Deployment Strategy | Rolling | Blue/Green, Canary |
| On-call Burden | Low-Medium | High |
| Suitable For | SaaS, standard APIs | Payments, healthcare |

### Parallel vs. Sequential

| Factor | Sequential | Parallel |
|---|---|---|
| Availability | Degrades with each component | Improves with each replica |
| Cost | Lower (fewer instances) | Higher (duplicate resources) |
| Complexity | Simpler to build | Requires coordination, consensus |
| Consistency | Easier (single source of truth) | Harder (split-brain, stale reads) |
| Latency | Compounds across hops | Can introduce routing overhead |
| Failure Mode | Any component = total failure | All replicas must fail simultaneously |
| Data Sync | N/A | Replication lag, conflict resolution |

### Active-Active vs. Active-Passive

| Factor | Active-Active | Active-Passive |
|---|---|---|
| Availability | Highest | High |
| Cost | Highest (all nodes fully provisioned) | Moderate (standby may be smaller) |
| Complexity | Very High (routing, conflict resolution) | Moderate |
| Failover Speed | Instantaneous | Seconds to minutes (depending on warm/cold) |
| Throughput | Higher (distributed load) | Limited to primary capacity |
| Data Consistency | Harder — concurrent writes risk conflicts | Easier — single write source |
| Best For | Global-scale, read-heavy workloads | Most business-critical services |

---

## Real-World Systems and Applications

### Sequential Availability in Practice

| System | Sequential Dependency | Risk |
|---|---|---|
| **Uber trip request** | App → Auth Service → Maps API → Driver Matching → Payment | Each hop reduces availability |
| **AWS Lambda invocation** | API Gateway → Lambda → DynamoDB → SNS | Chained AWS services all need to be up |
| **E-commerce checkout** | Cart Service → Inventory → Payment Gateway → Order DB | Single failure aborts transaction |

**Mitigation:** Use **circuit breakers** (Hystrix, Resilience4j) and **fallback mechanisms** to prevent cascading failures in sequential chains.

---

### Parallel Availability in Practice

| System | Parallel Pattern | Implementation |
|---|---|---|
| **Google Search** | Active-Active across data centers globally | Anycast routing, consistent hashing |
| **Netflix** | Active-Active multi-region (us-east-1, us-west-2, eu-west-1) | Chaos Monkey to continuously test resilience |
| **Amazon RDS Multi-AZ** | Active-Passive with synchronous replication | Auto failover in ~60 seconds |
| **Cloudflare DNS** | Active-Active across 300+ PoPs | Anycast, sub-millisecond failover |
| **PostgreSQL with Patroni** | Active-Passive with leader election | Automatic failover via ZooKeeper/etcd |
| **Cassandra** | Active-Active, leaderless replication | Tunable consistency (ONE, QUORUM, ALL) |
| **Kafka** | Partition leader + ISR replicas | Leader election per partition, replication factor ≥ 3 |

---

### Availability Tier Examples by Company

| Company / Service | Target Availability | Pattern Used |
|---|---|---|
| **AWS S3** | 99.99% (4 nines) | Multi-AZ, multi-region, parallel storage nodes |
| **Stripe Payments** | 99.99%+ | Active-passive per region, synchronous replication |
| **GitHub** | 99.9% (3 nines) | Multi-AZ, active-passive DB (MySQL + Orchestrator) |
| **Slack** | 99.99% | Multi-AZ active-active, Vitess for MySQL sharding |
| **Twilio SMS API** | 99.95% | Multi-region active-active with carrier failover |
| **Google Cloud Storage** | 99.999% (5 nines) | Multi-region, erasure coding, parallel writes |

---

## Design Guidelines

1. **Calculate your dependency chain first.** Multiply availability of every synchronous dependency. If it's unacceptably low, either parallelize, make calls async, or add circuit breakers.

2. **Match the tier to business impact.** Not every service needs 4 nines. Over-engineering for availability adds cost, complexity, and operational burden without proportional value.

3. **Async over sync where possible.** Converting synchronous calls to asynchronous (via queues or event streams) breaks sequential chains and improves resilience.

4. **Use health checks + auto-healing.** Route traffic away from unhealthy instances automatically. Kubernetes liveness/readiness probes, ELB target health checks.

5. **Isolate failure domains.** Use bulkheads to ensure a failure in one subsystem doesn't cascade. Pool separation, rate limiting per tenant.

6. **Measure, don't assume.** Track actual availability (error rate + latency SLOs) via SLIs. Use SLO burn rate alerts to detect budget exhaustion early.

7. **Plan for gray failures.** A node that responds slowly is often worse than one that fails outright — it holds connections and blocks threads. Parallel patterns + timeouts mitigate this.