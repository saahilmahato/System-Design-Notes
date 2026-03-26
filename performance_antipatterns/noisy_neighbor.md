# Performance Antipattern: Noisy Neighbor

---

## 1. What Is the Noisy Neighbor Problem?

The **Noisy Neighbor** antipattern occurs when one tenant, process, or workload in a shared infrastructure **consumes a disproportionate share of shared resources** — CPU, memory, network bandwidth, disk I/O, database connections, cache space — degrading performance for all other co-located workloads.

The term borrows from the apartment analogy: a loud neighbor doesn't destroy your apartment, but they make living there miserable.

```
┌────────────────────────────────────────────────────┐
│              Shared Host / Cluster                 │
│                                                    │
│  ┌──────────────┐   ┌──────────┐   ┌──────────┐    │
│  │  Tenant A    │   │ Tenant B │   │ Tenant C │    │
│  │  (Noisy 🔊)  │   │ (Normal) │   │ (Normal) │    │
│  │              │   │          │   │          │    │
│  │ CPU: 90% ████│   │ CPU: 5%  │   │ CPU: 5%  │    │
│  │ I/O: 95% ████│   │ I/O: 2%  │   │ I/O: 3%  │    │
│  └──────────────┘   └──────────┘   └──────────┘    │
│                                                    │
│  Shared Resource Pool: CPU, Memory, Network, Disk  │
│  [████████████████████░░░░░░░░] 80% consumed       │
└────────────────────────────────────────────────────┘
         ↓ Impact on Tenant B & C
         ↓ Higher latency, timeouts, throttling
```

---

## 2. Why It Happens

### 2.1 Root Causes

| Cause | Description |
|---|---|
| **Shared multi-tenancy** | Multiple customers share the same physical/virtual resources |
| **No resource isolation** | Missing cgroups, quotas, or rate limits |
| **Bursty workloads** | A tenant runs batch jobs, ETL, or analytics during peak hours |
| **Runaway queries** | Unoptimized N+1 queries or missing indexes consuming all DB I/O |
| **Cache stampedes** | Mass cache invalidation forces all tenants to hit the DB simultaneously |
| **Thread pool exhaustion** | One slow downstream dependency holds threads, starving others |
| **Memory leaks** | A single process slowly consuming all available memory |
| **GC pressure** | High object allocation causing frequent garbage collection pauses |

### 2.2 Affected Resource Dimensions

```
Resource Contention Map
────────────────────────────────────────────────────────
  CPU          → Thread starvation, high context switching
  Memory       → OOM kills, swapping, GC pressure
  Network I/O  → Bandwidth saturation, high packet loss
  Disk I/O     → Read/write queue depth exhaustion
  DB Connections → Connection pool exhaustion
  Cache Space  → Eviction of other tenants' hot keys
  File Descriptors → Process-level FD limits hit
────────────────────────────────────────────────────────
```

---

## 3. How It Manifests

### 3.1 Symptoms

- **Intermittent latency spikes** with no apparent cause in the affected service
- **Timeout errors** spiking at irregular intervals
- **P99/P999 latency diverges** sharply from P50 (long tail latency)
- **Noisy logs**: lock waits, connection timeouts, GC pauses in neighboring services
- **Resource utilization looks fine on average** but spikes are missed (averages hide bursts)

### 3.2 Diagnostic Signals

```
Healthy System:
  P50 latency: 10ms   P95: 15ms   P99: 20ms   P999: 25ms

Noisy Neighbor Affected:
  P50 latency: 11ms   P95: 80ms   P99: 400ms  P999: 2000ms
                              ↑ Long tail blowout
```

---

## 4. Common Scenarios

### 4.1 Cloud VM / Container Level

Multiple VMs share the same physical host. A tenant running a CPU-intensive ML training job or large file compression saturates the host CPU, causing CPU steal time on neighboring VMs.

```
Physical Host
├── VM A (ML Training Job) → CPU steal: 0%   ← The noisy one
├── VM B (Web App)         → CPU steal: 40%  ← Victim
└── VM C (API Service)     → CPU steal: 35%  ← Victim
```

### 4.2 Database (Shared RDS / Multi-Tenant DB)

