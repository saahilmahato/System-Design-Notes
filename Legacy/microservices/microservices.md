# Microservices — System Design Notes

---

## 1. What Are Microservices?

Microservices is an **architectural style** where an application is built as a collection of small, independently deployable services. Each service:
- Owns a **single business capability**
- Runs in its **own process**
- Communicates over a **network** (HTTP/REST, gRPC, message queues)
- Is **independently deployable and scalable**

Contrast with a **Monolith**, where all functionality lives in a single deployable unit.

---

## 2. Core Principles

- **Single Responsibility** — Each service does one thing well.
- **Loose Coupling** — Services are independent; a change in one should not break others.
- **High Cohesion** — Related logic lives within the same service boundary.
- **Decentralized Data Management** — Each service owns its own database (Database-per-Service pattern).
- **Design for Failure** — Services must handle partial failures gracefully.
- **Automation First** — CI/CD and container orchestration are essential, not optional.

---

## 3. Communication Patterns

### Synchronous
| Protocol | Use Case |
|---|---|
| REST (HTTP/HTTPS) | Simple request-response, public-facing APIs |
| gRPC | Low-latency, internal service-to-service calls |
| GraphQL | Flexible querying, API gateway aggregation |

### Asynchronous
| Pattern | Use Case |
|---|---|
| Message Queues (RabbitMQ, SQS) | Task offloading, decoupled processing |
| Event Streaming (Kafka) | Event-driven pipelines, audit logs, fan-out |
| Pub/Sub (Google Pub/Sub, SNS) | Broadcasting events to multiple consumers |

> **Rule of thumb:** Prefer async communication for non-critical paths to improve resilience and decouple service lifecycles.

---

## 4. Key Design Patterns

### Service Discovery
Services need to find each other dynamically.
- **Client-side discovery** — Client queries a registry (e.g., Eureka) and load balances itself.
- **Server-side discovery** — A load balancer/proxy (e.g., AWS ALB, Nginx) handles routing.

### API Gateway
A single entry point that handles:
- Request routing
- Auth / rate limiting
- SSL termination
- Response aggregation

Examples: Kong, AWS API Gateway, Netflix Zuul, Nginx.

### Circuit Breaker
Prevents cascading failures. If a downstream service is unhealthy, the circuit "opens" and returns a fallback instead of waiting for timeouts.

States: `Closed → Open → Half-Open`

Libraries: Resilience4j, Hystrix (deprecated), Polly (.NET).

### Saga Pattern
Manages distributed transactions across multiple services without 2PC (two-phase commit).
- **Choreography** — Each service emits events that trigger the next step.
- **Orchestration** — A central Saga Orchestrator tells each service what to do.

### Strangler Fig Pattern
Incrementally migrate a monolith to microservices by routing traffic to new services piece by piece, until the monolith is fully replaced.

### Sidecar Pattern
Deploy a helper container alongside a service container (e.g., in Kubernetes) to handle cross-cutting concerns like logging, metrics, or mTLS — without modifying application code.

---

## 5. Data Management

### Database-per-Service
Each service has its own isolated database. This enforces loose coupling but introduces complexity around:
- Joins across services (use API composition or CQRS)
- Distributed transactions (use Sagas)
- Data consistency (eventual consistency is the norm)

### CQRS (Command Query Responsibility Segregation)
Separate the **write model** (commands) from the **read model** (queries). Often paired with **Event Sourcing**, where state is derived by replaying a sequence of events.

### Shared Database (Anti-Pattern)
Multiple services sharing one DB creates tight coupling — avoid unless in an early migration phase.

---

## 6. Observability

Debugging distributed systems is hard. The three pillars are:

| Pillar | Tooling |
|---|---|
| **Logs** | ELK Stack, Loki, Datadog |
| **Metrics** | Prometheus + Grafana, CloudWatch |
| **Traces** | Jaeger, Zipkin, AWS X-Ray, OpenTelemetry |

**Distributed Tracing** is critical — a single user request may span 10+ services. A `trace-id` propagated in request headers allows you to reconstruct the full call chain.

---

## 7. Deployment & Infrastructure

- **Containers (Docker)** — Package each service with its dependencies.
- **Orchestration (Kubernetes)** — Manage deployments, scaling, health checks, and service discovery.
- **Service Mesh (Istio, Linkerd)** — Handles mTLS, observability, and traffic management at the infrastructure layer, transparent to application code.
- **CI/CD Pipelines** — Mandatory. Each service should have its own independent pipeline.

