# RPC and gRPC — System Design Notes

---

## 1. What is RPC?

**Remote Procedure Call (RPC)** is a protocol that allows a program to execute a procedure (function/method) on a remote machine as if it were a local call. The caller doesn't need to explicitly manage the network communication — the RPC framework abstracts the transport layer.

### Core Execution Model

```
Client Process                          Server Process
─────────────────                       ─────────────────
1. Call local stub  ──── network ────►  4. Server stub receives
2. Stub serializes                          deserializes args
   (marshalling)                        5. Executes actual function
3. Sends over wire  ◄─── network ────   6. Serializes result
                                            sends response
Client receives result ◄──────────────  (unmarshalling)
```

### Key Components

| Component | Role |
|---|---|
| **Stub (Client-side)** | Proxy that mimics the remote function locally; handles serialization |
| **Skeleton (Server-side)** | Receives calls, deserializes, dispatches to actual implementation |
| **IDL (Interface Definition Language)** | Language-neutral contract defining available methods and data types |
| **Serialization Layer** | Converts in-memory objects to bytes for transport (and back) |
| **Transport Layer** | Underlying protocol — TCP, HTTP/1.1, HTTP/2, etc. |

### RPC vs REST vs GraphQL — High-Level

| Dimension | RPC | REST | GraphQL |
|---|---|---|---|
| Abstraction | Function call | Resource manipulation | Query graph |
| Contract | Strongly typed IDL | OpenAPI (optional) | Schema |
| Payload | Binary (usually) | JSON/XML | JSON |
| Over/under fetching | None (caller specifies) | Common | None |
| Discoverability | Low | High (HATEOAS) | Medium (introspection) |
| Coupling | Tight | Loose | Medium |

---

## 2. gRPC — Overview

**gRPC** (Google Remote Procedure Call) is a high-performance, open-source RPC framework developed by Google, released in 2016. It uses **Protocol Buffers (protobuf)** as its IDL and serialization format, and runs over **HTTP/2**.

### Technology Stack

```
┌────────────────────────────────────┐
│         Application Logic          │
├────────────────────────────────────┤
│     gRPC Framework (Stubs)         │
├────────────────────────────────────┤
│     Protocol Buffers (protobuf)    │  ← Serialization
├────────────────────────────────────┤
│           HTTP/2                   │  ← Transport
├────────────────────────────────────┤
│           TLS (optional)           │
└────────────────────────────────────┘
```

---

## 3. Protocol Buffers (Protobuf)

Protobuf is the default IDL and wire format for gRPC. It is a **language-neutral, platform-neutral, binary serialization format**.

### .proto File Example

```proto
syntax = "proto3";

package user;

service UserService {
  rpc GetUser (GetUserRequest) returns (User);
  rpc CreateUser (CreateUserRequest) returns (User);
  rpc ListUsers (ListUsersRequest) returns (stream User);
  rpc Chat (stream ChatMessage) returns (stream ChatMessage);
}

message User {
  int64  id         = 1;
  string name       = 2;
  string email      = 3;
  int32  age        = 4;
}

message GetUserRequest {
  int64 id = 1;
}
```

- Field numbers (1, 2, 3) are used in binary encoding — not names
- Adding new fields is backward compatible; removing is not
- `proto3` is the current version — all fields are optional by default

### Protobuf vs JSON

| Property | Protobuf | JSON |
|---|---|---|
| Format | Binary | Text |
| Size | ~3–10x smaller | Larger |
| Parse speed | ~5–10x faster | Slower |
| Human readable | No | Yes |
| Schema required | Yes (.proto file) | No |
| Versioning | Field numbers | Manual convention |
| Debugging | Harder | Easier |

---

## 4. HTTP/2 as Transport

gRPC relies exclusively on HTTP/2, inheriting all its capabilities.

### HTTP/2 Features Leveraged by gRPC

| Feature | Benefit for gRPC |
|---|---|
| **Multiplexing** | Multiple RPC calls over a single TCP connection; no head-of-line blocking per stream |
| **Header compression (HPACK)** | Reduced overhead for repeated metadata headers |
| **Binary framing** | Efficient transport aligned with protobuf binary format |
| **Server push** | Server can initiate streams (used in server-streaming RPCs) |
| **Flow control** | Per-stream and connection-level backpressure |
| **Persistent connections** | Eliminates TCP handshake overhead per request |

---

## 5. gRPC Communication Patterns

gRPC supports four distinct streaming modes, all defined in the `.proto` file.

### 5.1 Unary RPC (Request-Response)

