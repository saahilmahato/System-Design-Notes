# Communication: Network Protocols & Architectural Styles

---

## Table of Contents

1. [Overview](#overview)
2. [OSI & TCP/IP Model — Foundational Context](#osi--tcpip-model--foundational-context)
3. [Transport Layer: TCP vs UDP](#transport-layer-tcp-vs-udp)
4. [HTTP Protocol Evolution](#http-protocol-evolution)
5. [Architectural Styles](#architectural-styles)
   - [REST](#1-rest-representational-state-transfer)
   - [GraphQL](#2-graphql)
   - [gRPC / RPC](#3-grpc--rpc)
   - [WebSockets](#4-websockets)
   - [Server-Sent Events (SSE)](#5-server-sent-events-sse)
   - [Webhooks](#6-webhooks)
   - [Long Polling & Short Polling](#7-polling-short--long)
   - [Message Queues & Pub/Sub](#8-message-queues--pubsub)
6. [Architectural Style Comparison & Decision Framework](#architectural-style-comparison--decision-framework)
7. [Communication Patterns in Distributed Systems](#communication-patterns-in-distributed-systems)
8. [Security in Communication](#security-in-communication)
9. [Monitoring & Observability](#monitoring--observability)
10. [Anti-Patterns](#anti-patterns)

---

## Overview

Communication is the backbone of every distributed system. Choosing the right protocol and architectural style directly impacts latency, throughput, reliability, developer experience, and operational complexity. The decision tree starts with a simple question: **who initiates communication, how often, and what guarantees does the data transfer need?**

---

## OSI & TCP/IP Model — Foundational Context

Understanding which layer a protocol operates at explains its behavior, overhead, and failure modes.

| Layer | OSI Name | TCP/IP Layer | Protocols / Examples |
|---|---|---|---|
| 7 | Application | Application | HTTP, gRPC, WebSocket, DNS, SMTP |
| 6 | Presentation | Application | TLS/SSL, JSON encoding, Protobuf |
| 5 | Session | Application | TLS handshake, WebSocket sessions |
| 4 | Transport | Transport | TCP, UDP, QUIC |
| 3 | Network | Internet | IP, ICMP, BGP |
| 2 | Data Link | Link | Ethernet, Wi-Fi (802.11) |
| 1 | Physical | Link | Copper, Fiber, Radio |

**Why it matters for system design:** Protocol overhead accumulates at every layer. HTTP/2 multiplexing reduces head-of-line blocking at layer 7, while QUIC solves the same problem at layer 4. Knowing the layer tells you where latency is introduced and where optimization is possible.

---

## Transport Layer: TCP vs UDP

The foundation of nearly all application protocols is either TCP or UDP.

### TCP (Transmission Control Protocol)

**Mechanics:**
- Connection-oriented: three-way handshake (SYN → SYN-ACK → ACK)
- Reliable, ordered delivery with acknowledgment and retransmission
- Flow control (receiver window) and congestion control (slow start, AIMD)
- Connection teardown: four-way FIN handshake

**Characteristics:**
- Adds ~1 RTT (round-trip time) overhead for connection setup
- Head-of-line blocking: lost packet blocks all subsequent data in the stream
- Excellent for request-response workloads where correctness > speed

**Real-world use:** HTTP/1.1, HTTP/2, database connections (PostgreSQL, MySQL), SSH, SMTP.

### UDP (User Datagram Protocol)

**Mechanics:**
- Connectionless, no handshake
- Best-effort delivery: no retransmission, no ordering guarantees
- Very low overhead — just source/dest port and length in the header

**Characteristics:**
- ~0 RTT to start sending data
- Application must handle loss, ordering, and deduplication if needed
- Supports multicast (TCP is unicast only)

**Real-world use:** DNS lookups, video streaming (RTP/RTSP), online gaming, VoIP, QUIC (HTTP/3).

### Trade-offs: TCP vs UDP

| Dimension | TCP | UDP |
|---|---|---|
| Delivery guarantee | Reliable, ordered | Best-effort |
| Latency | Higher (handshake + retransmit) | Lower |
| Throughput | Self-throttles via congestion control | No limit (can overwhelm receiver) |
| Connection state | Stateful | Stateless |
| Use case fit | Correctness-critical (payments, file transfer) | Latency-critical (gaming, streaming, DNS) |

### QUIC (HTTP/3 Transport)

QUIC is a UDP-based transport that reimplements TCP's reliability and TLS's security in user space, adding:

- **0-RTT connection resumption** for repeat connections
- **Stream multiplexing** without head-of-line blocking (unlike TCP where one lost packet stalls all streams)
- **Connection migration** (IP/port changes without re-handshaking — important for mobile)

**Adopted by:** Google (GQUIC), Cloudflare, Meta (all HTTP/3 traffic), Akamai.

---

## HTTP Protocol Evolution

### HTTP/1.0
- One TCP connection per request. High overhead from repeated handshakes.
- No persistent connections by default.

### HTTP/1.1
- Persistent connections (`Connection: keep-alive`) — reuse TCP connections.
- Pipelining: send multiple requests without waiting for responses, but **head-of-line blocking** remains.
- Text-based headers, no compression.

### HTTP/2
- Binary framing layer — efficient parsing, smaller frames.
- **Multiplexing**: multiple streams over a single TCP connection, removing HTTP-level HOL blocking.
- **Header compression** via HPACK (significant for chatty APIs with large headers like JWT tokens).
- **Server push**: server can preemptively send resources the client will need.
- Still suffers TCP-level HOL blocking on packet loss.

**Adopted by:** All major browsers, Nginx, Envoy, gRPC (built exclusively on HTTP/2).

### HTTP/3
- Runs on QUIC (UDP). Solves TCP-level HOL blocking entirely.
- Connection migration supported.
- Faster connection establishment (0-RTT / 1-RTT).
- Deployed by: Google, Cloudflare, Meta, Fastly. ~30% of web traffic now.

### Comparison

| Feature | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transport | TCP | TCP | QUIC (UDP) |
| Multiplexing | No | Yes (stream) | Yes (stream, no HOL) |
| Header compression | No | HPACK | QPACK |
| Server push | No | Yes | Yes |
| HOL blocking | App + TCP | TCP only | None |
| TLS | Optional | Required (in practice) | Built-in (mandatory) |
| Connection setup | 1 RTT + TLS | 1 RTT + TLS | 0-RTT or 1-RTT |

---

## Architectural Styles

### 1. REST (Representational State Transfer)

**Core Concepts:**
REST is an architectural *style*, not a protocol. It maps CRUD operations to HTTP verbs over resources identified by URIs.

- **Stateless**: each request carries all context; no session state on the server.
- **Uniform interface**: standardized HTTP methods (GET, POST, PUT, PATCH, DELETE).
- **Resource-based**: entities are resources (`/users/123`), not actions (`/getUser?id=123`).
- **Cacheable**: responses declare cacheability via Cache-Control headers.
- **Layered system**: clients can't tell if they're talking directly to a server or through proxies/CDNs.
- **HATEOAS** (Hypermedia as the Engine of Application State): responses include links to next possible actions. Rarely fully implemented in practice.

**HTTP Status Code Conventions:**

| Range | Meaning | Common Codes |
|---|---|---|
| 2xx | Success | 200 OK, 201 Created, 204 No Content |
| 3xx | Redirection | 301 Moved Permanently, 304 Not Modified |
| 4xx | Client Error | 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 429 Too Many Requests |
| 5xx | Server Error | 500 Internal Server Error, 503 Service Unavailable, 504 Gateway Timeout |

**Idempotency:**

| Method | Safe | Idempotent | Body |
|---|---|---|---|
| GET | ✅ | ✅ | No |
| HEAD | ✅ | ✅ | No |
| PUT | ❌ | ✅ | Yes |
| DELETE | ❌ | ✅ | No |
| POST | ❌ | ❌ | Yes |
| PATCH | ❌ | ❌ (usually) | Yes |

**Trade-offs:**

| Pros | Cons |
|---|---|
| Universal client support (browsers, mobile, curl) | Over-fetching: endpoint returns more data than needed |
| Stateless = horizontally scalable | Under-fetching: multiple round trips to assemble a view |
| HTTP caching infrastructure works natively | No real-time capability |
| Well-understood error semantics | Versioning strategy is inconsistent across teams |
| Easy to debug (text-based, curl-able) | No strong contract enforcement (OpenAPI helps) |

**Real-world use:** Stripe API, GitHub API, Twilio, AWS REST APIs, virtually every public API.

---

### 2. GraphQL

**Core Concepts:**
GraphQL is a query language and runtime for APIs. The client specifies exactly what data it needs and receives exactly that — no more, no less.

- **Single endpoint** (typically `POST /graphql`) for all operations.
- **Queries**: read operations. **Mutations**: write operations. **Subscriptions**: real-time streams.
- **Schema-first**: a typed schema defines all capabilities; clients and servers are decoupled by the schema contract.
- **Introspection**: clients can query the schema itself to discover available types and operations.
- **Resolver pattern**: each field in the schema maps to a resolver function.

**N+1 Problem:**
GraphQL's resolver-per-field model naturally leads to N+1 DB queries. Querying 100 users and their posts triggers 1 user query + 100 post queries. The solution is **DataLoader** (batching + per-request caching).

**Trade-offs:**

| Pros | Cons |
|---|---|
| No over-fetching or under-fetching | Caching is hard (POST requests, no URL-based caching) |
| Single round trip for complex nested data | N+1 queries without DataLoader |
| Strong typed schema = living documentation | Query complexity can be unbounded without rate limiting |
| Excellent for BFF (Backend for Frontend) | Complex to implement on the server side |
| Enables rapid frontend iteration | Introspection can expose schema to attackers |

**Real-world use:** GitHub API v4, Shopify Storefront API, Twitter (internal), Facebook (inventor), Netflix (BFF layer), Airbnb (mobile BFF).

---

### 3. gRPC / RPC

**Core Concepts:**
gRPC (Google Remote Procedure Call) allows calling procedures on remote services as if they were local function calls. It is built on HTTP/2 and uses **Protocol Buffers (Protobuf)** as the serialization format.

- **IDL-first**: service contracts defined in `.proto` files. Code is generated for clients and servers in multiple languages.
- **Protobuf**: binary serialization — ~10x smaller and faster to parse than JSON.
- **HTTP/2 transport**: multiplexing, header compression, bidirectional streaming.
- **Four communication modes:**

| Mode | Description | Use Case |
|---|---|---|
| Unary | Single request → single response | Standard API call |
| Server streaming | Single request → stream of responses | Log tailing, feed streaming |
| Client streaming | Stream of requests → single response | Bulk upload, sensor data |
| Bidirectional streaming | Stream of requests ↔ stream of responses | Chat, collaborative editing |

**Protobuf serialization:**
```protobuf
syntax = "proto3";

service UserService {
  rpc GetUser (UserRequest) returns (UserResponse);
  rpc StreamUsers (UserFilter) returns (stream UserResponse);
}

message UserRequest { int64 user_id = 1; }
message UserResponse {
  int64 id = 1;
  string name = 2;
  string email = 3;
}
```

**Trade-offs:**

| Pros | Cons |
|---|---|
| Very high performance (binary, HTTP/2) | Not natively browser-callable without gRPC-Web proxy |
| Strong typing + codegen eliminates mismatches | Protobuf binary is hard to debug without tooling |
| Built-in bidirectional streaming | Schema evolution requires careful field numbering |
| Language-agnostic code generation | More complex to set up than REST |
| Excellent for polyglot microservices | Limited human readability |

**Real-world use:** Google internal services, Netflix (inter-service), Uber (driver-dispatch), Lyft (microservices), Cloudflare, Kubernetes API (etcd gRPC).

---

### 4. WebSockets

**Core Concepts:**
WebSocket is a full-duplex, persistent communication channel over a single TCP connection, upgraded from HTTP.

- **HTTP upgrade handshake**: starts as HTTP/1.1 with `Upgrade: websocket` header.
- After upgrade, both client and server can push frames at any time.
- **Framing**: data sent in lightweight frames (text or binary).
- **Persistent connection**: no repeated handshakes after the initial one.

**Lifecycle:**
```
Client → Server: HTTP GET /chat (Upgrade: websocket)
Server → Client: 101 Switching Protocols
--- WebSocket tunnel established ---
Client ↔ Server: frames (bidirectional, any time)
Either side: Close frame
```

**Scaling WebSockets:**
- WebSockets are **stateful** — a user is pinned to a specific server.
- Horizontal scaling requires a **pub/sub layer** (Redis Pub/Sub, Kafka) so any server instance can deliver messages to any connected client.
- Common pattern: App server holds WS connections; publishes/subscribes to Redis channels; all servers receive and fan-out to their local connections.

**Trade-offs:**

| Pros | Cons |
|---|---|
| True bidirectional, low-latency | Stateful — harder to horizontally scale |
| No HTTP overhead after handshake | Connection state must be managed explicitly |
| Ideal for real-time apps | Firewall/proxy compatibility issues (some block WS) |
| Works in browsers natively | Not request-response, no built-in retry semantics |

**Real-world use:** Slack (messaging), Discord (chat + presence), Figma (collaborative editing), Robinhood (live quotes), Binance (order book), online multiplayer games.

---

### 5. Server-Sent Events (SSE)

**Core Concepts:**
SSE is a one-directional, server-to-client stream over a persistent HTTP connection. The server pushes events; the client only receives.

- Uses standard HTTP with `Content-Type: text/event-stream`.
- Browser has native `EventSource` API with automatic reconnection.
- Each event is a text-based block with optional `id`, `event`, `data`, and `retry` fields.

**Event format:**
```
id: 42
event: price-update
data: {"symbol": "AAPL", "price": 182.34}

data: {"symbol": "GOOGL", "price": 140.12}
```

**Trade-offs:**

| Pros | Cons |
|---|---|
| Simple HTTP — works through proxies and CDNs | Unidirectional: client cannot push data |
| Native browser reconnect and event ID tracking | Not suitable for interactive real-time apps |
| Multiplexes over HTTP/2 without connection limit issues | HTTP/1.1 limited to ~6 connections/domain |
| Lower overhead than WebSockets for one-way streams | Requires keep-alive infrastructure |

**Real-world use:** Live sports scores, stock tickers, social media notification feeds, Vercel/OpenAI streaming responses (ChatGPT uses SSE for token streaming), GitHub Actions log streaming.

---

### 6. Webhooks

**Core Concepts:**
Webhooks are **user-defined HTTP callbacks**. When an event occurs in system A, it makes an HTTP POST request to a URL configured by system B. This is push-based, event-driven integration.

- Producer registers the consumer's endpoint URL.
- On event, producer POSTs a JSON payload to that URL.
- Consumer must acknowledge with 2xx; otherwise the producer retries with backoff.

**Reliability Challenges:**
- Consumer endpoint may be temporarily unavailable. Solution: **retry with exponential backoff + dead-letter queue**.
- Deduplication needed — retries cause duplicate deliveries. Solution: **idempotency keys** in headers (`X-Webhook-Delivery-ID`).
- Consumers must verify the payload came from the legitimate source. Solution: **HMAC signature** (`X-Signature: sha256=...`).

**Webhook vs Polling:**

| Aspect | Webhook | Polling |
|---|---|---|
| Latency | Near real-time | Depends on poll interval |
| Load on producer | Event-driven (low) | Constant requests (high) |
| Complexity | Consumer must expose endpoint | Consumer initiates requests |
| Reliability | Requires retry logic | Simpler |

**Real-world use:** Stripe (payment events), GitHub (CI/CD triggers, push hooks), Twilio (SMS delivery status), Shopify (order events), PagerDuty (alert routing).

---

### 7. Polling: Short & Long

**Short Polling:**
Client sends requests at a fixed interval, regardless of whether new data exists.

```
Client → Server: GET /notifications (t=0)
Server → Client: 200 { "events": [] }   // no new data
Client → Server: GET /notifications (t=5s)
Server → Client: 200 { "events": [] }
...
```

- Simple to implement, but wasteful. Most responses carry no new data.
- Generates constant load proportional to number of clients × poll frequency.

**Long Polling:**
Client sends a request, and the server holds the connection open until new data is available (or a timeout occurs). On response, the client immediately re-establishes the connection.

```
Client → Server: GET /notifications (holds open)
--- server waits for new event ---
Server → Client: 200 { "events": [new data] }
Client → Server: GET /notifications (immediately re-polls)
```

- More efficient than short polling for low-frequency events.
- Still creates connection overhead. Not truly persistent like WebSockets.
- Difficult to implement correctly at scale (connections held open consume server threads/FDs).

**Trade-offs:**

| | Short Polling | Long Polling | WebSockets |
|---|---|---|---|
| Latency | Poll interval | Near real-time | Real-time |
| Server resources | Proportional to clients × rate | Better than short | Connection per client |
| Implementation | Trivial | Moderate | Complex |
| Works behind proxies | Yes | Yes (with timeout config) | Sometimes not |

**Real-world use:** Short polling — dashboards that refresh every N seconds. Long polling — historical Slack fallback, Facebook Chat (pre-WebSocket), AWS SQS ReceiveMessage API.

---

### 8. Message Queues & Pub/Sub

**Core Concepts:**
Asynchronous, decoupled communication between services via an intermediary broker. Producers publish messages; consumers receive and process them independently.

**Patterns:**
- **Point-to-point (Queue)**: One producer, one consumer per message. Competing consumers for parallel processing. E.g., RabbitMQ queues, AWS SQS.
- **Pub/Sub (Topic)**: One producer, many consumers. Each subscriber gets a copy. E.g., Kafka topics, Google Pub/Sub, AWS SNS.
- **Fan-out**: Single event distributed to multiple queues/services simultaneously.

**Key concepts:**
- **At-least-once delivery**: Message delivered, possibly duplicated. Consumers must be idempotent.
- **At-most-once delivery**: No duplicates, but may lose messages.
- **Exactly-once delivery**: Hardest guarantee; achievable with transactional producers/consumers (Kafka transactions).
- **Dead Letter Queue (DLQ)**: Failed messages routed here for inspection and replay.
- **Backpressure**: Consumer signals it cannot keep up; producer slows or buffers.

**Trade-offs:**

| Pros | Cons |
|---|---|
| Decouples producers and consumers (temporal + logical) | Adds infrastructure complexity |
| Absorbs traffic spikes (natural buffer) | Eventual consistency — delayed processing |
| Enables retry, replay, and auditing | Ordering guarantees vary by system |
| Independent scaling of producers and consumers | Message schema evolution is challenging |

**Real-world use:** Kafka at LinkedIn (activity streams), Uber (trip events), Netflix (event backbone); RabbitMQ at fintech for order processing; AWS SQS at thousands of companies for microservice decoupling.

---

## Architectural Style Comparison & Decision Framework

### Side-by-Side Comparison

| Dimension | REST | GraphQL | gRPC | WebSocket | SSE | Webhook | Message Queue |
|---|---|---|---|---|---|---|---|
| Communication direction | Request-Response | Request-Response | R-R + Streaming | Bidirectional | Server → Client | Server → Client | Async / Decoupled |
| Initiation | Client | Client | Client | Client (then either) | Client (subscribes) | Server (event-driven) | Producer |
| Real-time | No | Via subscriptions | Via streaming | Yes | Yes | Near real-time | Eventual |
| Transport | HTTP | HTTP | HTTP/2 | TCP (HTTP upgrade) | HTTP | HTTP | Broker protocol |
| Payload format | JSON/XML | JSON | Protobuf | Text/Binary | Text (event stream) | JSON | Any |
| Browser native | Yes | Yes (via fetch) | No (gRPC-Web) | Yes | Yes (EventSource) | N/A (server-side) | N/A |
| Caching | Yes (HTTP cache) | Hard | No | No | No | No | No |
| Schema/Contract | OpenAPI | GraphQL SDL | Protobuf IDL | None standard | None standard | None standard | Schema Registry |
| Best for | Public APIs, CRUD | Mobile BFF, complex queries | Internal microservices | Chat, games, collab | Feeds, notifications | Event integrations | Async jobs, pipelines |

### Decision Framework

```
1. Is the communication synchronous or asynchronous?
   └── Async? → Message Queue / Pub/Sub (Kafka, RabbitMQ, SQS)
   └── Sync? → Continue...

2. Who initiates communication?
   └── Client → REST, GraphQL, gRPC (unary)
   └── Server → SSE, Webhook, Message Queue
   └── Both → WebSocket, gRPC bidirectional streaming

3. Is the consumer a browser?
   └── Yes + read-only updates? → SSE
   └── Yes + bidirectional real-time? → WebSocket
   └── Yes + flexible queries? → GraphQL
   └── Yes + standard CRUD? → REST
   └── No (service-to-service)? → gRPC, REST, or Message Queue

4. Is performance/throughput critical (internal microservices)?
   └── Yes → gRPC (binary Protobuf, HTTP/2, codegen)
   └── No → REST

5. Is it an integration with external third-party systems?
   └── Yes → REST (public API) or Webhook (event-driven integration)
```

---

## Communication Patterns in Distributed Systems

### Synchronous vs Asynchronous

| | Synchronous | Asynchronous |
|---|---|---|
| Coupling | Temporal coupling (both must be available) | Decoupled (producer/consumer independent) |
| Latency | Lower for single operation | Higher per-operation (queue delay) |
| Resilience | Failure propagates immediately | Failures isolated; retries possible |
| Throughput | Limited by slowest service | High (consumers can lag) |
| Debugging | Easier (linear flow) | Harder (distributed tracing needed) |

### Service Mesh Communication
In microservice architectures, a **service mesh** (Istio, Linkerd, Envoy) handles cross-cutting communication concerns at the infrastructure layer, removing them from application code:
- **mTLS** between services (zero-trust)
- **Circuit breaking, retries, timeouts** (resilience)
- **Distributed tracing** (observability)
- **Load balancing** (L7 aware)

### Saga Pattern (Async)
Used for distributed transactions. A sequence of local transactions, each publishing events to trigger the next service. If a step fails, compensating transactions are triggered.

- **Choreography**: each service listens for events and publishes its own (decentralized, event-driven).
- **Orchestration**: a central saga orchestrator tells each service what to do (centralized, easier to reason about).

### Circuit Breaker
Prevents cascading failures. Wraps service calls; when failure rate exceeds threshold, the circuit "opens" and fast-fails requests instead of waiting for timeouts. After a cooling period, moves to "half-open" and probes with limited requests.

States: `Closed` → (failures exceed threshold) → `Open` → (timeout) → `Half-Open` → (success) → `Closed`.

**Implementations:** Hystrix (Netflix, deprecated), Resilience4j, Istio circuit breaker, AWS App Mesh.

---

## Security in Communication

### TLS/HTTPS
All inter-service and client-server communication should be TLS-encrypted. Key considerations:
- **TLS 1.3** is the current standard; 1.2 is acceptable; 1.0/1.1 must be disabled.
- Certificate rotation and expiry monitoring are operational requirements.
- **mTLS (mutual TLS)**: both client and server authenticate each other. Required in zero-trust networks.

### Authentication in APIs

| Method | Use Case | Notes |
|---|---|---|
| API Key | Server-to-server, simple integrations | Easy to implement; must be protected |
| JWT (Bearer) | Stateless auth for REST/GraphQL | Self-contained claims; rotation is complex |
| OAuth 2.0 | Delegated auth, third-party access | Industry standard; complex but powerful |
| mTLS | Internal microservice auth | Certificate-based; operationally heavy |
| HMAC Signature | Webhook payload verification | Timestamp + body signing |

### Rate Limiting
Protect APIs from abuse and ensure fair usage. Common algorithms:

- **Token Bucket**: Tokens added at a fixed rate; burst allowed up to bucket capacity.
- **Leaky Bucket**: Requests processed at a constant rate; excess queued or dropped.
- **Fixed Window Counter**: Count requests per fixed time window. Simple but allows burst at boundary.
- **Sliding Window Log**: Precise per-request tracking; memory-intensive.
- **Sliding Window Counter**: Approximation using two fixed windows; good balance.

**Implementation:** Nginx rate limiting, Cloudflare, Kong API Gateway, Redis + Lua scripts (Stripe, GitHub).

---

## Monitoring & Observability

### Key Metrics to Track

| Protocol | Metrics |
|---|---|
| REST/HTTP | Request rate (RPS), error rate (4xx/5xx %), p50/p99/p999 latency, payload size |
| gRPC | RPC call rate, status codes, stream duration, metadata overhead |
| WebSocket | Active connections, message rate (inbound/outbound), connection duration, disconnects |
| Message Queue | Consumer lag, publish rate, consume rate, DLQ depth, processing latency |
| General | Connection pool utilization, TLS handshake rate, DNS resolution time |

### The Three Pillars of Observability
- **Logs**: Structured logs per request (correlation ID, user ID, duration, status).
- **Metrics**: Aggregated time-series data (Prometheus, Datadog, CloudWatch).
- **Traces**: Distributed request traces across services (Jaeger, Zipkin, OpenTelemetry, AWS X-Ray).

**Correlation IDs:** Every request should carry a unique ID (`X-Request-ID`, `X-Trace-ID`) that propagates across all service calls. Critical for debugging distributed systems.

---

## Anti-Patterns

### 1. Chatty Interfaces
Making many small, sequential API calls to assemble a single view (REST under-fetching). Causes latency multiplication. Fix: GraphQL, BFF aggregation layer, or batching endpoints.

### 2. Synchronous Call Chains in Microservices
Service A calls B, B calls C, C calls D — synchronously. Failure or slowdown at D cascades to A. Fix: async messaging, circuit breakers, or saga pattern.

### 3. Ignoring Idempotency
Not making POST/PATCH mutations idempotent. Network retries cause duplicate side effects (double charges, duplicate orders). Fix: idempotency keys, deduplication at the DB layer.

### 4. No Backpressure Handling
Producer overwhelms consumer. Fix: bounded queues, consumer-driven flow control, load shedding.

### 5. Missing Timeouts
Service calls without timeouts hang indefinitely, exhausting connection pools and thread pools. Fix: always set connection timeout, read timeout, and request timeout. Implement deadline propagation.

### 6. Versioning Ignorance
Breaking API changes without versioning. Fix: URI versioning (`/v2/`), header versioning (`Accept: application/vnd.api+json;version=2`), or GraphQL schema evolution with deprecation.

### 7. Over-using Webhooks Without Retry Logic
Fire-and-forget webhooks with no retry, no signature verification, and no dead-letter strategy. Fix: implement exponential backoff, HMAC validation, and idempotent consumer handlers.

### 8. WebSockets for Simple Notifications
Using WebSockets when SSE would suffice. WebSockets add stateful complexity; SSE is simpler for unidirectional push. Rule: use the simplest protocol that meets your requirements.

---