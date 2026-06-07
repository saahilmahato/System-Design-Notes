# Availability Patterns in System Design

---

## What is Availability?

**Availability** = the percentage of time a system is operational and accessible to users over a given period.

$$\text{Availability} = \frac{\text{Uptime}}{\text{Uptime} + \text{Downtime}}$$

---

## Nines of Availability

| Availability | Downtime/Year | Downtime/Month | Downtime/Week |
|---|---|---|---|
| 90% (1 nine) | ~36.5 days | ~72 hours | ~16.8 hours |
| 99% (2 nines) | ~3.65 days | ~7.2 hours | ~1.68 hours |
| 99.9% (3 nines) | ~8.76 hours | ~43.8 minutes | ~10.1 minutes |
| 99.99% (4 nines) | ~52.6 minutes | ~4.38 minutes | ~1.01 minutes |
| 99.999% (5 nines) | ~5.26 minutes | ~26.3 seconds | ~6.05 seconds |

> **5 nines (99.999%)** is the gold standard for mission-critical systems (banking, emergency services, telecom).

---

## Key Availability Metrics

| Metric | Description | Goal |
|---|---|---|
| **MTBF** (Mean Time Between Failures) | Average time between system failures | Higher = more reliable |
| **MTTR** (Mean Time To Recover) | Average time to restore a system after failure | Lower = faster recovery |
| **MTTF** (Mean Time To Failure) | Average time until first failure (non-repairable) | Higher = more durable |
| **SLA** (Service Level Agreement) | Contractual uptime commitment to customers | Must be met or exceeded |

> **Availability ≈ MTBF / (MTBF + MTTR)** — to maximize availability, increase MTBF *and* decrease MTTR.

---

## Factors That Affect Availability

- **Hardware failures** — disk crashes, power outages, NIC failures
- **Software bugs** — memory leaks, unhandled exceptions, crashes
- **Network issues** — packet loss, latency spikes, DNS failures
- **Scalability bottlenecks** — traffic surges overwhelming underpowered infrastructure
- **Security incidents** — DDoS attacks, ransomware locking systems
- **External dependencies** — third-party APIs or services going down
- **Human error** — misconfigurations, bad deployments, accidental deletions

---

## High Availability vs. Fault Tolerance

| Aspect | High Availability (HA) | Fault Tolerance (FT) |
|---|---|---|
| **Goal** | Minimize downtime | Continue operating *correctly* despite failures |
| **Approach** | Fast detection + fast failover | No interruption at all — seamless redundancy |
| **Cost** | Moderate | High |
| **Example** | Active-passive DB failover | RAID storage, NASA systems |
| **Downtime** | Brief (seconds to minutes) | Near zero |

> HA and FT are complementary. Most production systems use HA; only the most critical use full FT.

---

## Core Availability Patterns

### 1. Redundancy

- Duplicate critical components so no single failure brings the system down
- **Active-Active**: multiple instances all serving traffic simultaneously → higher throughput + availability
- **Active-Passive**: one instance is primary; the other is on standby and takes over on failure → simpler but idle resources
- Applies to: servers, databases, load balancers, network links, power supplies

### 2. Failover

- Automatic switching from a failed component to a healthy one
- Requires health checks to detect failure + a mechanism to redirect traffic
- **Active-Active failover**: no switchover needed — traffic already flows to remaining nodes
- **Active-Passive failover**: failover triggers a brief transition period
- **Key tradeoff**: failover speed vs. risk of split-brain (both nodes thinking they're primary)

### 3. Replication

- Maintain multiple copies of data across nodes/regions
- **Master-Slave (Primary-Replica)**: writes go to primary; reads can be served from replicas
- **Master-Master (Multi-Primary)**: multiple nodes accept writes; conflict resolution required
- Enables failover to a replica if the primary goes down with minimal data loss

### 4. Load Balancing

- Distribute incoming traffic across multiple healthy instances
- Prevents any single server from becoming a bottleneck
- Also performs health checks — routes traffic only to healthy nodes
- Algorithms: Round Robin, Least Connections, IP Hash, Weighted Round Robin

### 5. Health Checks & Monitoring

- Continuously probe services to detect failures early
- **Passive checks**: detect failures from real traffic errors
- **Active checks**: synthetic pings/requests to confirm service health
- Triggers alerts and automated recovery actions (restart, failover, scale-out)
- Tools: Prometheus + Alertmanager, Datadog, CloudWatch, PagerDuty

### 6. Geographic Distribution (Multi-Region)

- Deploy system across multiple data centers or cloud regions
- Users are routed to the nearest/healthiest region (via GeoDNS or Anycast)
- Protects against region-wide outages (data center fire, ISP failure, natural disasters)
- **Tradeoff**: data consistency across regions becomes harder

### 7. Circuit Breaker

- Prevents cascading failures by stopping calls to a failing dependency
- Three states:
  - **Closed** — normal operation, requests flow through
  - **Open** — dependency is down, requests fail fast (no waiting)
  - **Half-Open** — probe if dependency has recovered; resume or stay open
- Improves availability of the *caller* even when a downstream service is degraded

### 8. Bulkhead Pattern

- Isolate components into separate pools so a failure in one doesn't exhaust resources for all
- Named after ship bulkheads that contain flooding to one compartment
- Example: separate thread pools for different downstream services — if one service is slow, it doesn't block all others

### 9. Graceful Degradation

- When parts of the system fail, serve a reduced but functional experience rather than a full outage
- Example: show cached product listings if the database is down; disable recommendations if the ML service fails
- Users perceive reliability even when internal issues exist

### 10. Retry with Exponential Backoff

- Automatically retry failed requests, with increasing wait times between attempts
- Prevents thundering herd — all clients retrying simultaneously overwhelming a recovering service
- Add **jitter** (randomness) to retry intervals to spread the load
- Always pair with a **max retry limit** to avoid infinite loops

---

## Availability Pattern Decision Guide

| Scenario | Recommended Pattern(s) |
|---|---|
| Single server is a single point of failure | Redundancy (Active-Passive or Active-Active) |
| Database reads are slow under load | Replication (Master-Slave) + Load Balancing |
| Service calls a flaky external API | Circuit Breaker + Retry with Backoff |
| Traffic spikes causing crashes | Load Balancing + Auto-scaling |
| Regional data center outage | Geographic Distribution + DNS Failover |
| One slow service blocks everything | Bulkhead + Async processing |
| Partial feature failure | Graceful Degradation |

---

## Common Availability Anti-Patterns (What NOT to Do)

- **Single point of failure (SPOF)** — any single component whose failure brings down the system
- **Tight coupling** — services so interdependent that one failure cascades to all
- **No health checks** — load balancers routing traffic to dead instances
- **Synchronous chains** — long chains of synchronous calls where any failure breaks the whole flow
- **No runbooks** — team doesn't know what to do when something fails → high MTTR
- **Ignoring partial failures** — treating degraded state as fully operational

---

## Quick Reference: Availability in the Real World

| Company | Strategy Used |
|---|---|
| **Netflix** | Multi-region AWS + Circuit Breakers (Hystrix) + Graceful degradation (no recommendations before error) |
| **Amazon** | Active-Active multi-AZ deployments + Auto-scaling + Health checks |
| **Google** | Global load balancing (Anycast) + Replicated Spanner DB + 5-nines SLA targets |
| **Banking systems** | Active-Passive failover + Strong replication + Strict MTTR SLAs |

---

> **Key Principle:** Design for failure. Assume any component *will* fail. The question is not *if* — it's *when*, and how fast you recover.