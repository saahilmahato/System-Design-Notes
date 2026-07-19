# Failover

---

## What is Failover?

**Failover** is the automatic (or manual) process of switching from a failed or degraded component to a healthy backup component, with the goal of maintaining service continuity.

It answers one question: **"When the primary goes down, how does traffic keep flowing?"**

Failover is not a standalone concept — it works in conjunction with:
- **Health checks** to detect failures
- **Replication** to keep backup data current
- **Load balancers / DNS** to redirect traffic

---

## How Failure is Detected

Before failover can trigger, the system must detect that something is wrong.

| Detection Method | How it Works | Tradeoff |
|---|---|---|
| **Heartbeat / Keep-alive** | Primary sends periodic signals to standby; silence = failure | Fast detection, but network hiccups can cause false positives |
| **Health check endpoint** | Load balancer or monitor polls `/health`; non-200 = unhealthy | Simple; can miss deep failures (DB is down but HTTP is up) |
| **Gossip protocol** | Nodes share health status with each other (used in Cassandra, Consul) | Decentralized, resilient, slightly slower |
| **External watchdog** | Separate monitoring service (Prometheus, Datadog) detects failure and triggers action | Reliable but adds external dependency |
| **Client-side detection** | Clients receive errors and reroute themselves | Last resort; users experience errors before reroute |

**Key tradeoff:** Faster detection = more false positives. Slower detection = longer real downtime. Tune your timeout thresholds carefully.

---

## Failover Types

### 1. Active-Passive (Master-Slave Failover)

- **One server handles all traffic** (active); another sits on standby (passive)
- The passive server constantly monitors the active via **heartbeat signals**
- On failure: passive takes over the active server's **IP address** and resumes service
- Also known as: **master-slave failover**

```
Normal:
  [Clients] ──▶ [Active Server] ──heartbeat──▶ [Passive Server (idle)]

On Failure:
  [Clients] ──▶ [Passive Server] (now promoted, takes active IP)
                [Active Server] (down)
```

**Standby Modes:**

| Mode | Description | Failover Speed |
|---|---|---|
| **Hot standby** | Passive is running, fully synced, ready to serve immediately | Seconds (30–60s typically) |
| **Warm standby** | Passive is running but not fully synced; needs a short catch-up | Minutes |
| **Cold standby** | Passive is off; must boot and sync before serving | Minutes to hours |

**When to use Active-Passive:**
- Mission-critical systems needing simple, predictable recovery (banking, healthcare, ERPs)
- Database-heavy workloads needing strong consistency (avoids multi-master write conflicts)
- Legacy systems not designed for distributed computing
- Budget-constrained setups — standby can use less powerful hardware
- Small IT teams — easier to understand, troubleshoot, and maintain

**Advantages:**
- Simple mental model — clear primary/backup roles
- No write conflicts — only one node ever accepts writes at a time
- Controlled failback — admin can verify, test, and choose when to switch back
- Standby can be used for maintenance without affecting production

**Disadvantages:**
- **Brief downtime during failover** (30–60 seconds depending on standby mode)
- Potential **data loss** if active fails before replication completes
- Standby resources are idle — hardware is paid for but not utilized
- Promoting passive to active requires additional orchestration logic
- Failback must be carefully managed to avoid re-introducing a stale primary

---

### 2. Active-Active (Master-Master Failover)

- **All servers handle live traffic simultaneously**, sharing the load
- A **load balancer** distributes requests and monitors server health
- On failure: load balancer instantly redirects traffic to remaining healthy nodes — no standby activation needed
- Also known as: **master-master failover**

```
Normal:
  [Clients] ──▶ [Load Balancer]
                    ├──▶ [Server A] (active)
                    ├──▶ [Server B] (active)
                    └──▶ [Server C] (active)

On Server B Failure:
  [Clients] ──▶ [Load Balancer]
                    ├──▶ [Server A] (absorbs extra load)
                    └──▶ [Server C] (absorbs extra load)
```

**DNS Considerations:**
- **Public-facing servers**: DNS must know about IPs of all active nodes (round-robin DNS or Anycast)
- **Internal servers**: Application logic or service discovery (Consul, etcd) must be aware of all nodes

**When to use Active-Active:**
- High-traffic systems: e-commerce platforms, social networks, CDNs
- Cloud-native / microservices architectures
- Global businesses needing low-latency access across regions
- Real-time applications: gaming, live streaming, collaborative tools
- Systems that need **zero-downtime maintenance** (take one node offline, others absorb load)
- Financial services requiring 24/7 uninterrupted operation

**Advantages:**
- **Zero downtime on failure** — failover is seamless, users don't notice
- Full hardware utilization — no idle standby nodes
- Horizontal scalability — add nodes to increase capacity
- Maintenance without downtime — take nodes offline one at a time
- Better performance — load is distributed, no single bottleneck
- Geographic distribution — deploy nodes across regions for low latency

**Disadvantages:**
- **Higher complexity** — requires load balancing, session management, data sync
- **Data consistency challenges** — concurrent writes to multiple nodes require conflict resolution
- Higher cost — all nodes must be production-grade hardware
- Applications must be designed for distributed operation (stateless or shared session stores)
- Debugging is harder across multiple active nodes
- Risk of **thundering herd** — if one node dies, others absorb sudden load spike

---

## Active-Passive vs. Active-Active — Full Comparison