One tenant runs a poorly optimized `SELECT *` with no `LIMIT`, or a full table scan, holding I/O locks and connection pool slots, causing timeouts for all other tenants.

```sql
-- Noisy neighbor query (missing index, full scan)
SELECT * FROM orders WHERE status = 'pending';
-- Scans 50M rows, holds I/O for 30 seconds
```

### 4.3 Shared Cache (Redis / Memcached)

A tenant stores large objects or performs a `KEYS *` command (O(N) blocking) on a shared Redis instance, blocking all other clients during the scan.

### 4.4 Message Queue / Kafka

One consumer group falls behind, causing log retention pressure. Or a producer publishes at an extremely high rate, saturating the broker's network.

### 4.5 Kubernetes / Container Orchestration

A pod without resource limits expands to consume all node CPU/memory, triggering OOM kills or CPU throttling on sibling pods.

```yaml
# Anti-pattern: No resource limits set
containers:
  - name: worker
    image: my-worker
    # No resources.limits defined — noisy neighbor risk!
```

---

## 5. Mitigation Strategies

### 5.1 Resource Quotas & Limits

Enforce hard ceilings on resource consumption per tenant or process.

```yaml
# Kubernetes — Always set requests AND limits
resources:
  requests:
    cpu: "250m"
    memory: "256Mi"
  limits:
    cpu: "500m"
    memory: "512Mi"
```

```sql
-- PostgreSQL: Limit max connections per role
ALTER ROLE tenant_a CONNECTION LIMIT 10;
```

### 5.2 Rate Limiting & Throttling

Apply per-tenant rate limits at every layer: API gateway, message queue, DB query rate.

```
API Gateway Rate Limiting
┌─────────────────────────────────────────┐
│  Tenant A: 1,000 req/s (burst: 2,000)  │
│  Tenant B: 500 req/s  (burst: 1,000)   │
│  Tenant C: 200 req/s  (burst: 400)     │
└─────────────────────────────────────────┘
Excess requests → 429 Too Many Requests
```

### 5.3 Physical / Logical Isolation

| Isolation Level | Mechanism | Cost |
|---|---|---|
| **Process isolation** | Separate OS processes | Low |
| **Container isolation** | Docker + cgroups | Low-Medium |
| **VM isolation** | Dedicated VMs per tenant | Medium |
| **Node isolation** | Dedicated K8s nodes | Medium-High |
| **Physical isolation** | Dedicated hardware | High |

### 5.4 Quality of Service (QoS) Classes

Classify workloads and guarantee resources to high-priority classes:

```
QoS Tiers:
  Platinum → Guaranteed CPU/Memory, dedicated nodes
  Gold     → Burstable with high baseline guarantee
  Silver   → Best-effort with soft limits
  Bronze   → Background, preemptable
```

Kubernetes maps this to **Guaranteed**, **Burstable**, and **BestEffort** QoS classes.

### 5.5 Workload Scheduling & Bin-Packing

- Schedule bursty/batch workloads on **separate node pools** from latency-sensitive services
- Use **pod affinity/anti-affinity** rules to keep sensitive workloads apart
- Use **time-based scheduling**: run heavy batch jobs during off-peak hours

### 5.6 Dedicated Resource Pools

```
Multi-Tenant Architecture (After Fix)

  OLTP Pool (Latency-Sensitive)       Analytics Pool (Throughput)
  ┌──────────────────────────┐        ┌──────────────────────────┐
  │ Tenant A - Web Requests  │        │ Tenant A - Reports/ETL   │
  │ Tenant B - API Traffic   │        │ Tenant B - Batch Exports │
  │ SLA: P99 < 50ms          │        │ SLA: Best effort         │
  └──────────────────────────┘        └──────────────────────────┘
```

### 5.7 Circuit Breakers & Bulkheads

**Bulkhead pattern** — isolate thread pools so a slow tenant cannot exhaust the global pool:

```
Without Bulkhead:                    With Bulkhead:
                                     
  Global Thread Pool (100)           Tenant A Pool (30)
  ├── Tenant A: 95 threads           Tenant B Pool (30)
  ├── Tenant B: 4 threads            Tenant C Pool (30)
  └── Tenant C: 1 thread             Shared reserve (10)
      (starved)
```