---

## 8. Security

- **mTLS** — Mutual TLS between services to prevent unauthorized internal communication.
- **JWT / OAuth 2.0** — Token-based auth validated at the API Gateway or per-service.
- **Secrets Management** — HashiCorp Vault, AWS Secrets Manager — never hardcode credentials.
- **Principle of Least Privilege** — Each service should have minimal permissions.

---

## 9. Trade-offs

### ✅ Advantages

| Benefit | Detail |
|---|---|
| **Independent deployment** | Ship and rollback services without affecting others |
| **Technology heterogeneity** | Choose the best language/DB per service |
| **Independent scalability** | Scale only the bottleneck service |
| **Fault isolation** | A crash in one service doesn't bring down the system |
| **Team autonomy** | Teams own their service end-to-end (Conway's Law alignment) |
| **Easier to understand** | Each service is a small, focused codebase |

### ❌ Disadvantages

| Cost | Detail |
|---|---|
| **Operational complexity** | Many moving parts — more to deploy, monitor, and debug |
| **Network latency** | Inter-service calls over a network are slower and can fail |
| **Distributed systems problems** | Partial failures, eventual consistency, split-brain |
| **Data management complexity** | No simple joins; distributed transactions are hard |
| **Service proliferation** | Too many tiny services ("nano-services") become unmanageable |
| **Testing difficulty** | Integration and contract testing across services is complex |
| **High initial investment** | Requires mature DevOps, CI/CD, and monitoring from day one |

> **Key insight:** Microservices trade **simplicity** for **scalability and team independence**. They are not the right default — start with a monolith and extract services when pain points emerge.

---

## 10. When to Use Microservices

**Use when:**
- The system has **high scalability requirements** with distinct hot paths
- Multiple **large teams** work on the same product
- Different components have **different uptime, compliance, or technology** requirements
- The domain is **well-understood** and service boundaries are clear

**Avoid when:**
- Building an **MVP or early-stage product** (boundaries aren't clear yet)
- The **team is small** (< 10–15 engineers)
- You lack mature **DevOps and observability** infrastructure

---

## 11. Real-World Systems & Applications

### Netflix
- One of the earliest and most cited adopters.
- Hundreds of microservices handle streaming, recommendations, billing, and auth independently.
- Built open-source tools for the ecosystem: **Eureka** (service discovery), **Hystrix** (circuit breaker), **Zuul** (API gateway), **Ribbon** (client-side load balancing).
- Uses **Chaos Engineering (Chaos Monkey)** to proactively test resilience.

### Amazon
- Transitioned from a monolith to microservices in the early 2000s — the famous "two-pizza team" model.
- Each team owns a service with a well-defined API, which later became the foundation for **AWS**.
- Cart, Recommendations, Search, and Payments are all separate services.

### Uber
- Started as a monolith, migrated to microservices as scale demanded.
- Uses **gRPC** for internal communication and **Kafka** for event streaming between services.
- Services include: Trip, Driver, Pricing, Notifications, Maps, Payments — each independently scaled.

### Spotify
- "Squad" model aligns engineering teams with microservice ownership.
- Services for playlist management, streaming, search, social features, and ads are independent.
- Heavy use of **Google Cloud Pub/Sub** and **Kafka** for event-driven communication.

### Airbnb
- Uses the **Strangler Fig pattern** to migrate away from its Rails monolith.
- Key services: Search, Listings, Payments, Messaging, Reviews — each independently deployed.
- Built **SmartStack** for service discovery.

### Twitter (now X)
- Migrated core functionality (tweets, timelines, notifications) into separate services.
- The **fanout** problem (distributing a tweet to millions of followers) is handled by a dedicated Fanout Service using async messaging.

---

## 12. Quick Reference: Key Numbers & Thresholds

| Topic | Guideline |
|---|---|
| Service size | 1–2 pizza teams (5–10 engineers) per service |
| API response time (internal) | < 10ms for gRPC, < 50ms for REST |
| Circuit breaker threshold | Open after ~50% failure rate in a time window |
| Recommended starting point | Modular Monolith → then extract services |
| Service count at scale | Netflix: ~1000+, Uber: ~2000+ microservices |