```
Client ──── request ────► Server
Client ◄─── response ─── Server
```

Standard single request, single response. Equivalent to a classic REST call.

**Use case:** Fetching a user profile, submitting a form.

### 5.2 Server-Side Streaming

```
Client ──── request ────► Server
Client ◄─── stream ────── Server (multiple responses)
Client ◄─── stream ──────
Client ◄─── stream ──────
               [EOF]
```

Server sends a sequence of messages in response to a single client request.

**Use case:** Streaming search results, downloading a large dataset in chunks, live feed.

### 5.3 Client-Side Streaming

```
Client ──── stream ────► Server (multiple requests)
Client ──── stream ───►
Client ──── stream ───►
               [EOF]
Client ◄──── response ── Server (single)
```

Client sends a stream of messages; server replies once after receiving all (or enough) data.

**Use case:** File upload, bulk data ingestion, telemetry batching.

### 5.4 Bidirectional Streaming

```
Client ──── stream ────► Server
Client ◄─── stream ────── Server
(both sides send independently)
```

Both client and server send streams of messages concurrently. Order is preserved per direction.

**Use case:** Chat applications, real-time collaborative editing, multiplayer game state sync, live trading feeds.

---

## 6. gRPC Architecture Internals

### Channel and Connection Management

- A **Channel** represents a connection to a specific host:port
- Channels are long-lived and reused across multiple RPCs
- Internally manages HTTP/2 connections, reconnection, and load balancing
- **Subchannel**: A single HTTP/2 connection within a channel

### Metadata and Headers

gRPC uses HTTP/2 headers to pass:
- **Deadline / Timeout**: `grpc-timeout` header
- **Authentication tokens**: `Authorization` header
- **Custom metadata**: Arbitrary key-value pairs (sent as HTTP/2 headers)
- **Content-type**: Always `application/grpc`

### Deadlines and Cancellation

- Every RPC should have a **deadline** — a point in time by which the call must complete
- Deadlines propagate across services in a call chain (unlike timeouts which are relative)
- If a client cancels, the server receives a cancellation signal and should abort processing
- Prevents cascading delays in microservices

```
Client sets deadline: 500ms
  └─► Service A (150ms budget used)
        └─► Service B (remaining 350ms propagated)
              └─► Database (remaining 200ms)
```

### Interceptors (Middleware)

gRPC supports interceptors at both client and server for cross-cutting concerns:

| Concern | Implementation via Interceptor |
|---|---|
| Authentication / Authorization | Validate tokens in server interceptor |
| Logging | Log request/response metadata |
| Metrics | Emit latency, error rate, request count |
| Retry logic | Client-side interceptor with backoff |
| Rate limiting | Server-side interceptor |
| Distributed tracing | Inject/extract trace context (OpenTelemetry) |

---

## 7. Load Balancing in gRPC

gRPC's use of persistent HTTP/2 connections creates challenges for traditional L4/L7 load balancers.

### The Problem

- HTTP/2 multiplexes many RPCs over one TCP connection
- L4 load balancers route at connection level — all RPCs from a client go to the same backend
- Long-lived connections cause **uneven load distribution**

### Solutions

| Approach | Mechanism | Trade-offs |
|---|---|---|
| **Client-side LB** | Client maintains server list; picks backend per RPC (round-robin, least-conn) | No single point of failure; complex client logic; needs service discovery |
| **Proxy LB (L7)** | gRPC-aware proxy (Envoy, NGINX) terminates and re-opens connections per backend | Simple clients; proxy is SPOF; adds latency hop |
| **Lookaside LB** | External LB service returns backend to use; client connects directly | Scalable; complex infrastructure |
| **Headless DNS + Client LB** | DNS returns multiple A records; client picks one | Simple; stale DNS TTL can cause imbalance |

**Envoy** is the most common gRPC-aware sidecar proxy used in service meshes (Istio, Linkerd) for transparent L7 load balancing.

---

## 8. gRPC Error Handling

gRPC defines a canonical set of **status codes** (distinct from HTTP status codes):

| Code | Name | Meaning |
|---|---|---|
| 0 | OK | Success |
| 1 | CANCELLED | Client cancelled the request |
| 2 | UNKNOWN | Unknown server error |
| 3 | INVALID_ARGUMENT | Bad client input |
| 4 | DEADLINE_EXCEEDED | Deadline expired before completion |
| 5 | NOT_FOUND | Resource not found |
| 6 | ALREADY_EXISTS | Duplicate resource |
| 7 | PERMISSION_DENIED | Auth failed |
| 8 | RESOURCE_EXHAUSTED | Rate limited / quota exceeded |
| 13 | INTERNAL | Internal server error |
| 14 | UNAVAILABLE | Server temporarily unavailable (safe to retry) |
| 16 | UNAUTHENTICATED | No valid credentials |

