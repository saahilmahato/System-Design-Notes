## Introduction

Two of the most misunderstood and conflated concepts in system design are **performance** and **scalability**. They are related, but they are not the same thing — and optimizing for one can actively hurt the other.

**Performance** is about speed. How fast does the system respond to a single user, a single request, a single transaction? It is measured in latency and lives or dies by your slowest bottleneck — usually I/O.

**Scalability** is about growth. Does the system stay fast as the number of users, requests, and data grows? A scalable system delivers proportional gains when you add resources. Critically, scalability cannot be bolted on after the fact. It must be designed in from the start.

Many techniques that make a system scalable — load balancers, message queues, distributed caches, sharding — add small amounts of overhead to individual requests. This is an intentional and acceptable trade-off: a slightly slower single request is worth it if the system can handle millions of them without collapsing.

These notes cover both concepts in depth, how they interact, where they conflict, and the concrete techniques used to achieve both.

---

## Contents

| File | What It Covers |
|---|---|
| [performance.md](performance.md) | Latency, throughput, percentiles, bottlenecks, Amdahl's Law, SLOs |
| [scalability.md](scalability.md) | Scale axes (X/Y/Z), statelessness, DB scaling, heterogeneity, anti-patterns |
| [performance-vs-scalability.md](performance-vs-scalability.md) | Comparison, trade-offs, Little's Law, decision framework, design checklist |
| [scalability-techniques.md](scalability-techniques.md) | Caching, load balancing, message queues, sharding, replicas, CDN, CQRS |

---

## Where to Start

- New to these concepts → start with [performance-vs-scalability.md](performance-vs-scalability.md)
- Need depth on one topic → go directly to [performance.md](performance.md) or [scalability.md](scalability.md)
- Solving a specific scaling problem → jump to [scalability-techniques.md](scalability-techniques.md)