### 5.8 Caching Isolation

- Assign **separate cache namespaces or instances** per tenant
- Set **per-key TTLs** and **max memory policies** (`allkeys-lru`)
- Avoid blocking commands like `KEYS *`, `FLUSHALL` on shared Redis

### 5.9 Database-Level Controls

```sql
-- PostgreSQL: Statement-level timeout per role
ALTER ROLE tenant_a SET statement_timeout = '5s';

-- MySQL: Per-user resource limits
GRANT USAGE ON *.* TO 'tenant_a'@'%'
  WITH MAX_QUERIES_PER_HOUR 10000
       MAX_CONNECTIONS_PER_HOUR 500;
```

---

## 6. Detection & Observability

### 6.1 Key Metrics to Monitor

| Metric | What It Reveals |
|---|---|
| **CPU steal time** | Noisy neighbor at hypervisor level |
| **P95/P99 latency** | Tail latency divergence from median |
| **Connection pool wait time** | DB connection exhaustion |
| **Cache hit rate per tenant** | Cache eviction by noisy neighbor |
| **Disk I/O await** | I/O queue saturation |
| **Thread pool queue depth** | Thread starvation signals |
| **GC pause duration** | Memory pressure from a single process |

### 6.2 Observability Architecture

```
Application → Metrics (Prometheus) → Dashboards (Grafana)
           → Traces  (Jaeger)      → Latency attribution per tenant
           → Logs    (ELK Stack)   → Error correlation
           
Alert Rules:
  - P99 latency > 2× baseline for 2m → Page on-call
  - CPU steal time > 20% for 5m → Investigate hypervisor
  - Connection pool utilization > 80% → Scale or throttle
```

---

## 7. Trade-offs

| Strategy | Benefit | Trade-off |
|---|---|---|
| **Hard resource limits** | Prevents starvation | Under-utilization during quiet periods |
| **Physical isolation** | Complete isolation | High cost, lower resource efficiency |
| **Soft limits / burstable** | Better resource utilization | Risk of burst causing neighbor impact |
| **Separate node pools** | Predictable performance | Increased infrastructure cost |
| **Strict rate limiting** | Fairness across tenants | Legitimate burst traffic gets rejected |
| **Dedicated DB per tenant** | Full isolation | Schema management complexity, higher cost |
| **Shared DB with quotas** | Cost-efficient | Imperfect isolation, complex quota enforcement |
| **Time-based scheduling** | Keeps batch away from OLTP | Delays batch job completion |

### 7.1 The Isolation vs. Efficiency Spectrum

```
  Full Sharing ←──────────────────────────────→ Full Isolation
  
  Low Cost      Soft Limits    Hard Limits    Dedicated HW
  Low Isolation  ↑              ↑              High Isolation
                 Best balance   K8s QoS
                 for most SaaS  classes
```

---

## 8. Real-World Systems & Examples

### 8.1 AWS EC2 (CPU Steal Time)

AWS observed noisy neighbor problems in early EC2 generations where burstable T2/T3 instances on the same host competed for CPU credits. AWS addressed this with:
- **CPU credit system** — burst capacity is pre-allocated per instance
- **Placement Groups** — cluster or spread instances for isolation
- **Dedicated Hosts** — physical server reserved for a single customer
- **Nitro Hypervisor** — offloads I/O to dedicated hardware, reducing software-level contention

### 8.2 Google Cloud (Live Migration)

GCP uses **live migration** to move a VM away from a noisy physical host without downtime — the VM transparently moves to a quieter host when the hypervisor detects resource contention.

### 8.3 Netflix (Bulkheads in Hystrix)

Netflix's Hystrix library popularized the **bulkhead pattern** for JVM services. Each downstream dependency (user service, billing, recommendations) got its own thread pool. A slow recommendations service would exhaust only its pool, not starving calls to the user service.

```
Netflix API Gateway (Hystrix Bulkheads)
├── Recommendations Pool: 40 threads  ← can fill up independently
├── User Profile Pool:    20 threads
├── Billing Pool:         10 threads
└── Catalog Pool:         30 threads
```

