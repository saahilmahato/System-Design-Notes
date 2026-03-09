# Service Discovery

> How services in a distributed system locate and communicate with each other dynamically.

---

## What is Service Discovery?

In a distributed system, services are often deployed across multiple hosts with dynamically assigned IPs and ports. **Service Discovery** is the mechanism by which services automatically detect and connect to each other — without hardcoded addresses.

It answers the question: *"Where is Service X running right now?"*

Without service discovery, engineers must hardcode IP addresses and ports into configuration files — a brittle approach that breaks the moment any service scales, restarts, or moves to a new host. At scale (hundreds of microservices, thousands of instances), manual configuration is completely unmanageable.

---

## Core Concepts

### Service Registry
A centralized (or distributed) database that holds the **network locations** (IP, port, metadata) of all running service instances.

- Services **register** themselves on startup.
- Services **deregister** on shutdown (or via failed health checks).
- Clients or load balancers **query** the registry to find available instances.
- The registry is the **source of truth** for the current state of the network.

### Health Checks
The registry continuously monitors service instances to ensure they are alive and serving traffic. Unhealthy instances are removed from the pool automatically.

- **Active checks** — registry pings the service (HTTP `/health`, TCP port check, gRPC health protocol).
- **Passive / heartbeat** — service periodically sends a heartbeat to the registry. If the registry misses N heartbeats, the instance is marked dead.
- **TTL-based** — service must re-register or renew before a TTL expires, otherwise it is evicted.

### Service Metadata
Beyond IP/port, registries can store arbitrary metadata per instance:

- Version (for canary or blue/green routing)
- Availability zone / region
- Weights (for weighted load balancing)
- Tags (e.g., `env=production`, `feature=beta`)

---

## Discovery Patterns

### 1. Client-Side Discovery

The client queries the service registry directly and is responsible for selecting an instance. Load balancing logic lives in the client.

```
Client ──► Service Registry ──► [list of instances: A, B, C]
                                         │
                          Client picks B ▼
                               Service B
```

**How it works:**
1. Client calls registry: "Give me all healthy instances of `payment-service`."
2. Registry returns a list of IPs/ports.
3. Client applies a load balancing algorithm (round-robin, least connections, random) and calls the chosen instance directly.

**Pros:**
- Simple architecture — no extra network hop.
- Client has full control over load balancing strategy.
- Easy to implement custom routing (e.g., prefer same-AZ instances).

**Cons:**
- Tightly couples the client to the registry API.
- Every client in every language must implement discovery and LB logic.
- SDK must be maintained and kept in sync across polyglot services.

**Best for:** Homogeneous tech stacks (e.g., all Java/Spring), where a shared client library can be maintained.

---

### 2. Server-Side Discovery

The client sends a request to a **load balancer, router, or API gateway**, which queries the registry and forwards the request. The client is completely unaware of the registry.

```
Client ──► Load Balancer / API Gateway
                    │
                    ▼
             Service Registry
                    │
                    ▼
             Service B instance
```

**How it works:**
1. Client calls a stable endpoint (e.g., `http://payment-service/`).
2. The load balancer queries the registry for healthy instances.
3. Load balancer selects an instance and proxies the request.

**Pros:**
- Clients are fully decoupled from the registry.
- Works seamlessly across polyglot services.
- Easy to update routing/LB strategy in one place.

**Cons:**
- Extra network hop adds latency.
- Load balancer becomes a potential **Single Point of Failure (SPOF)** if not made highly available.
- Load balancer can become a bottleneck under very high traffic.

**Best for:** Polyglot environments, Kubernetes-based systems, API gateway architectures.

---

### 3. DNS-Based Discovery

Services are registered as DNS `A` or `SRV` records. Clients resolve the hostname via DNS to get one or more IPs.

```
Client ──► DNS Resolver ──► [IP1, IP2, IP3]
                                    │
                     Client calls IP1 ▼
                             Service A
```

**DNS SRV Records** allow encoding of port numbers and weights alongside the IP, making them richer than standard A records.

**Pros:**
- Universally supported — no SDK or special client required.
- Language-agnostic; works with any HTTP client.
- Familiar, well-understood tooling.

**Cons:**
- DNS TTL caching leads to stale lookups — clients may continue hitting dead instances until TTL expires.
- Limited support for fine-grained load balancing strategies.
- No native support for health-check-aware routing at the DNS layer.
- Low TTLs increase DNS query load significantly.

**Best for:** Cloud-native environments (Kubernetes), AWS Route 53 integrations, situations where SDK adoption is impractical.

---

## Self-Registration vs. Third-Party Registration

### Self-Registration
The service instance is responsible for registering and deregistering itself with the registry.