**UNAVAILABLE** (14) is the canonical retryable error. Clients should implement exponential backoff with jitter for retries.

---

## 9. Security in gRPC

### Transport Security (TLS)

- gRPC supports TLS out of the box
- In production: always use **mutual TLS (mTLS)** for service-to-service auth
- mTLS: both client and server present certificates — proves identity of both sides
- Service meshes (Istio) can handle mTLS transparently via sidecars

### Authentication Patterns

| Method | Description | Use Case |
|---|---|---|
| **Token-based (JWT/OAuth2)** | Token passed in `Authorization` metadata | User-facing services |
| **mTLS** | Certificate-based identity | Internal microservices |
| **API Keys** | Simple key in metadata | Third-party API consumers |
| **ALTS (Google)** | Google's internal transport security | GCP internal services |

---

## 10. Trade-offs

### gRPC Advantages

| Advantage | Explanation |
|---|---|
| **Performance** | Binary protobuf + HTTP/2 multiplexing = significantly lower latency and bandwidth vs JSON/REST |
| **Strong typing** | .proto contract enforced at compile time; catches breaking changes early |
| **Code generation** | Client/server stubs auto-generated in 10+ languages from a single .proto file |
| **Streaming** | Native support for all four streaming patterns out of the box |
| **Deadline propagation** | First-class deadlines that flow through entire call chains |
| **Ecosystem** | Built-in interceptors, health checking, reflection, server-side cancellation |

### gRPC Disadvantages

| Disadvantage | Explanation |
|---|---|
| **Browser support** | HTTP/2 trailers not supported natively by browsers — requires gRPC-Web proxy |
| **Debugging difficulty** | Binary format not human-readable; need specialized tools (grpcurl, BloomRPC) |
| **Tight coupling** | Schema changes require recompiling and redeploying clients — more coordination |
| **Proxy/LB complexity** | Requires gRPC-aware L7 proxies; traditional L4 LBs don't work well |
| **Learning curve** | protobuf, HTTP/2, streaming patterns add complexity vs simple REST |
| **Not great for public APIs** | REST/JSON is more universally consumable by third parties |
| **HTTP/2 requirement** | Some corporate networks/proxies block or degrade HTTP/2 |

### gRPC vs REST — Decision Framework

| Choose gRPC when... | Choose REST when... |
|---|---|
| Internal service-to-service communication | Public-facing APIs consumed by third parties |
| Performance is critical (low latency, high throughput) | Human readability and debugging simplicity matter |
| You need bidirectional or server-streaming | Simple request-response with standard HTTP caching |
| Polyglot environment (multiple languages) | Browser is a primary client without gRPC-Web overhead |
| Strong schema enforcement is desired | Teams unfamiliar with protobuf/gRPC |
| Call chaining across many microservices | Loose coupling and independent deployability matter more |

---

## 11. Real-World Systems and Applications

### Google
- gRPC was born at Google to replace their internal **Stubby** RPC system
- All Google internal services communicate via gRPC
- Used at scale across Search, Ads, YouTube, and GCP services

### Netflix
- Adopted gRPC for **internal microservices** communication
- Uses it for real-time data streaming between services in the content delivery pipeline
- Combined with **Envoy** as the service mesh sidecar for observability and traffic management

### Uber
- Uses gRPC extensively for communication between backend microservices (dispatch, pricing, mapping)
- Built **Jaeger** (distributed tracing) which integrates with gRPC via OpenTelemetry interceptors
- Uses client-side load balancing with service discovery via **Consul**

### Dropbox
- Migrated from REST to gRPC for internal services
- Reported significant latency reductions and CPU savings due to protobuf's efficiency
- Uses gRPC streaming for syncing file metadata between services

### Square
- Uses gRPC as the standard for all internal microservice APIs
- Generates client SDKs across Go, Java, Kotlin, Ruby from shared `.proto` definitions
- Enforces backward compatibility through schema linting in CI/CD pipelines

### Cloudflare
- Uses gRPC for internal control plane communication across their global network
- Leverages bidirectional streaming for real-time config propagation to edge nodes

### Kubernetes / etcd
- **etcd** (the backing store for Kubernetes) exposes its API entirely over gRPC
- All Kubernetes control plane components (apiserver, scheduler, controller-manager) communicate internally via gRPC

