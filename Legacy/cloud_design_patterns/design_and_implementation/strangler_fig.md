# Strangler Fig Pattern
### Cloud Design Patterns → Design & Implementation

---

## 1. Overview

The **Strangler Fig Pattern** is an incremental migration strategy for replacing a legacy system with a new system by gradually routing functionality away from the old system until it can be decommissioned entirely — without a risky "big bang" rewrite.

The name comes from the strangler fig tree, which grows around a host tree, slowly replacing it. The host tree eventually dies and rots away, leaving the fig tree standing on its own.

> **Core Idea:** Incrementally build a new system alongside the old one, intercept traffic at a facade layer, and progressively redirect calls to the new system — piece by piece — until the legacy system can be safely retired.

---

## 2. Problem It Solves

Legacy systems accumulate problems over time:

- **Technical debt** — outdated languages, frameworks, or architectures
- **Scaling bottlenecks** — monoliths that can't scale horizontally
- **Deployment risk** — tightly coupled components make isolated deployments impossible
- **Onboarding friction** — complex, undocumented codebases slow teams down
- **Vendor lock-in** — legacy infrastructure or proprietary platforms

A full rewrite is extremely high-risk (the "second-system effect"). The Strangler Fig pattern solves this by eliminating the need to rewrite everything at once.

---

## 3. How It Works

```
                         ┌──────────────────────────────────────────┐
                         │             FACADE / PROXY                │
                         │    (API Gateway, Reverse Proxy, Router)   │
                         └───────────────┬──────────────────────────┘
                                         │
                         ┌───────────────┴──────────────────┐
                         │                                  │
              ┌──────────▼──────────┐           ┌──────────▼──────────┐
              │   LEGACY SYSTEM     │           │    NEW SYSTEM        │
              │   (Monolith / Old   │           │   (Microservices /   │
              │    Architecture)    │           │   Rewritten Services)│
              └─────────────────────┘           └─────────────────────┘
              
              [Gradually shrinks]               [Gradually grows]
```

### Three Core Steps

#### Step 1 — Transform
Identify a bounded slice of functionality to extract. Build it fresh in the new system, independently of the legacy.

#### Step 2 — Coexist
Both systems run simultaneously. The facade routes specific requests to the new system while everything else still hits the legacy. The two systems may need a **data synchronization layer** (dual-write or CDC) during this phase.

#### Step 3 — Eliminate
Once traffic for the migrated slice is fully proven on the new system, remove the corresponding code from the legacy. Repeat until the legacy is empty and can be decommissioned.

---

## 4. Key Components

| Component | Role |
|---|---|
| **Facade / Proxy** | Single entry point. Routes requests to old or new based on routing rules. Can be an API Gateway, Nginx, Envoy, or a custom router |
| **Legacy System** | The existing monolith or old architecture. Continues to serve un-migrated functionality |
| **New System** | The replacement — typically microservices, modern cloud-native architecture |
| **Data Sync Layer** | Keeps data consistent between old and new DBs during coexistence. Strategies: dual-write, CDC (Change Data Capture), event streaming |
| **Feature Flags** | Control routing granularity — per-user, per-region, per-request-type |
| **Monitoring & Parity Checks** | Ensure the new system behaves identically to the old before fully routing traffic |

---

## 5. Migration Strategies

### 5.1 By Feature/Domain
Extract one bounded domain at a time (e.g., extract "user authentication" service first, then "product catalog", then "checkout").

**Best for:** Monoliths with identifiable domain boundaries.

### 5.2 By Request Type
Route read traffic to new system first; writes stay on legacy until the new system is proven stable.

**Best for:** Systems with heavy read/write asymmetry.

### 5.3 By User Cohort (Canary Strangling)
Route a percentage of users (e.g., 5% → 25% → 100%) to the new system progressively.

**Best for:** Consumer-facing systems where rollback granularity matters.

### 5.4 By Data Entity
Migrate the service layer for one entity type at a time (e.g., "orders" before "invoices").

**Best for:** Data-heavy systems with clear entity ownership.

---

## 6. Data Migration Challenges

Data is the hardest part of the Strangler Fig. The new system needs data, but the old system still owns it.

### Options