```
Service starts ──► calls registry.register(self) ──► sends heartbeats ──► calls registry.deregister(self) on shutdown
```

| Aspect | Detail |
|---|---|
| **Coupling** | Service must know about the registry (imports SDK) |
| **Failure risk** | If service crashes before deregistering, stale entry remains until TTL/health check evicts it |
| **Flexibility** | Service can include custom metadata at registration |
| **Examples** | Netflix Eureka clients, Consul agent |

### Third-Party Registration
An external system (orchestrator, sidecar agent, or deployment tool) handles registration and deregistration on behalf of the service.

```
Orchestrator detects service start ──► calls registry.register(service) ──► monitors ──► deregisters on termination
```

| Aspect | Detail |
|---|---|
| **Coupling** | Service is completely unaware of the registry |
| **Failure risk** | Orchestrator has a reliable view of lifecycle events; handles deregistration cleanly |
| **Flexibility** | Less control over metadata from within the service |
| **Examples** | Kubernetes (control plane manages endpoints), Docker Swarm, Registrator |

---

## Trade-offs

### 1. Consistency vs. Availability (CAP Theorem)

This is the most fundamental trade-off in service discovery.

| Model | Behavior | Risk | Example |
|---|---|---|---|
| **AP (Eventual Consistency)** | Registry stays available even during partitions; may return stale data | Client briefly routes to dead instances | Netflix Eureka |
| **CP (Strong Consistency)** | Registry refuses reads/writes during partitions to avoid inconsistency | Registry may be temporarily unavailable | Consul (Raft), ZooKeeper (ZAB) |

**Eureka's approach:** Favors availability. During a network partition, Eureka enters "self-preservation mode" — it stops evicting instances to avoid mass false-positive failures. The reasoning: it's better to route to a potentially stale instance than to remove all instances and get zero traffic.

**Consul's approach:** Favors consistency. Uses Raft consensus — a write must be acknowledged by a quorum of nodes before committing. Clients always get consistent data, but during a quorum loss, the registry becomes read-only or unavailable.

---

### 2. Centralized vs. Distributed Registry

| Dimension | Centralized | Distributed |
|---|---|---|
| **Operational simplicity** | ✅ Easy to deploy and manage | ❌ Complex cluster management |
| **SPOF risk** | ❌ High — single node failure = outage | ✅ Fault-tolerant by design |
| **Scalability** | ❌ Single node can become a bottleneck | ✅ Scales horizontally |
| **Consistency** | ✅ Trivially consistent (one source) | ❌ Requires consensus protocols (Raft, Paxos) |
| **Examples** | Simple in-process registries | Consul, etcd, ZooKeeper |

---

### 3. Heartbeat Interval vs. Failure Detection Speed

| Heartbeat Interval | Impact |
|---|---|
| **Too short (< 1s)** | Very fast failure detection, but huge registry load and network overhead at scale |
| **Short (1–5s)** | Fast detection, acceptable overhead for moderate service counts |
| **Medium (5–30s)** | Industry standard. Balanced detection speed and overhead |
| **Long (> 30s)** | Low overhead, but stale instances persist longer in the registry |

**Rule of thumb:** TTL = 2–3× heartbeat interval. This allows for transient network hiccups without triggering false-positive evictions.

---

### 4. Client-Side vs. Server-Side Discovery

| Dimension | Client-Side | Server-Side |
|---|---|---|
| **LB flexibility** | High — custom algorithms per client | Moderate — centrally configured |
| **Client complexity** | High — must embed SDK | Low — just make an HTTP call |
| **Language support** | Requires per-language SDKs | Universal |
| **Failure blast radius** | Isolated — one bad client doesn't affect others | Shared — LB failure affects all clients |
| **Latency** | Lower — direct connection | Higher — extra proxy hop |
| **Operational overhead** | SDK versioning across services | Managing LB infrastructure |

---

### 5. Push vs. Pull Model

| Model | Description | Pros | Cons |
|---|---|---|---|
| **Pull** | Clients poll the registry periodically | Simple, no persistent connection needed | Latency between change and client awareness |
| **Push (Watch/Subscribe)** | Registry pushes updates to clients in real-time | Near-instant propagation of changes | Requires persistent connections, more complex registry |

Consul supports both: clients can poll via HTTP or use **blocking queries** (long-poll) that return immediately when data changes. Kubernetes uses a **watch mechanism** over the API server for real-time endpoint updates.

---

## Key Design Considerations

### 1. Registry High Availability
The service registry is a **critical path dependency**. If it goes down:
- New services cannot register.
- Existing clients with stale caches may continue working temporarily.
- No new routing information can propagate.

**Mitigation:** Run registry in a replicated cluster (3 or 5 nodes for Raft quorum). Deploy across multiple availability zones.

