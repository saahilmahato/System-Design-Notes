# Availability in Numbers

---

## What is Availability?

**Availability** = the fraction of time a system is operational and accessible.

$$\text{Availability} = \frac{\text{Uptime}}{\text{Uptime} + \text{Downtime}} = \frac{\text{MTBF}}{\text{MTBF} + \text{MTTR}}$$

- **MTBF** (Mean Time Between Failures) — how long the system runs before failing
- **MTTR** (Mean Time To Repair) — how long it takes to restore after failure
- To maximize availability: **increase MTBF** and **decrease MTTR**

---

## The Nines of Availability — Complete Table

One "nine" = one additional 9 in the availability percentage.

| Nines | Availability % | Downtime/Year | Downtime/Month | Downtime/Week | Downtime/Day |
|---|---|---|---|---|---|
| **1 nine** | 90% | 36 days 12h | 73h 0m | 16h 48m | 2h 24m |
| **2 nines** | 99% | 3 days 15h 36m | 7h 18m | 1h 40.8m | 14m 24s |
| **3 nines** | 99.9% | 8h 41m 38s | 43m 28s | 10m 4.8s | 1m 26s |
| **4 nines** | 99.99% | 52m 9.8s | 4m 21s | 1m 0.5s | 8.6s |
| **5 nines** | 99.999% | 5m 15.6s | 26.3s | 6.05s | 0.86s |
| **6 nines** | 99.9999% | 31.5s | 2.63s | 0.605s | 0.086s |
| **7 nines** | 99.99999% | 3.15s | 0.263s | 0.0605s | 0.0086s |
| **8 nines** | 99.999999% | 315ms | 26.3ms | 6.05ms | 0.86ms |
| **9 nines** | 99.9999999% | 31.5ms | 2.63ms | 0.605ms | 0.086ms |

> **Practical benchmarks:**
> - **3 nines (99.9%)** — minimum for most production web services
> - **4 nines (99.99%)** — standard SLA for major cloud providers (AWS, GCP, Azure)
> - **5 nines (99.999%)** — telecom, banking, emergency services; requires serious engineering investment
> - **6+ nines** — aerospace, nuclear, life-critical systems; near-impossible to achieve in software at scale without extreme hardware redundancy

---

## Downtime Calculation Formula

To calculate acceptable downtime for any availability target over any time window:

$$\text{Downtime} = (1 - \text{Availability}) \times \text{Total Time}$$

**Example:** 99.9% availability over 1 year (8,760 hours):

$$\text{Downtime} = (1 - 0.999) \times 8760 \text{ hours} = 8.76 \text{ hours}$$

**Reference time units:**
- 1 year = 8,760 hours = 525,600 minutes = 31,536,000 seconds
- 1 month ≈ 730 hours = 43,800 minutes = 2,628,000 seconds (30.42 days average)
- 1 week = 168 hours = 10,080 minutes = 604,800 seconds
- 1 day = 24 hours = 1,440 minutes = 86,400 seconds

---

## Availability in Sequence vs. in Parallel

This is one of the most important and testable concepts in system design.

### In Sequence (Components are dependent)

When Component A **must** succeed before Component B can serve the request — both must be up for the system to work.

$$\text{Availability}_{total} = \text{Availability}_A \times \text{Availability}_B \times \ldots$$

> **Each component multiplies the availability downward.**

**Example:** API Gateway (99.9%) → Application Server (99.9%) → Database (99.9%)

$$\text{Availability} = 0.999 \times 0.999 \times 0.999 = 0.997 = 99.7\%$$

Adding components in sequence always makes the system *less* available, no matter how reliable each component is.

| Components in Sequence | Each at 99.9% | Each at 99.99% |
|---|---|---|
| 1 component | 99.9% | 99.99% |
| 2 components | 99.8% | 99.98% |
| 3 components | 99.7% | 99.97% |
| 5 components | 99.5% | 99.95% |
| 10 components | 99.0% | 99.90% |

> **Interview insight:** A typical web request passes through 5–10 components (DNS → CDN → Load Balancer → API Gateway → Service → Cache → DB). Each hop erodes overall availability. This is why redundancy at each layer matters.

---

### In Parallel (Redundant components)

When Component A *or* Component B can serve the request — the system fails only when **all** parallel components fail simultaneously.

$$\text{Availability}_{total} = 1 - (1 - \text{Availability}_A) \times (1 - \text{Availability}_B) \times \ldots$$

> **Each added parallel component drives the failure probability toward zero.**

**Example:** Two load-balanced servers, each at 99.9%:

$$\text{Availability} = 1 - (1 - 0.999) \times (1 - 0.999) = 1 - (0.001 \times 0.001) = 1 - 0.000001 = 99.9999\%$$

Two 99.9% components in parallel achieve **6 nines** — the same result as one 6-nines component at a fraction of the cost.

| Parallel Replicas | Each at 99% | Each at 99.9% | Each at 99.99% |
|---|---|---|---|
| 1 | 99% | 99.9% | 99.99% |
| 2 | 99.99% | 99.9999% | 99.999999% |
| 3 | 99.9999% | 99.9999999% | ~100% |

> **This is why redundancy is so powerful.** Adding a second replica of a 99.9% component jumps availability from 3 nines to 6 nines instantly.

---

### Combined System Example

Real systems have both sequential and parallel components. Evaluate layer by layer:

```
[Client]
   │
[Load Balancer: 99.99%]           ← single component (sequential)
   │
[App Server A: 99.9%] ── parallel ──[App Server B: 99.9%]
   │
[DB Primary: 99.9%] ── parallel ── [DB Replica: 99.9%]
```