```
Option A — Shared Database (Short-term)
  Legacy ──────┐
               ├──► Shared DB
  New System ──┘
  
  Pros: Simple, no sync needed
  Cons: Tight coupling, blocks true independence

Option B — Dual Write
  Application writes to BOTH databases simultaneously.
  
  Legacy DB ◄── App ──► New DB
  
  Pros: Both DBs stay in sync
  Cons: Two-phase commit complexity, failure handling

Option C — Change Data Capture (CDC)
  Legacy DB ──► CDC Tool (Debezium) ──► Event Stream ──► New DB
  
  Pros: Non-invasive to application code
  Cons: Eventual consistency, replication lag

Option D — Event-Driven Sync
  App publishes domain events; new service consumes them to build its own read model.
  
  Pros: Decoupled, scalable
  Cons: Complex event sourcing setup
```

---

## 7. Trade-offs

### Advantages

| Advantage | Detail |
|---|---|
| **Low risk** | No big bang rewrite; rollback is trivial — just reroute traffic back to legacy |
| **Continuous delivery** | Teams can deploy the new system incrementally without freezing the old one |
| **Value earlier** | Migrated slices deliver value before full migration completes |
| **Independent scaling** | New services can scale independently while legacy handles the rest |
| **Proven path** | Widely validated in industry for monolith-to-microservices migrations |

### Disadvantages

| Disadvantage | Detail |
|---|---|
| **Operational complexity** | Running two systems simultaneously doubles infrastructure, monitoring, and on-call burden |
| **Data synchronization** | Dual-write and CDC are complex to implement correctly; failure modes multiply |
| **Facade becomes SPOF** | The routing proxy is a single point of failure and a potential bottleneck; must be highly available |
| **Long coexistence period** | Migrations often drag on; teams lose motivation; the "half-migrated" state can persist indefinitely |
| **Behavior parity risk** | Subtle differences between old and new system behavior are hard to catch without exhaustive testing |
| **Increased latency** | An extra network hop through the facade adds latency |
| **Feature freeze risk** | Legacy codebase may need to be kept up-to-date during migration, adding maintenance overhead |

---

## 8. When to Use

✅ **Use when:**
- Migrating a large legacy monolith to microservices
- The system must remain live 24/7 with no downtime windows
- The team cannot afford the risk of a full rewrite
- Domain boundaries are identifiable in the legacy system
- Business stakeholders require incremental value delivery

❌ **Avoid when:**
- The legacy system is so tightly coupled that extracting any slice requires touching the entire codebase
- The legacy system has no clear external interface (no HTTP/RPC boundary to intercept)
- The legacy system will be replaced by an off-the-shelf product (buy vs. build)
- The team lacks the discipline to actually decommission legacy pieces after migration

---

## 9. Related Patterns

| Pattern | Relationship |
|---|---|
| **Anti-Corruption Layer** | Often implemented at the facade boundary to translate between old and new domain models |
| **Backends for Frontends (BFF)** | Can serve as the facade layer routing traffic during a Strangler Fig migration |
| **Event Sourcing / CQRS** | Useful for building the new system's data layer independently of the legacy DB |
| **Sidecar / Ambassador** | Proxy patterns used to implement the routing facade in service mesh setups |
| **Feature Flags / Dark Launch** | Used alongside Strangler Fig to control user-level routing granularity |
| **Branch by Abstraction** | A code-level technique that complements Strangler Fig for shared libraries or modules |

---

## 10. Implementation Guide

### Phase 1 — Preparation
1. Map the legacy system's boundaries and identify candidate slices for extraction (start with low-risk, low-coupling areas)
2. Deploy a facade (API Gateway or reverse proxy) in front of the legacy system — with 100% pass-through initially
3. Establish monitoring and parity-testing infrastructure

### Phase 2 — First Migration Slice
1. Build the new service independently; do not modify the legacy
2. Set up data synchronization (CDC or dual-write) if necessary
3. Shadow traffic: run both systems in parallel, compare responses without serving the new system to users
4. Gradually route a small percentage of real traffic using feature flags
5. Monitor error rates, latency, and data consistency
6. Cut over fully once confidence is established

### Phase 3 — Eliminate Legacy Slice
1. Remove the migrated feature from the legacy codebase
2. Disable data sync for the migrated entities
3. Update the facade routing rules to permanently point to the new service

### Phase 4 — Repeat
Apply to the next slice. Automate parity testing. Keep a public migration status dashboard visible to all stakeholders.

### Phase 5 — Decommission
Once all slices are migrated, remove the legacy system and simplify the facade into a standard API Gateway.

---

## 11. Real-World Examples