### 2. Graceful Deregistration & Connection Draining
When a service instance is shutting down:
1. Receive SIGTERM signal.
2. Immediately deregister from the service registry (stop accepting new connections).
3. Wait for in-flight requests to complete (connection draining, typically 10–30s).
4. Terminate the process.

Skipping step 2–3 causes a window where the load balancer routes new requests to a dying instance.

### 3. Client-Side Caching
Clients should cache registry results locally:
- Reduces load on the registry.
- Allows the system to continue operating during short registry outages.
- Cache should be invalidated based on TTL or registry-pushed updates.

**Pitfall:** Overly aggressive caching → stale routing for too long. Too little caching → registry becomes a bottleneck.

### 4. Multi-Region & Multi-Datacenter Strategy
- Each datacenter should have a **local registry replica** to avoid cross-region latency on every service lookup.
- Services should prefer **same-region instances** for low latency.
- Global routing decisions (failover to another region) should be made at the load balancer level, not the registry level.

### 5. Security
- **mTLS** between all services to prevent impersonation.
- **ACLs on the registry** — services should only be able to query for services they are authorized to call.
- **Token-based authentication** for registration operations (prevent rogue services from registering).

### 6. Sidecar / Service Mesh Pattern
Offload discovery, load balancing, retries, circuit breaking, and mTLS to a sidecar proxy (Envoy, Linkerd). Application code makes plain HTTP/gRPC calls to `localhost`; the sidecar handles everything else. This is the dominant pattern in modern Kubernetes environments.

---

## Real-World Systems & Applications

### Netflix Eureka
- **Pattern:** Client-side discovery, self-registration, AP model.
- **Scale:** Hundreds of microservices, tens of thousands of instances.
- **Design:**
  - Each service runs a Eureka client that registers on startup and sends heartbeats every **30 seconds**.
  - Clients maintain a **local cache** of the full registry, refreshed every 30s.
  - The registry itself is a replicated cluster, but uses **peer-to-peer replication** (not consensus) — eventual consistency.
  - **Self-preservation mode:** If the registry detects that it's losing more than 85% of expected heartbeats, it assumes a network partition is occurring and **stops evicting instances**. This avoids mass false-positive deregistrations.
- **Trade-off:** Accepts stale data in favor of availability. A dead instance may remain in the registry for up to 90s.
- **Status:** Netflix has largely moved to Envoy-based service mesh, but Eureka remains widely used in the Spring Cloud ecosystem.

---

### HashiCorp Consul
- **Pattern:** Supports both client-side and server-side (via Consul Connect + Envoy), CP model via Raft.
- **Scale:** Used at enterprises with thousands of services across multiple datacenters.
- **Design:**
  - Distributed registry using the **Raft consensus algorithm** — strong consistency.
  - Supports **DNS interface** (port 8600) and **HTTP API** for service lookups.
  - Rich health check support: HTTP, TCP, gRPC, TTL-based, and custom scripts.
  - **Consul Connect** provides service mesh capabilities with automatic mTLS via sidecar proxies.
  - **WAN federation** allows multiple datacenters to form a single logical cluster with cross-DC service discovery.
- **Additional capabilities:** Also functions as a distributed KV store, secrets backend, and configuration management system.
- **Trade-off:** Write operations require quorum — during network partition, writes are blocked. Strong consistency has an operational cost.

---

### Kubernetes (CoreDNS + kube-proxy)
- **Pattern:** Server-side discovery via DNS; third-party registration by the control plane.
- **Scale:** Industry standard for container orchestration; runs clusters of 5,000+ nodes.
- **Design:**
  - Every `Service` object gets a stable **DNS name**: `<service>.<namespace>.svc.cluster.local`.
  - **CoreDNS** resolves service names to their ClusterIP (a virtual IP).
  - **kube-proxy** programs **iptables / IPVS rules** on each node to distribute traffic from the ClusterIP to actual pod IPs.
  - **Endpoints** object tracks the set of healthy pod IPs for a Service, automatically updated by the control plane as pods start/stop.
  - **EndpointSlices** (introduced in K8s 1.17) improve scalability by sharding endpoint data across multiple objects.
- **Developer experience:** Engineers simply call `http://payment-service/` — all routing is abstracted away. No SDK, no registry queries.
- **Limitation:** DNS TTL caching can cause brief routing to terminated pods. Readiness probes mitigate this.

---

### AWS Cloud Map
- **Pattern:** Managed DNS-based and API-based discovery; integrates natively with AWS services.
- **Scale:** Managed service — scales automatically with AWS infrastructure.
- **Design:**
  - Services register **namespaces** (DNS or HTTP) and **service instances** with metadata.
  - Integrates with **Route 53** for DNS-based routing; supports `A`, `AAAA`, and `SRV` records.
  - Health checks via **Route 53 health checkers** or custom health checks via ECS/EKS.
  - ECS tasks and EKS pods can auto-register/deregister with Cloud Map via service integrations.