### 8.4 Salesforce (Multi-Tenant Database)

Salesforce runs thousands of customers on shared Oracle databases. They enforce **per-tenant query governor limits**: max rows fetched, max CPU time per transaction, max SOQL queries per request. Exceeding limits throws a `LimitException`, protecting all other tenants on the org.

### 8.5 Azure SQL / Elastic Pools

Azure's Elastic Pool allows multiple databases to share a pool of DTUs (Database Transaction Units) with per-database min/max DTU limits. A noisy database is capped at its max DTU ceiling, preserving headroom for siblings.

### 8.6 Kafka (Producer Quotas)

Kafka supports **byte-rate and request-rate quotas per producer/consumer**. Brokers throttle clients that exceed their quota by delaying `Produce` and `Fetch` responses, preventing a single producer from saturating broker I/O.

```
kafka-configs.sh --alter \
  --add-config 'producer_byte_rate=1048576' \  # 1 MB/s per producer
  --entity-type clients \
  --entity-name tenant_a
```

### 8.7 Cloudflare (Rate Limiting at Edge)

Cloudflare enforces per-zone, per-IP rate limits at the edge to prevent a single customer's traffic surge (or DDoS) from affecting global routing infrastructure shared across all customers.

### 8.8 Kubernetes (Resource Quotas + LimitRanges)

Large SaaS companies running multi-tenant Kubernetes clusters use:
- **ResourceQuota** — namespace-level CPU/memory ceiling
- **LimitRange** — default and max limits for individual pods
- **PriorityClasses** — evict low-priority pods first under pressure
- **Node taints/tolerations** — reserve premium nodes for production workloads

---

## 9. Decision Framework

```
Is your system multi-tenant or sharing resources across workloads?
│
├── Yes → Do you have hard resource limits enforced?
│         │
│         ├── No  → START HERE: Add CPU/memory limits + rate limits
│         │
│         └── Yes → Are you seeing tail latency divergence (P99 >> P50)?
│                   │
│                   ├── No  → Monitor with P99/steal-time dashboards
│                   │
│                   └── Yes → Identify the noisy tenant (per-tenant metrics)
│                             │
│                             ├── Spiky/bursty? → Separate node pool + schedule off-peak
│                             ├── DB heavy?     → Per-tenant query quotas + connection limits
│                             ├── Cache heavy?  → Tenant namespace isolation
│                             └── Still bad?    → Move toward physical/VM isolation
│
└── No → Noisy neighbor risk is lower; focus on other antipatterns
```

---

## 10. Anti-Patterns to Avoid

| Anti-Pattern | Why It's Dangerous |
|---|---|
| **No resource limits on containers** | Single runaway pod kills entire node |
| **Shared Redis with `KEYS *` allowed** | O(N) blocking operation freezes all clients |
| **Single DB connection pool for all tenants** | One tenant exhausts the pool for everyone |
| **Unbounded thread pools** | Slow dependency cascades into full service degradation |
| **Trusting averages in monitoring** | Bursts are invisible; P99 tells the real story |
| **Running batch and OLTP on same cluster** | Batch I/O crushes latency-sensitive queries |
| **No per-tenant observability** | Can't identify *who* is the noisy neighbor |
| **Ignoring CPU steal time metrics** | Hypervisor-level noisy neighbor goes undetected |

---

## 11. Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                  Noisy Neighbor — Quick Reference               │
├──────────────────┬──────────────────────────────────────────────┤
│ Root Cause       │ Shared resources, no isolation/quotas        │
│ Key Symptoms     │ P99 latency spikes, intermittent timeouts    │
│ Detection        │ CPU steal time, per-tenant P99, pool depth   │
│ First Mitigations│ Resource limits, rate limiting, bulkheads    │
│ Strong Fix       │ Separate pools / dedicated infrastructure    │
│ Classic Examples │ AWS EC2 steal, Kafka quotas, K8s QoS, Hystrix│
│ Key Trade-off    │ Isolation ↑ = Cost ↑ & Utilization ↓         │
└──────────────────┴──────────────────────────────────────────────┘
```