### 11.1 Amazon — Monolith to Microservices (Early 2000s)
Amazon's retail platform was a classic monolith. They used a Strangler Fig approach to extract services (cart, recommendations, product catalog) one at a time over several years. Each service got its own API, database, and deployment pipeline. The facade was progressively updated to route requests to new services. This migration is credited as the origin of AWS — they needed robust infrastructure for the new services they were building.

### 11.2 LinkedIn — Move Off Oracle
LinkedIn migrated their core data infrastructure away from a centralized Oracle database over multiple years using a Strangler Fig approach. They built Espresso (document store) and Voldemort (key-value store) as replacements, routed specific data access patterns to them, and progressively drained Oracle. Zero downtime throughout.

### 11.3 Shopify — Modularizing the Monolith
Shopify's Rails monolith serves millions of merchants. They used a Strangler Fig-style approach (combined with their "Modular Monolith" strategy) to extract bounded contexts (e.g., Shipping, Payments, Identity) into separate modules and eventually separate services, with a routing layer (backed by their own Storefront API) acting as the facade.

### 11.4 Uber — Trip Domain Migration
Uber migrated their trip processing pipeline from a PHP monolith to Go microservices. The facade was their API gateway. They extracted the `trip` domain first (highest coupling, highest risk, highest payoff), used dual-write for data consistency between MySQL and their new Schemaless store, and gradually shifted traffic over weeks.

### 11.5 GitHub — Rails Monolith Migration
GitHub has been incrementally extracting services from their Rails monolith (github.com is one of the largest Rails apps ever). Features like Actions, Packages, and Codespaces run as separate services, with the routing layer directing relevant traffic while the monolith handles remaining features.

### 11.6 Ticketmaster
Ticketmaster used Strangler Fig to decompose their monolith into microservices over ~3 years. They introduced an API gateway facade, extracted the inventory service first (since it had clear boundaries and high traffic), and progressively migrated downstream dependencies.

---

## 12. Strangler Fig vs. Big Bang Rewrite

| Dimension | Strangler Fig | Big Bang Rewrite |
|---|---|---|
| **Risk** | Low — incremental, rollback easy | Very High — all-or-nothing |
| **Delivery** | Continuous value during migration | No value until full rewrite ships |
| **Timeline** | Months to years (managed) | Typically 2–4x longer than estimated |
| **Team Burden** | Parallel maintenance overhead | Full focus on new system |
| **Business Continuity** | Zero downtime | Often requires downtime window |
| **Historical Success Rate** | High | Notoriously low |

> Joel Spolsky's "Things You Should Never Do" (2000) documented why big bang rewrites almost always fail — they discard years of accumulated bug fixes and edge-case handling embedded in the legacy code.

---

## 13. Anti-Patterns

| Anti-Pattern | Description |
|---|---|
| **Neverending Migration** | Teams keep migrating but never eliminate legacy slices; the legacy lives indefinitely alongside the new system |
| **Facade Overload** | Too much business logic leaks into the routing facade, making it a new monolith |
| **Skipping Data Decoupling** | New services share the legacy DB; true independence is never achieved |
| **Boiling the Ocean** | Trying to migrate too many slices simultaneously; creates chaos without finishing any |
| **No Parity Testing** | Routing traffic to new services without validating behavioral equivalence; silent bugs slip through |

---

## 14. Interview Cheat Sheet

| Question | Key Answer |
|---|---|
| What is the Strangler Fig pattern? | Incrementally replace a legacy system by routing traffic to a new system slice-by-slice via a facade, until the legacy can be decommissioned |
| What is the facade's role? | Acts as the traffic router/interceptor — routes requests to old or new system based on rules; must be transparent and highly available |
| How do you handle data during migration? | Options: shared DB (short-term), dual-write, CDC (Debezium), or event-driven sync; choice depends on consistency requirements and coupling tolerance |
| What's the biggest risk? | Long coexistence period where migration never completes; mitigate with strict slice ownership and decommission SLAs |
| How does it differ from Branch by Abstraction? | Branch by Abstraction is a code-level pattern (in-process); Strangler Fig is an architectural/network-level pattern (between services) |
| When would you NOT use it? | When the legacy has no external interface to intercept, or when it's being replaced by a bought solution |
| Which slice do you migrate first? | Typically the lowest-coupling, highest-value slice first (quick wins build confidence); or the highest-risk if it's the bottleneck |