- **Best for:** AWS-native stacks using ECS, EKS, Lambda, or EC2 with tight Route 53 integration.

---

### Apache ZooKeeper
- **Pattern:** Strongly consistent distributed coordination service; used as a registry.
- **Scale:** Powers coordination for systems like Apache Kafka (thousands of brokers), HBase, and HDFS.
- **Design:**
  - Uses **ZAB (ZooKeeper Atomic Broadcast)** protocol for leader election and replication.
  - Services create **ephemeral znodes** — ZooKeeper automatically deletes them when the client session disconnects, enabling automatic deregistration without explicit calls.
  - Clients set **watches** on znodes to receive instant notification when registry state changes.
- **Trade-off:** All writes go through a single **elected leader**, which can become a write bottleneck at very high registration/deregistration rates.
- **Status:** ZooKeeper is being replaced by newer tools (Kafka moving to KRaft) but remains prevalent in legacy Hadoop/big data ecosystems.

---

### Istio Service Mesh
- **Pattern:** Sidecar-based transparent discovery; server-side at the pod level.
- **Scale:** Used at Google, Lyft, and large enterprises running hundreds of microservices on Kubernetes.
- **Design:**
  - **Envoy sidecar** is injected into every pod and intercepts all inbound and outbound traffic transparently.
  - **Istiod (Pilot)** is the control plane — it watches Kubernetes API for service/endpoint changes and pushes updates to all Envoy sidecars via the **xDS API** (gRPC streaming).
  - Envoy handles **service discovery, load balancing, circuit breaking, retries, timeouts, and mTLS** — all without any changes to application code.
  - Supports advanced traffic management: canary deployments, A/B testing, traffic mirroring, fault injection.
- **Trade-off:** Adds operational complexity (control plane management) and latency overhead (~1ms per hop for sidecar interception). Not suitable for simple setups.

---

## Summary Comparison of Popular Tools

| Tool | Consistency Model | CAP | Discovery Type | Health Checks | Best For |
|---|---|---|---|---|---|
| **Eureka** | Eventual | AP | Client-side | Heartbeat (30s) | Java/Spring microservices |
| **Consul** | Strong (Raft) | CP | Both | HTTP, TCP, gRPC, script | Multi-DC, service mesh |
| **ZooKeeper** | Strong (ZAB) | CP | Client-side | Ephemeral nodes / watches | Kafka, HBase coordination |
| **Kubernetes DNS** | Eventual (DNS TTL) | AP | Server-side | Liveness/readiness probes | Container workloads |
| **Istio/Envoy** | Eventual | AP | Sidecar transparent | Multiple | Complex service meshes, zero-trust |
| **AWS Cloud Map** | Eventual (DNS) | AP | DNS + API | Route 53 | AWS-native workloads |
| **etcd** | Strong (Raft) | CP | API / watch | TTL-based leases | Kubernetes backing store, config |

---

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
|---|---|---|
| **Hardcoded IPs/ports** | Brittle, breaks on restart or scaling | Use service names with discovery |
| **No health checks** | Dead instances accumulate in the registry | Always configure health checks with appropriate intervals |
| **No client-side caching** | Registry becomes a bottleneck; outage takes down everything | Cache with TTL; implement circuit breaker on registry calls |
| **Single registry node** | SPOF | Run registry as a replicated cluster (3 or 5 nodes) |
| **Same-region registry calls in hot path** | Cross-region latency on every request | Deploy local registry replicas per region/DC |
| **No graceful deregistration** | Clients route to terminating instances | Handle SIGTERM with deregistration + connection draining |
| **Ignoring thundering herd on registry restart** | All clients re-register simultaneously, overwhelming the registry | Stagger re-registration with jitter |

---

## Quick Reference: When to Use What

| Scenario | Recommended Approach |
|---|---|
| Small team, single cloud, Kubernetes | Kubernetes built-in DNS (CoreDNS) |
| Multi-cloud or multi-datacenter | Consul with WAN federation |
| Heavy Java/Spring Boot ecosystem | Netflix Eureka (Spring Cloud) |
| Need strong consistency | Consul or etcd |
| Zero-trust networking + deep observability | Istio / Envoy service mesh |
| AWS-native (ECS, Lambda, EKS) | AWS Cloud Map + Route 53 |
| Legacy Hadoop / Kafka ecosystem | Apache ZooKeeper |
| High-performance, low-latency microservices | Client-side discovery with local caching |