**Step 1 — App Servers in parallel:**
$$1 - (0.001 \times 0.001) = 99.9999\%$$

**Step 2 — DB nodes in parallel:**
$$1 - (0.001 \times 0.001) = 99.9999\%$$

**Step 3 — Full chain in sequence:**
$$0.9999 \times 0.999999 \times 0.999999 = 99.98\%$$

Even with redundant app servers and DB, the single load balancer becomes the bottleneck for overall availability — reinforcing the need to eliminate every SPOF.

---

## Availability vs. Fault Tolerance

These terms are often used interchangeably but have distinct meanings.

| Dimension | Availability | Fault Tolerance |
|---|---|---|
| **Definition** | Percentage of time a system is operational | Ability to continue operating *correctly* despite component failures |
| **Goal** | Minimize downtime | Zero interruption — not even brief |
| **User experience on failure** | Brief interruption (seconds to minutes) | No interruption whatsoever |
| **How it's achieved** | Fast detection + fast failover + redundancy | Full redundancy with no switchover needed |
| **Downtime on failure** | Some (RTO > 0) | None (RTO = 0) |
| **Data loss on failure** | Possible (RPO > 0) | None (RPO = 0) |
| **Cost** | Moderate | Very high |
| **Complexity** | Moderate | High |
| **Example systems** | Web services, SaaS apps, cloud DBs | Aircraft flight control, NASA systems, pacemakers, RAID storage |
| **Typical metric** | Uptime % / SLA | Zero single-point-of-failure guarantee |

### Key Distinction

- **High Availability** accepts that failures happen and focuses on *recovering fast*. A 99.999% available system can still go down — it just recovers in ~5 minutes per year.
- **Fault Tolerance** is designed so that failures are *completely invisible* to users. No recovery is needed because no visible interruption ever occurs.

> **Analogy:** A car with a spare tire is *highly available* — you stop briefly, swap the tire, and drive on. A car with run-flat tires is *fault tolerant* — you never stop at all.

**Fault Tolerance in Practice:**
- RAID-1 (disk mirroring) — if one disk fails, reads/writes continue from the mirror without pause
- Dual power supplies in servers — one PSU dies, the other takes over with zero downtime
- Active-active database clusters — no failover needed, all nodes serve traffic simultaneously
- ECC memory — corrects bit-flip errors in RAM transparently

**Most production software systems are highly available, not fault tolerant** — true fault tolerance is prohibitively expensive and complex at software scale.

---

## SLA, SLO, SLI — The Availability Contract Stack

These three terms define how availability is promised, targeted, and measured:

| Term | Full Name | Definition | Example |
|---|---|---|---|
| **SLI** | Service Level Indicator | The actual measured metric | "Our API success rate over the last 30 days was 99.97%" |
| **SLO** | Service Level Objective | Internal target for the SLI | "We aim for 99.9% success rate" |
| **SLA** | Service Level Agreement | External contract with customers; breach = penalty | "We guarantee 99.9% uptime or credit your bill" |

- **SLA ≤ SLO** — always set your public SLA lower than your internal target to have a buffer
- **SLO > SLA** — internal teams are held to a higher bar than what's promised externally
- SLIs are the raw data; SLOs are goals; SLAs are promises with consequences

### Error Budget

The time you are *allowed* to be down under your SLO. Teams use this to balance reliability work vs. feature development.

$$\text{Error Budget} = (1 - \text{SLO}) \times \text{Time Period}$$

**Example:** SLO of 99.9% over 30 days:

$$\text{Error Budget} = 0.001 \times 43{,}800 \text{ min} = 43.8 \text{ minutes/month}$$

- If you've used 40 minutes of your budget, you freeze risky deployments until next month
- If you have budget remaining, you can move faster

---

## Planned vs. Unplanned Downtime

Total downtime = planned + unplanned. Both count against your availability SLA.

| Type | Cause | Examples | Mitigation |
|---|---|---|---|
| **Planned** | Intentional maintenance | Deployments, DB migrations, patching | Blue-green deployments, rolling updates, canary releases |
| **Unplanned** | Unexpected failure | Hardware crash, bug, DDoS, cascade failure | Redundancy, circuit breakers, chaos engineering |

> **Most teams focus on unplanned downtime, but planned downtime is often larger.** A single deployment that takes 5 minutes of downtime per week = 4.3 hours/year = below 99.95%.

---

## Availability Quick Reference Card

### How many nines do you need?

| System Type | Target | Rationale |
|---|---|---|
| Internal tools, admin dashboards | 99% (2 nines) | Acceptable occasional downtime |
| General SaaS, B2B apps | 99.9% (3 nines) | Industry standard minimum |
| Consumer apps, e-commerce | 99.99% (4 nines) | Revenue impact of downtime is high |
| Payments, financial transactions | 99.999% (5 nines) | Every second of downtime = money lost |
| Telecom, healthcare, emergency | 99.9999%+ (6+ nines) | Safety-critical; regulatory requirements |

### How to achieve each level

| Target | What it takes |
|---|---|
| 99% | Single server, basic monitoring, manual recovery |
| 99.9% | Redundant components, automated health checks, load balancer |
| 99.99% | Multi-AZ deployment, automated failover, on-call runbooks, chaos testing |
| 99.999% | Multi-region, synchronous replication, sub-second detection, dedicated SRE team |
| 99.9999%+ | Full active-active globally, zero-downtime deployments, extreme hardware redundancy |

---

> **Key Principle:** Availability is not a single system property — it is the product of every component in your dependency chain. The weakest link defines your ceiling. Design with this in mind at every layer.