### CoreDNS / Service Meshes
- **Istio**, **Linkerd**, and **Consul Connect** all use gRPC for control plane communication (xDS protocol for Envoy config delivery is gRPC-based)

---

## 12. gRPC-Web

Browsers cannot use native gRPC (HTTP/2 trailers not supported). **gRPC-Web** is the solution:

```
Browser ──► gRPC-Web Request ──► Envoy Proxy ──► gRPC Server
            (HTTP/1.1 or HTTP/2)   (translates)    (native gRPC)
```

- Envoy (or grpc-web proxy) translates gRPC-Web protocol to native gRPC
- Supports unary and server-streaming only (no client-streaming, no bidi-streaming from browser)
- **Connect protocol** (by Buf) is a newer alternative that speaks gRPC, gRPC-Web, and REST interchangeably

---

## 13. gRPC Health Checking

gRPC defines a standard **Health Checking Protocol** (`grpc.health.v1.Health`):

```proto
service Health {
  rpc Check (HealthCheckRequest) returns (HealthCheckResponse);
  rpc Watch (HealthCheckRequest) returns (stream HealthCheckResponse);
}
```

- `Check`: One-shot probe (used by load balancers)
- `Watch`: Streaming — server pushes status changes
- Status values: `SERVING`, `NOT_SERVING`, `SERVICE_UNKNOWN`
- Integrated with Kubernetes liveness/readiness probes via `grpc-health-probe`

---

## 14. Observability

### Metrics (via interceptors or service mesh)

| Metric | Description |
|---|---|
| `grpc_server_started_total` | Total RPCs received |
| `grpc_server_handled_total` | Total RPCs completed (labeled by status code) |
| `grpc_server_handling_seconds` | Latency histogram per method |
| `grpc_client_started_total` | Outbound RPCs initiated |

### Distributed Tracing

- OpenTelemetry gRPC instrumentation propagates trace context via metadata headers (`traceparent`, `tracestate`)
- Each RPC becomes a span; nested RPCs form a trace tree
- Backends: Jaeger, Zipkin, Google Cloud Trace, Tempo

### Logging

- Interceptors log request/response metadata (method, status, latency, user ID)
- Binary payloads are typically not logged in production (size, PII concerns)
- `grpcurl` can be used to introspect live services via **server reflection**

---

## 15. Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| **No deadlines set** | One slow downstream blocks entire call chain indefinitely | Always set deadlines on every outbound RPC |
| **Synchronous blocking calls in streaming handlers** | Kills throughput; blocks the goroutine/thread pool | Use async/non-blocking patterns in streaming handlers |
| **Treating protobuf as a database schema** | Proto is a wire format, not a storage format; evolving it as storage causes pain | Separate wire types from domain/storage models |
| **Removing fields without deprecation** | Breaks backward compatibility for old clients | Mark fields as `reserved`, deprecate before removing |
| **Ignoring cancellation signals** | Server does expensive work even after client disconnected | Check context cancellation in long-running handlers |
| **One massive service with 50+ methods** | Monolithic service boundary; hard to scale independently | Decompose by domain — each service should have a focused responsibility |
| **Skipping mTLS in production** | Service identity not verified; vulnerable to MITM | Enforce mTLS at the service mesh or application level |
| **Not versioning .proto files** | Breaking changes silently affect all consumers | Version packages (`v1`, `v2`) and use schema linting (buf) |

---

## 16. Tooling Ecosystem

| Tool | Purpose |
|---|---|
| **protoc** | Protocol Buffer compiler — generates stubs from `.proto` |
| **buf** | Modern protobuf toolchain: linting, breaking-change detection, code gen |
| **grpcurl** | curl for gRPC — call services from the CLI using server reflection |
| **grpc-gateway** | Generates a REST/JSON reverse proxy from `.proto` annotations |
| **BloomRPC / Postman** | GUI clients for testing gRPC services |
| **Evans** | Interactive gRPC client with REPL interface |
| **OpenTelemetry** | Distributed tracing and metrics instrumentation |
| **Envoy** | gRPC-aware L7 proxy and sidecar for service meshes |

---

## 17. Summary: When to Use What

```
Internal microservices, high throughput, polyglot?
  └─► gRPC

Public API, browser clients, human readability?
  └─► REST

Flexible queries, multiple clients with different data needs?
  └─► GraphQL

Simple fire-and-forget, event-driven?
  └─► Message Queue (Kafka, RabbitMQ)
```