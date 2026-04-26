# System Design Notes

> **Scope:** Introduction — foundational concepts, patterns, tools, and real-world examples.

---

## Table of Contents

| # | File | Description |
|---|------|-------------|
| 1 | [01-fundamentals.md](./01-fundamentals.md) | Core building blocks: scaling, replication, CAP theorem, microservices, proxies, queues, file systems |
| 2 | [02-architecture-patterns.md](./02-architecture-patterns.md) | Design patterns: 2PC, RLBS, CQRS, Saga, Sharding |
| 3 | [03-tools-and-techniques.md](./03-tools-and-techniques.md) | DFDs, UML, APIs, contracts, pseudocode, decision tables |
| 4 | [04-system-examples.md](./04-system-examples.md) | Real-world designs: eCommerce, CDN, Social Platform, IoT |

---

## What Is System Design?

System design is the process of **defining the architecture, components, modules, interfaces, and overall structure** of a system to satisfy specified requirements. It produces a blueprint that describes how elements interact to achieve the desired:

- **Functionality** — the system does what it is supposed to do
- **Performance** — the system responds within acceptable bounds under load
- **Reliability** — the system behaves correctly even in the presence of failures

---

## System Design vs. Software Design

These terms are often confused. The key distinction is **scope and abstraction level**.

| Dimension | System Design | Software Design |
|-----------|--------------|-----------------|
| **Scope** | Entire system — services, infrastructure, data stores, networks | Individual application or component |
| **Abstraction** | High-level architecture and component interaction | Class structure, algorithms, data structures |
| **Primary concerns** | Scalability, availability, fault tolerance, latency | Correctness, maintainability, code quality |
| **Stakeholders** | Architects, engineering leads, ops teams | Individual developers, tech leads |
| **Outputs** | Architecture diagrams, capacity plans, SLAs | Class diagrams, API contracts, unit tests |

> Both disciplines are complementary. A good system design provides the skeleton; good software design fills it with muscle.

---

## Quick-Reference: Key Properties

| Property | Definition | Primary Mechanism |
|----------|-----------|------------------|
| **Scalability** | Ability to handle growing load | Horizontal / vertical scaling |
| **Availability** | Fraction of time the system is operational | Redundancy, replication |
| **Consistency** | All nodes see the same data at the same time | Replication protocols, 2PC |
| **Partition Tolerance** | System continues operating despite network splits | CAP trade-offs |
| **Fault Tolerance** | System recovers from component failures | Redundancy, sagas, retries |
| **Maintainability** | Ease of modifying and operating the system | Microservices, CQRS |

---

*Navigate to any file above to dive deeper into each topic.*