| Factor | Active-Passive | Active-Active |
|---|---|---|
| **Servers handling traffic** | One (primary only) | All simultaneously |
| **Failover speed** | 30–60 seconds (hot standby) | Near-instant |
| **Downtime on failure** | Brief but present | Effectively zero |
| **Resource utilization** | Low (standby is idle) | High (all nodes used) |
| **Write conflicts** | None (single writer) | Possible (needs conflict resolution) |
| **Data consistency** | Easier to maintain | Requires careful sync |
| **Setup complexity** | Low | High |
| **Cost** | Lower (standby can be cheaper hardware) | Higher (all nodes must be equal) |
| **Scalability** | Limited (single active node) | Easy (add more nodes) |
| **Maintenance downtime** | Required (brief) | None (rolling updates possible) |
| **Best for** | Legacy systems, DBs, budget-constrained | High-traffic, cloud-native, real-time |
| **Also called** | Master-slave failover | Master-master failover |

---

## Failover Failure Modes

Failover itself can fail. These are the most common and dangerous failure modes:

### Split-Brain
- Both old and new primary believe they are the active leader simultaneously
- Both accept writes → data diverges → consistency violated
- **Causes:** network partition between nodes (each thinks the other is dead)
- **Fixes:**
  - **STONITH** (Shoot The Other Node In The Head) — forcibly power off the old primary
  - **Fencing tokens** — monotonically increasing token; node with lower token is rejected
  - **Quorum / majority consensus** — node can only become primary if acknowledged by majority (Raft, Paxos)

### False Failover (Flapping)
- A healthy primary is declared dead due to a transient network glitch
- Standby is promoted unnecessarily
- When primary recovers, you have two primaries → split-brain
- **Fixes:** Use longer, more conservative heartbeat timeouts; require multiple consecutive failures before triggering failover

### Data Loss on Failover
- Active fails before replicating recent writes to passive
- New primary is behind → those writes are lost
- **Fixes:** Synchronous replication to at least one standby; or use majority write quorum

### Cascading Failure
- Remaining active nodes absorb the failed node's traffic and become overloaded
- They start failing too → full outage
- **Fixes:** Capacity planning — each node must handle full load of (N-1 nodes); circuit breakers; load shedding

### Stale Primary Rejoins
- Old primary recovers and tries to rejoin as primary with stale data
- Can overwrite newer data written to the promoted replica
- **Fixes:** Old primary must always rejoin as a replica; fencing prevents it from writing

---

## Failover in Practice — Key Components

### Load Balancer Role
- Continuously polls node health endpoints
- Removes unhealthy nodes from rotation
- In active-active: distributes traffic across all healthy nodes
- In active-passive: routes all traffic to primary; switches to passive only on failure

### DNS Failover
- DNS TTL controls how quickly clients see the new IP after a failover
- **Low TTL (30–60s):** faster failover propagation but higher DNS query volume
- **High TTL (300s+):** clients may keep hitting old IP after failover
- Tools: AWS Route 53 health checks, Cloudflare Load Balancing, Azure Traffic Manager

### Session Continuity
- Active-passive: sessions tied to primary IP; seamlessly migrate on failover if IP is taken over
- Active-active: sessions must be shared (sticky sessions, Redis session store, JWT tokens)

---

## Failover Automation Tools & Patterns

| Tool / Pattern | Use Case |
|---|---|
| **Keepalived (VRRP)** | Virtual IP floats between active and passive Linux servers |
| **AWS RDS Multi-AZ** | Automatic failover to standby DB in another availability zone |
| **Redis Sentinel** | Monitors Redis master; auto-promotes replica on failure |
| **MongoDB Replica Sets** | Raft-based leader election; auto-failover in ~10s |
| **PostgreSQL Patroni** | High-availability manager; auto-promotes replica using etcd/Consul |
| **Kubernetes** | Pod/node failure triggers pod rescheduling (not traditional failover but same concept) |
| **Consul + Health Checks** | Service registry removes failing nodes from DNS/service discovery |

---

## Failover vs. Related Concepts

| Concept | Relationship to Failover |
|---|---|
| **Replication** | Prerequisite — keeps standby data current so failover is safe |
| **Load Balancing** | Mechanism — distributes traffic and enables active-active failover |
| **Circuit Breaker** | Complementary — stops calls to failing services before full failover is needed |
| **Redundancy** | Goal — failover is how redundancy is activated during an incident |
| **Disaster Recovery (DR)** | Broader — DR includes failover plus data backup, RPO/RTO planning, runbooks |

---

## RPO and RTO — Measuring Failover Quality

| Metric | Definition | Active-Passive | Active-Active |
|---|---|---|---|
| **RPO** (Recovery Point Objective) | Max acceptable data loss (time) | Seconds to minutes (async lag) | Near-zero (all nodes in sync) |
| **RTO** (Recovery Time Objective) | Max acceptable downtime | 30s–minutes (hot/warm/cold standby) | Near-zero |

- **RPO** is determined by replication lag — synchronous replication = RPO near zero
- **RTO** is determined by detection speed + promotion time — active-active = RTO near zero

---

## Quick Interview Cheatsheet

- **"How do you eliminate downtime during server failure?"** → Active-active failover with load balancer health checks
- **"What is split-brain and how do you prevent it?"** → Two nodes both think they're primary; prevent with fencing tokens, STONITH, or quorum consensus (Raft/Paxos)
- **"Active-passive vs active-active — when do you choose each?"** → Active-passive for simplicity, strong consistency, budget; active-active for zero downtime, high traffic, scale
- **"What's the risk of active-passive failover?"** → Brief downtime (30–60s) + possible data loss if replication was lagging
- **"How do you handle sessions in active-active?"** → Stateless design (JWT) or external session store (Redis)
- **"What determines failover speed?"** → Detection timeout + standby mode (hot/warm/cold) + IP takeover or DNS TTL propagation

---

> **Key Principle:** Failover is only as good as its weakest link — detection speed, replication lag, and promotion logic must all be engineered deliberately. The best failover is one the user never notices.