# HTTP — System Design Reference

## Table of Contents
1. [Overview](#overview)
2. [HTTP Versions](#http-versions)
3. [Request / Response Structure](#request--response-structure)
4. [HTTP Methods](#http-methods)
5. [Status Codes](#status-codes)
6. [Headers](#headers)
7. [Connection Management](#connection-management)
8. [Caching in HTTP](#caching-in-http)
9. [HTTPS & TLS](#https--tls)
10. [Trade-offs](#trade-offs)
11. [Real-World Systems & Applications](#real-world-systems--applications)
12. [Decision Framework](#decision-framework)
13. [Anti-Patterns](#anti-patterns)
14. [Monitoring & Metrics](#monitoring--metrics)

---

## Overview

HTTP (HyperText Transfer Protocol) is the foundation of data communication on the web — a stateless, application-layer request-response protocol operating over TCP (or QUIC in HTTP/3). It defines how clients and servers structure messages, negotiate capabilities, and transfer resources.

**Key Properties:**
- **Stateless** — each request is independent; no session state is stored on the server between requests (state is externalised to cookies, tokens, or server-side sessions)
- **Text-based (HTTP/1.x)** → **Binary-framed (HTTP/2 & 3)** — newer versions improve efficiency at the wire level
- **Application-layer protocol** — sits atop TCP/IP (or UDP/QUIC), relies on the transport layer for reliability

---

## HTTP Versions

### HTTP/1.0
- One TCP connection per request — connection closed after each response
- No persistent connections by default → high latency from repeated TCP handshakes
- No host header — limits virtual hosting

### HTTP/1.1
- **Persistent connections** (`Connection: keep-alive` by default) — reuse TCP connection across multiple requests
- **Pipelining** — client can send multiple requests without waiting for responses, but responses must arrive in order (head-of-line blocking at the application layer)
- **Chunked transfer encoding** — stream responses without knowing total content-length upfront
- Host header mandatory — enables virtual hosting on shared IPs

**Bottleneck:** head-of-line (HOL) blocking — if one response stalls, subsequent responses are delayed even if ready.

### HTTP/2
- **Binary framing layer** — requests and responses split into frames, multiplexed over a single TCP connection
- **Multiplexing** — multiple concurrent streams on a single connection; no HOL blocking at the application layer
- **Header compression (HPACK)** — reduces overhead from repetitive headers
- **Server Push** — server can proactively send resources the client will likely need (e.g., CSS, JS alongside HTML)
- **Stream prioritisation** — clients can signal relative priorities

**Bottleneck:** TCP HOL blocking persists — a dropped packet stalls all streams until retransmission resolves.

### HTTP/3
- Replaces TCP with **QUIC** (UDP-based) — eliminates TCP HOL blocking entirely
- Built-in **TLS 1.3** — 0-RTT and 1-RTT handshakes reduce connection setup latency
- Connection migration — connections survive IP address changes (mobile handoffs)
- Adopted by major CDNs (Cloudflare, Google) and browsers

```
Version Comparison

HTTP/1.1            HTTP/2              HTTP/3
───────────         ───────────         ───────────
TCP + TLS           TCP + TLS           QUIC (UDP) + TLS 1.3
Text-based          Binary frames       Binary frames
1 req/connection    Multiplexed         Multiplexed
Sequential headers  HPACK compression   QPACK compression
No server push      Server push         Server push
```

---

## Request / Response Structure

### HTTP Request
```
<Method> <Request-URI> <HTTP-Version>
<Headers>

<Body (optional)>
```

Example:
```
POST /api/orders HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer eyJhbGci...
Content-Length: 82

{"item_id": "sku_42", "quantity": 2, "user_id": "u_9812"}
```

### HTTP Response
```
<HTTP-Version> <Status-Code> <Reason-Phrase>
<Headers>

<Body (optional)>
```

Example:
```
HTTP/1.1 201 Created
Content-Type: application/json
Location: /api/orders/ord_7123
Cache-Control: no-store

{"order_id": "ord_7123", "status": "confirmed"}
```

---

## HTTP Methods

| Method  | Idempotent | Safe | Body | Primary Use |
|---------|-----------|------|------|-------------|
| GET     | ✅        | ✅   | No   | Retrieve resource |
| HEAD    | ✅        | ✅   | No   | Metadata only (same as GET but no body) |
| POST    | ❌        | ❌   | Yes  | Create resource or trigger action |
| PUT     | ✅        | ❌   | Yes  | Replace entire resource |
| PATCH   | ❌*       | ❌   | Yes  | Partial update |
| DELETE  | ✅        | ❌   | No   | Remove resource |
| OPTIONS | ✅        | ✅   | No   | CORS preflight, capability discovery |
| CONNECT | ❌        | ❌   | —    | Tunnel (HTTPS proxying) |

*PATCH can be made idempotent with conditional requests (If-Match header).

**Idempotency matters for retries** — safe to retry PUT/DELETE on network failure; retrying POST without deduplication can create duplicates.

---

## Status Codes

### 2xx — Success
| Code | Name | When to use |
|------|------|-------------|
| 200 | OK | General success (GET, PUT, PATCH) |
| 201 | Created | Resource created (POST) — include Location header |
| 202 | Accepted | Async processing started — will complete later |
| 204 | No Content | Success with no body (DELETE, some PUT/PATCH) |

### 3xx — Redirection
| Code | Name | When to use |
|------|------|-------------|
| 301 | Moved Permanently | Permanent URL change — clients should update bookmarks |
| 302 | Found | Temporary redirect |
| 304 | Not Modified | Cached version is valid (conditional GET response) |
| 307 | Temporary Redirect | Redirect preserving original method |
| 308 | Permanent Redirect | Permanent, preserves method (vs 301) |

### 4xx — Client Errors
| Code | Name | When to use |
|------|------|-------------|
| 400 | Bad Request | Malformed syntax, validation failure |
| 401 | Unauthorized | Not authenticated |
| 403 | Forbidden | Authenticated but lacks permission |
| 404 | Not Found | Resource doesn't exist |
| 405 | Method Not Allowed | Wrong HTTP method for endpoint |
| 409 | Conflict | State conflict (e.g., duplicate creation, optimistic lock fail) |
| 410 | Gone | Resource permanently deleted |
| 422 | Unprocessable Entity | Semantic validation failure |
| 429 | Too Many Requests | Rate limit exceeded |

### 5xx — Server Errors
| Code | Name | When to use |
|------|------|-------------|
| 500 | Internal Server Error | Unhandled server exception |
| 502 | Bad Gateway | Upstream service returned invalid response |
| 503 | Service Unavailable | Server temporarily overloaded or in maintenance |
| 504 | Gateway Timeout | Upstream service did not respond in time |

> **Design tip:** Use 503 + `Retry-After` header to signal temporary unavailability; clients and load balancers can act on this.

---

## Headers

### Request Headers (Key System Design Headers)

| Header | Purpose | Example |
|--------|---------|---------|
| `Host` | Target host (mandatory HTTP/1.1) | `api.example.com` |
| `Authorization` | Auth credentials | `Bearer <token>` |
| `Content-Type` | Body media type | `application/json` |
| `Accept` | Desired response format | `application/json` |
| `If-None-Match` | Conditional GET via ETag | `"abc123"` |
| `If-Modified-Since` | Conditional GET via timestamp | `Wed, 01 Jan 2025 00:00:00 GMT` |
| `Cache-Control` | Client cache directives | `no-cache` |
| `X-Request-ID` | Distributed tracing ID | `550e8400-e29b-41d4` |
| `Idempotency-Key` | Deduplicate POST retries | `<uuid>` |

### Response Headers (Key System Design Headers)

| Header | Purpose | Example |
|--------|---------|---------|
| `Content-Type` | Body format | `application/json` |
| `Cache-Control` | Caching directives | `max-age=3600, public` |
| `ETag` | Resource version tag | `"abc123"` |
| `Last-Modified` | Resource last-modified date | `Wed, 01 Jan 2025 00:00:00 GMT` |
| `Location` | Redirect or newly created resource URL | `/api/orders/ord_7123` |
| `Retry-After` | Backoff hint for 429/503 | `30` (seconds) |
| `Strict-Transport-Security` | Enforce HTTPS | `max-age=31536000; includeSubDomains` |
| `X-RateLimit-Remaining` | Remaining quota | `48` |

---

## Connection Management

### Keep-Alive / Persistent Connections
- Default in HTTP/1.1; avoids TCP handshake per request
- Configurable via `Keep-Alive: timeout=5, max=100`
- Servers set limits to avoid resource exhaustion

### TCP Connection Pooling
- Application-level pattern: maintain a pool of open connections to upstream services
- Critical for microservices — each service-to-service call should reuse connections
- Libraries: `axios` (Node.js), `requests.Session` (Python), `http.Client` reuse (Go)

### HTTP/2 Multiplexing
- Single connection per origin; frames interleave on streams
- Eliminates the browser 6-connection-per-origin limit from HTTP/1.1
- Ideal for high-request-rate scenarios (API calls, asset loading)

### Connection Limits & Backpressure
```
Client → Load Balancer → App Server → DB
         max_conn=10000   max_conn=500  max_conn=100
```
- Mismatched limits cause cascading failures (thundering herd, connection pool exhaustion)
- Use queuing and circuit breakers to absorb spikes

---

## Caching in HTTP

HTTP defines a rich caching model critical for reducing load and latency.

### Cache-Control Directives

| Directive | Scope | Meaning |
|-----------|-------|---------|
| `public` | Shared caches (CDNs) | Anyone can cache |
| `private` | Browser only | Contains user-specific data |
| `no-cache` | All | Must revalidate before using cached copy |
| `no-store` | All | Do not cache at all (sensitive data) |
| `max-age=N` | All | Fresh for N seconds |
| `s-maxage=N` | Shared caches | Override max-age for CDNs |
| `must-revalidate` | All | Must not serve stale after expiry |
| `stale-while-revalidate=N` | All | Serve stale while fetching fresh in background |
| `immutable` | All | Content will never change (cache-bust with versioned URLs) |

### Validation (Conditional Requests)
```
Client                          Server
  |── GET /resource ──────────────→|
  |← 200 OK, ETag: "v1", body ────|

  (later, max-age expired)

  |── GET /resource ──────────────→|
  |   If-None-Match: "v1"          |
  |← 304 Not Modified (no body) ──|  ← saves bandwidth
```

**ETag** (content hash) vs **Last-Modified** (timestamp) — ETags are preferred; timestamps have 1-second granularity.

### Caching Strategy by Content Type

| Content | Strategy | Rationale |
|---------|----------|-----------|
| Static assets (versioned) | `max-age=31536000, immutable` | URL changes on update |
| API responses (public data) | `max-age=60, s-maxage=300` | Fresh enough, CDN-cacheable |
| User-specific data | `private, max-age=0, no-cache` | Never share across users |
| Auth tokens / sessions | `no-store` | Must never be cached |
| HTML pages | `no-cache` or short max-age | Dynamic but can revalidate |

---

## HTTPS & TLS

### TLS Handshake (TLS 1.3)
```
Client                          Server
  |── ClientHello ────────────────→|  (supported ciphers, random)
  |← ServerHello, Certificate ────|  (chosen cipher, cert, random)
  |── Finished ───────────────────→|
  |← Finished ────────────────────|
  |═══════════ Encrypted ══════════|
```
- TLS 1.3: 1-RTT handshake (vs 2-RTT for TLS 1.2)
- 0-RTT resumption: client sends data in first message on session resumption (replay attack risk)

### Certificate Concepts
- **SNI (Server Name Indication)** — TLS extension allowing multiple certs on one IP; critical for CDNs and virtual hosting
- **mTLS (Mutual TLS)** — both client and server authenticate via certificates; used in service mesh (Istio), zero-trust networks
- **Certificate Pinning** — client hardcodes expected cert/key; prevents MITM even with rogue CAs

### HSTS (HTTP Strict Transport Security)
- Instructs browsers to only use HTTPS for a domain for a set duration
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- Eliminates first-visit HTTP redirect vulnerability

---

## Trade-offs

### HTTP/1.1 vs HTTP/2 vs HTTP/3

| Dimension | HTTP/1.1 | HTTP/2 | HTTP/3 |
|-----------|----------|--------|--------|
| Multiplexing | ❌ | ✅ (TCP streams) | ✅ (QUIC streams) |
| HOL Blocking | App + TCP layer | TCP layer only | ❌ Eliminated |
| Header Compression | ❌ | ✅ HPACK | ✅ QPACK |
| Transport | TCP | TCP | QUIC (UDP) |
| TLS | Optional | Optional (recommended) | Mandatory |
| Connection Migration | ❌ | ❌ | ✅ |
| Proxying / Debugging | Easy | Moderate | Harder (UDP) |
| Server Support | Universal | ~97% | ~75-80% |
| Use case | Legacy, simplicity | Most modern APIs | Mobile, high-latency paths |

### Polling vs Long Polling vs SSE vs WebSocket

| Pattern | Protocol | Direction | Latency | Overhead | Best For |
|---------|----------|-----------|---------|----------|---------|
| Short Polling | HTTP | Client → Server | High (interval) | High (repeated requests) | Simple status checks |
| Long Polling | HTTP | Client → Server | Low | Moderate (held connections) | Notifications, fallback |
| Server-Sent Events (SSE) | HTTP | Server → Client | Low | Low | Live feeds, dashboards |
| WebSocket | WS (HTTP upgrade) | Bidirectional | Very low | Low (after handshake) | Chat, gaming, collaboration |

### REST over HTTP vs gRPC

| Dimension | REST/HTTP | gRPC (HTTP/2) |
|-----------|-----------|---------------|
| Protocol | HTTP/1.1 or 2 | HTTP/2 only |
| Payload | JSON (text) | Protocol Buffers (binary) |
| Schema | OpenAPI (optional) | .proto (required) |
| Browser support | Native | Requires grpc-web proxy |
| Streaming | SSE / chunked | Native bidirectional |
| Performance | Moderate | High (smaller payloads) |
| Debugging | Easy (readable) | Harder (binary) |
| Best for | Public APIs, web clients | Internal microservices |

---

## Real-World Systems & Applications

### Cloudflare — HTTP/3 & QUIC at Scale
- Among the first to deploy HTTP/3 in production across their CDN
- QUIC eliminates TCP HOL blocking, critical for lossy last-mile networks (mobile, developing markets)
- Connection migration allows mobile clients to switch WiFi → cellular without re-establishing connections

### Google — SPDY → HTTP/2 Origins
- Google designed SPDY (the precursor to HTTP/2) to address HTTP/1.1 limitations for search and services
- Multiplexing and header compression directly improved page load times for Google Search, Gmail, YouTube

### Stripe — Idempotency Keys over HTTP
- Stripe's payment API uses `Idempotency-Key` header on POST requests
- Client generates a UUID per operation; server deduplicates retries using this key
- Solves the "did my payment go through?" problem in unreliable networks without creating duplicates

### Netflix — HTTP Range Requests for Video Streaming
- Uses `Range` request header to fetch specific byte ranges of video files
- Enables resumable downloads, adaptive bitrate switching, and parallel chunk fetching
- `Accept-Ranges: bytes` in response signals support; `206 Partial Content` returned

### Twitter/X — SSE for Real-Time Timeline
- Server-Sent Events used to push new tweets and notifications to browser clients
- Single long-lived HTTP connection; auto-reconnect built into the EventSource API
- More efficient than polling; simpler than WebSocket for unidirectional push

### Facebook — mTLS in Internal Services
- All internal service-to-service communication secured with mTLS
- Services carry cryptographic identity; eliminates reliance on network perimeter security
- Certificate rotation automated via internal PKI

### Amazon — Aggressive HTTP Caching in API Gateway
- CDN-level `Cache-Control` headers on product catalogue APIs
- `stale-while-revalidate` allows serving slightly stale data (e.g., inventory counts) without latency penalty on cache miss
- Reduces origin load dramatically on high-traffic shopping events (Prime Day)

### Slack — HTTP/2 for API & SSE for Real-Time
- HTTP/2 multiplexing reduces connection overhead for the many parallel API requests from desktop client
- SSE stream delivers message events, typing indicators, and presence updates

---

## Decision Framework

### Which HTTP Version to Use?
```
Is the client a browser or modern HTTP client?
  └─ Yes → Negotiate HTTP/2 minimum (most servers/CDNs handle this automatically)
      └─ Is latency on lossy/mobile networks critical?
          └─ Yes → Enable HTTP/3 / QUIC (CDN layer handles this)
  └─ No (internal microservices) → HTTP/2 mandatory (gRPC requires it)
```

### Which Method to Use?
```
Creating a new resource?       → POST (or PUT if client defines the ID)
Replacing a full resource?     → PUT
Partial update?                → PATCH
Deleting?                      → DELETE
Read-only, no side effects?    → GET
Async job kickoff?             → POST → 202 Accepted → poll or webhook
```

### Caching Strategy?
```
Is content user-specific?
  └─ Yes → Cache-Control: private, or no-store (auth/payment flows)
  └─ No →
      Is content static and versioned?
        └─ Yes → max-age=31536000, immutable
        └─ No (dynamic) →
            Is freshness critical (e.g., prices, inventory)?
              └─ Yes → no-cache (always revalidate) or very short max-age
              └─ No (e.g., blog posts) → moderate max-age + stale-while-revalidate
```

### Sync vs Async Request Patterns?
```
Response needed immediately?
  └─ Yes, < 30s → Synchronous HTTP, 200/201
  └─ No or > 30s → Async: 202 Accepted + polling endpoint or webhook callback
  └─ Real-time events? → SSE (server→client) or WebSocket (bidirectional)
```

---

## Anti-Patterns

### Misusing HTTP Methods
- **Using GET with a body** — semantically incorrect; proxies/CDNs may strip the body; use POST/PUT instead
- **Using GET for mutations** — GET requests are cached and retried freely; side effects break this
- **Overloading POST for everything** — sacrifices idempotency guarantees; makes retries dangerous

### Poor Status Code Usage
- **Returning 200 OK with an error body** — breaks client error handling, monitoring, and alerting
- **Returning 500 for client mistakes** — masks client bugs; use 4xx for client errors
- **Using 404 for authentication failures** — security through obscurity; use 401/403 with care (sometimes intentional)

### Caching Mistakes
- **No Cache-Control on static assets** — misses massive bandwidth savings; browsers re-download unchanged files
- **Setting long max-age on mutable resources without versioning** — clients serve stale forever
- **Caching auth-protected responses as public** — leaks user-specific data across clients
- **No `Vary` header when content varies by Accept-Encoding/Accept** — CDNs serve wrong variant to clients

### Connection Mismanagement
- **Creating a new HTTP client per request** — destroys connection pooling; causes port exhaustion at high RPS
- **Not setting timeouts** — single slow upstream hangs threads; starves connection pool
- **Ignoring connection limits** — no backpressure leads to cascading failures

### Security Anti-Patterns
- **Sensitive data in URL query strings** — logged in access logs, browser history, and CDN logs; use POST body or headers
- **Not enforcing HSTS** — allows HTTP downgrade attacks on first visit
- **Disabling certificate verification in HTTP clients** — development shortcut left in production

---

## Monitoring & Metrics

### Golden Signals for HTTP

| Metric | Description | Alert Threshold (example) |
|--------|-------------|--------------------------|
| **Request Rate** (RPS) | Requests per second | Spike >2x baseline |
| **Error Rate** | % of 4xx / 5xx responses | 5xx > 1%, 4xx spike |
| **Latency** | p50, p95, p99 response time | p99 > SLA threshold |
| **Saturation** | Active connections / pool size | > 80% pool utilised |

### Key HTTP-Specific Metrics

- **Cache Hit Rate** — % of requests served from cache (CDN or browser); target > 90% for static assets
- **Time to First Byte (TTFB)** — server processing latency; high TTFB indicates DB or compute bottlenecks
- **Connection Reuse Rate** — % of requests using existing TCP connections; low rate indicates client misconfiguration
- **TLS Handshake Time** — overhead per new connection; use session resumption to reduce
- **5xx by endpoint** — service-level breakdown reveals specific routes degrading
- **Retry Rate** — elevated retries indicate upstream instability or insufficient timeouts

### Headers Worth Logging
- `X-Request-ID` / `X-Trace-ID` — correlate logs across services
- `X-Forwarded-For` — real client IP behind proxies
- `User-Agent` — client type for traffic analysis
- `Referer` — inbound traffic source
- Response `Cache-Control` — validate caching is configured as intended