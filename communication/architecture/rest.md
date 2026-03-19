# REST (Representational State Transfer)

---

## 1. What is REST?

REST is an **architectural style** for designing networked applications, defined by Roy Fielding in his 2000 doctoral dissertation. It is not a protocol or standard — it is a set of constraints that, when applied to a web service, produces a **RESTful** system.

REST operates over **HTTP** and treats every piece of data or functionality as a **resource**, each addressable by a unique URI. Clients interact with resources through a fixed set of operations (HTTP methods), and the server responds with representations of those resources (typically JSON or XML).

---

## 2. Core Constraints (REST Principles)

These six constraints define what makes an API truly RESTful:

### 2.1 Client-Server Separation
- The UI (client) and data storage (server) are decoupled.
- Each can evolve independently.
- Improves portability of the UI and scalability of the server.

### 2.2 Statelessness
- Each request from client to server must contain **all information needed** to understand and process the request.
- The server stores **no session state** between requests.
- Session state is kept entirely on the client (via tokens, cookies, etc.).
- Enables horizontal scaling — any server instance can handle any request.

### 2.3 Cacheability
- Responses must explicitly declare themselves as cacheable or non-cacheable.
- Clients and intermediaries (CDNs, proxies) can cache responses.
- Reduces server load and latency for repeated requests.
- HTTP cache headers: `Cache-Control`, `ETag`, `Last-Modified`, `Expires`.

### 2.4 Uniform Interface
The central feature of REST. Consists of four sub-constraints:
- **Resource identification via URIs** — resources are named, not actions.
- **Manipulation through representations** — clients manipulate resources via the representations they receive (e.g., JSON body).
- **Self-descriptive messages** — each message includes enough information to describe how to process it (Content-Type, status codes).
- **HATEOAS** (Hypermedia As The Engine Of Application State) — responses include links to related actions/resources. Rarely fully implemented in practice.

### 2.5 Layered System
- The client cannot tell whether it is connected directly to the server or to an intermediary (load balancer, CDN, API gateway, cache).
- Enables scalability via load balancers, security via gateways, and performance via caches.

### 2.6 Code on Demand (Optional)
- Servers can extend client functionality by transferring executable code (e.g., JavaScript).
- The only optional constraint.

---

## 3. HTTP Methods & Semantics

| Method   | Operation  | Idempotent | Safe | Use Case                        |
|----------|------------|:----------:|:----:|---------------------------------|
| `GET`    | Read       | ✅          | ✅   | Fetch a resource                |
| `POST`   | Create     | ❌          | ❌   | Create a new resource           |
| `PUT`    | Replace    | ✅          | ❌   | Full update of a resource       |
| `PATCH`  | Modify     | ❌*         | ❌   | Partial update of a resource    |
| `DELETE` | Remove     | ✅          | ❌   | Delete a resource               |
| `HEAD`   | Metadata   | ✅          | ✅   | Same as GET but no body         |
| `OPTIONS`| Introspect | ✅          | ✅   | Discover allowed methods (CORS) |

> **Idempotent**: Multiple identical requests produce the same result.  
> **Safe**: The operation does not modify server state.  
> *`PATCH` idempotency depends on implementation.

---

## 4. Resource Design & URI Conventions

### 4.1 URI Structure
```
https://api.example.com/v1/{collection}/{resource-id}/{sub-collection}
```

### 4.2 Naming Rules
```
# Use nouns, not verbs — the verb is the HTTP method
GET  /users          ✅   GET  /getUsers       ❌
POST /users          ✅   POST /createUser      ❌

# Use plural nouns for collections
GET  /users          ✅   GET  /user            ❌

# Use kebab-case for multi-word resources
GET  /user-profiles  ✅   GET  /userProfiles    ❌

# Hierarchical relationships via path nesting
GET  /users/42/orders         # Orders for user 42
GET  /users/42/orders/7       # Order 7 for user 42

# Avoid deep nesting (> 2 levels)
GET  /users/42/orders/7/items/3/reviews   ❌  # Too deep
GET  /reviews/91                           ✅  # Flatten with direct access
```

### 4.3 Query Parameters
Use query parameters for filtering, sorting, pagination — not for resource identity.
```
GET /products?category=electronics&sort=price&order=asc&page=2&limit=25
```

---

## 5. HTTP Status Codes

### 2xx — Success
| Code | Meaning              | When to Use                         |
|------|----------------------|-------------------------------------|
| 200  | OK                   | Successful GET, PUT, PATCH          |
| 201  | Created              | Successful POST (return `Location`) |
| 204  | No Content           | Successful DELETE, no body needed   |
| 206  | Partial Content      | Paginated or range responses        |

### 3xx — Redirection
| Code | Meaning              | When to Use                          |
|------|----------------------|--------------------------------------|
| 301  | Moved Permanently    | API versioning, permanent redirects  |
| 304  | Not Modified         | Cache validation (`ETag`, `If-None-Match`) |

### 4xx — Client Errors
| Code | Meaning              | When to Use                          |
|------|----------------------|--------------------------------------|
| 400  | Bad Request          | Malformed request, validation errors |
| 401  | Unauthorized         | Not authenticated                    |
| 403  | Forbidden            | Authenticated but not authorized     |
| 404  | Not Found            | Resource does not exist              |
| 409  | Conflict             | Duplicate resource, state conflict   |
| 410  | Gone                 | Resource permanently deleted         |
| 422  | Unprocessable Entity | Semantic validation failure          |
| 429  | Too Many Requests    | Rate limit exceeded                  |

### 5xx — Server Errors
| Code | Meaning                 | When to Use                          |
|------|-------------------------|--------------------------------------|
| 500  | Internal Server Error   | Unexpected server failure            |
| 502  | Bad Gateway             | Upstream service failure             |
| 503  | Service Unavailable     | Server overloaded, maintenance       |
| 504  | Gateway Timeout         | Upstream timeout                     |

---

## 6. Request & Response Design

### 6.1 Request Structure
```http
POST /v1/orders HTTP/1.1
Host: api.example.com
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json
Idempotency-Key: a1b2c3d4-e5f6-...

{
  "user_id": "usr_42",
  "items": [
    { "product_id": "prod_7", "quantity": 2 }
  ],
  "shipping_address": "123 Main St"
}
```

### 6.2 Response Structure (Envelope Pattern)
```json
{
  "data": {
    "id": "ord_123",
    "status": "confirmed",
    "total": 49.99
  },
  "meta": {
    "request_id": "req_abc",
    "timestamp": "2025-03-19T10:00:00Z"
  },
  "links": {
    "self": "/v1/orders/ord_123",
    "items": "/v1/orders/ord_123/items"
  }
}
```

### 6.3 Error Response Structure
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request body contains invalid fields.",
    "details": [
      { "field": "quantity", "issue": "Must be greater than 0" }
    ],
    "request_id": "req_xyz"
  }
}
```

---

## 7. Versioning Strategies

| Strategy           | Example                              | Pros                        | Cons                            |
|--------------------|--------------------------------------|-----------------------------|---------------------------------|
| **URI Path**       | `/v1/users`                          | Simple, explicit, cacheable | URL changes, not "pure" REST   |
| **Query Param**    | `/users?version=1`                   | Backward compatible         | Easy to omit, cache issues      |
| **Header**         | `API-Version: 2024-01-01`            | Clean URLs                  | Less visible, harder to test    |
| **Content-Type**   | `Accept: application/vnd.api+json;v=2` | True REST (HATEOAS)       | Complex, low adoption           |

> **Industry standard**: URI Path versioning (`/v1/`, `/v2/`) is most widely adopted due to its simplicity and cacheability. Stripe uses date-based header versioning as an alternative.

---

## 8. Pagination

### 8.1 Offset Pagination
```
GET /users?limit=25&offset=50
```
- Simple to implement and understand.
- **Problem**: Page drift when items are inserted/deleted during pagination.
- **Problem**: Expensive for large offsets (`OFFSET 1000000` is a full table scan).

### 8.2 Cursor-Based Pagination (Keyset)
```
GET /users?limit=25&after=cursor_abc123
```
- Cursor encodes the last seen item (e.g., `id` or `created_at`).
- **Stable**: No drift on insertion/deletion.
- **Efficient**: Uses index seeks, not full scans.
- **Limitation**: Cannot jump to arbitrary pages.
- Used by: Twitter, Facebook, Stripe, Slack.

### 8.3 Page-Based Pagination
```
GET /users?page=3&per_page=25
```
- Conceptually simple. Same underlying issues as offset.

### 8.4 Response with Pagination Metadata
```json
{
  "data": [...],
  "pagination": {
    "next_cursor": "cursor_xyz",
    "has_more": true,
    "total": 1042
  }
}
```

---

## 9. Authentication & Authorization

### 9.1 API Keys
- Simple long-lived token in header: `Authorization: ApiKey <key>`
- Easy to implement, hard to scope finely.
- Best for server-to-server communication.

### 9.2 Bearer Tokens (JWT)
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
- JWT encodes claims (user ID, roles, expiry) — server can verify without DB lookup.
- **Stateless** — fits REST's statelessness constraint perfectly.
- **Problem**: Cannot be revoked until expiry; requires short TTLs + refresh tokens.

### 9.3 OAuth 2.0
- Delegation protocol for third-party access.
- Access tokens (short-lived) + refresh tokens (long-lived).
- Scopes limit what the token can access.
- Used by: Google, GitHub, Stripe, Slack.

### 9.4 mTLS (Mutual TLS)
- Client and server both present certificates.
- Used for high-security service-to-service communication.

---

## 10. Rate Limiting

Essential for protecting APIs from abuse and ensuring fair usage.

### Strategies
| Algorithm          | Description                                      | Use Case                  |
|--------------------|--------------------------------------------------|---------------------------|
| **Fixed Window**   | N requests per time window (e.g., 1000/hour)    | Simple, easy to implement |
| **Sliding Window** | Rolling N requests over last T seconds           | Smoother enforcement      |
| **Token Bucket**   | Tokens refill at fixed rate; burst allowed       | Allows short bursts       |
| **Leaky Bucket**   | Requests processed at fixed rate; excess queued  | Smooth output rate        |

### Response Headers
```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 750
X-RateLimit-Reset: 1711234567
Retry-After: 30        # Returned with 429
```

---

## 11. Idempotency

Critical for safe retries in distributed systems.

- **GET, PUT, DELETE** are inherently idempotent.
- **POST** is NOT idempotent — use `Idempotency-Key` header.

```http
POST /v1/payments
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

Server stores the key and response; duplicate requests return the cached response. Key expires after a TTL (e.g., 24 hours).

**Used by**: Stripe, Braintree, Adyen — any payment API where duplicate charges must be prevented.

---

## 12. HATEOAS

Hypermedia As The Engine Of Application State — the most misunderstood REST constraint.

```json
{
  "id": "ord_123",
  "status": "pending",
  "_links": {
    "self":    { "href": "/orders/ord_123" },
    "confirm": { "href": "/orders/ord_123/confirm", "method": "POST" },
    "cancel":  { "href": "/orders/ord_123/cancel",  "method": "DELETE" },
    "items":   { "href": "/orders/ord_123/items" }
  }
}
```

- Clients discover available actions dynamically from the response — no hardcoded URLs.
- Decouples client from server URL structure.
- **Reality**: Rarely fully implemented. Most APIs treat it as optional.

---

## 13. Caching in REST

### HTTP Cache Headers
| Header            | Direction         | Purpose                                     |
|-------------------|-------------------|---------------------------------------------|
| `Cache-Control`   | Both              | `max-age`, `no-store`, `private`, `public`  |
| `ETag`            | Server → Client   | Fingerprint of resource version             |
| `Last-Modified`   | Server → Client   | Timestamp of last change                    |
| `If-None-Match`   | Client → Server   | Conditional GET with ETag                   |
| `If-Modified-Since` | Client → Server | Conditional GET with timestamp              |
| `Vary`            | Server → Client   | Which request headers affect caching        |

### Conditional GET Flow
```
Client → GET /users/42
         If-None-Match: "etag_abc"

Server → 304 Not Modified   (if unchanged — no body, saves bandwidth)
       → 200 OK + new ETag  (if changed)
```

---

## 14. Trade-offs

### REST vs. GraphQL
| Dimension             | REST                                      | GraphQL                                   |
|-----------------------|-------------------------------------------|-------------------------------------------|
| Data fetching         | Fixed shape per endpoint                  | Client specifies exact shape              |
| Over-fetching         | Common (extra fields returned)            | Eliminated                                |
| Under-fetching        | Requires multiple round trips             | Single request fetches all needed data    |
| Caching               | Excellent (HTTP caching built-in)         | Harder (POST for queries, no HTTP cache)  |
| Tooling/ecosystem     | Mature, universal                         | Growing, more complex                     |
| Learning curve        | Low                                       | Higher                                    |
| Best for              | Public APIs, simple CRUD, microservices   | Complex UIs, mobile apps, BFF pattern     |

### REST vs. gRPC
| Dimension             | REST                                      | gRPC                                      |
|-----------------------|-------------------------------------------|-------------------------------------------|
| Protocol              | HTTP/1.1 or HTTP/2                        | HTTP/2 only                               |
| Payload format        | JSON (text, large)                        | Protobuf (binary, compact)                |
| Performance           | Moderate                                  | High (3–10x faster serialization)         |
| Streaming             | Limited (SSE, chunked)                    | Native bi-directional streaming           |
| Browser support       | Universal                                 | Poor (requires grpc-web proxy)            |
| Contract              | OpenAPI/Swagger (optional)                | Proto file (required, enforced)           |
| Best for              | Public APIs, browser clients              | Internal microservices, low-latency needs |

### REST Strengths
- **Universal compatibility** — every HTTP client can consume it.
- **HTTP caching** — inherits the full HTTP caching model.
- **Statelessness** — trivial horizontal scaling.
- **Human readable** — JSON over HTTP is debuggable with any tool.
- **Ecosystem maturity** — OpenAPI, Swagger UI, Postman, countless libraries.
- **Loose coupling** — clients and servers evolve independently.

### REST Weaknesses
- **Over/under-fetching** — fixed response shapes cause inefficiency.
- **Multiple round trips** — fetching related resources requires N+1 calls.
- **No real-time support** — polling, SSE, or WebSocket workarounds needed.
- **Statelessness overhead** — auth tokens repeated on every request.
- **Versioning complexity** — breaking changes require new versions.
- **No strict contract** — OpenAPI is optional; schema drift is common.

---

## 15. Real-World System Examples

### Stripe (Payments API)
- URI-based versioning (`/v1/`) with date-based header versioning for granular control.
- Idempotency keys on all mutating payment endpoints.
- Consistent error codes (`card_declined`, `insufficient_funds`) across all languages.
- Webhook delivery with retry logic for async event propagation.

### GitHub REST API
- Full URI versioning + `Accept` header media type versioning.
- Cursor + Link header pagination (`Link: <url>; rel="next"`).
- Conditional requests with `ETag` and `If-None-Match` to minimize bandwidth.
- Rate limiting with `X-RateLimit-*` headers; higher limits for authenticated requests.

### Twitter/X API
- Cursor-based pagination for timeline endpoints (stable under real-time insertion).
- Expansions and fields parameters to reduce round trips (bridge toward GraphQL-like flexibility).
- OAuth 2.0 with PKCE for user-level access.

### Shopify API
- REST for resource CRUD; GraphQL for complex storefront queries.
- Leaky bucket rate limiting with `X-Shopify-Shop-Api-Call-Limit` header.
- API versioning by date: `/2024-01/`.

### Twilio
- Subresource-based REST hierarchy: `/Accounts/{SID}/Messages/{MessageSID}`.
- Idempotency supported via request-specific keys.
- TwiML (XML response format) as a REST-driven instruction set for telephony.

### AWS APIs (S3, EC2, etc.)
- SigV4 request signing for authentication instead of bearer tokens.
- ETag-based conditional operations (S3 `If-Match`, `If-None-Match`).
- Strongly consistent REST semantics for object storage.

---

## 16. REST API Design Decision Framework

```
Is this an internal service-to-service call?
  ├── Yes, high-throughput, low-latency?  → Consider gRPC
  └── No / public API / browser clients?
        ├── Complex, nested, client-driven queries?  → Consider GraphQL
        └── Standard CRUD, public consumers?         → REST ✅

Choosing pagination:
  ├── Need arbitrary page jumps?          → Offset (accept drift risk)
  ├── Real-time feed, large dataset?      → Cursor-based ✅
  └── Small, static dataset?             → Offset (fine here)

Choosing versioning:
  ├── Public API, many consumers?         → URI path (/v1/)
  ├── Granular per-consumer versioning?   → Date-based header (Stripe model)
  └── Internal API, controlled clients?  → Header versioning

Handling mutations:
  ├── Payment, order, financial ops?      → Idempotency-Key required ✅
  ├── Non-critical creates?              → Standard POST, handle 409
  └── Read-modify-write conflicts?       → Optimistic locking with ETag
```

---

## 17. Anti-Patterns

| Anti-Pattern                   | Problem                                              | Fix                                             |
|--------------------------------|------------------------------------------------------|-------------------------------------------------|
| **Verbs in URIs**              | `/getUser`, `/createOrder` violates uniform interface | Use nouns + HTTP methods                        |
| **Ignoring HTTP semantics**    | `GET` with side effects; `POST` for reads            | Match HTTP method to operation semantics        |
| **Inconsistent error format**  | Different error shapes per endpoint                  | Define a global error schema                    |
| **Returning 200 for errors**   | Body says "error" but status is 200                  | Use correct 4xx/5xx codes                       |
| **Deeply nested URLs**         | `/a/1/b/2/c/3/d/4`                                   | Flatten; use query params for filtering         |
| **Breaking changes without versioning** | Fields removed/renamed in-place              | Version the API before breaking                 |
| **No pagination on collections** | Returning all 10M records                         | Always paginate list endpoints                  |
| **Stateful server sessions**   | Storing session in server memory                     | Move session state to client (JWT, cookies)     |
| **Non-idempotent PUT**         | PUT with partial updates (PATCH behavior)            | Use PATCH for partial, PUT for full replace     |
| **Hardcoded API version in clients** | Clients break on any version change            | Support `Accept` version negotiation            |

---

## 18. Monitoring & Observability

### Key Metrics
- **Request rate** — RPS per endpoint, overall throughput.
- **Error rate** — percentage of 4xx and 5xx responses; alert on 5xx spikes.
- **Latency** — P50, P95, P99 per endpoint; not averages.
- **Rate limit hits** — 429 frequency; signal of abuse or client bugs.
- **Payload size** — response sizes; detect over-fetching.

### Distributed Tracing Headers
```http
X-Request-ID: abc-123      # Unique per request; log and return to client
X-Correlation-ID: xyz-456  # Spans across service boundaries
traceparent: 00-...        # W3C Trace Context standard
```

### Health & Readiness Endpoints
```
GET /health        → 200 { "status": "ok" }
GET /readiness     → 200 / 503 (depends on upstream dependencies)
GET /version       → 200 { "version": "1.4.2", "build": "abc123" }
```

---

## 19. OpenAPI / Swagger

The de facto standard for REST API documentation and code generation.

```yaml
openapi: 3.1.0
info:
  title: Orders API
  version: 1.0.0
paths:
  /orders:
    post:
      summary: Create an order
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateOrderRequest'
      responses:
        '201':
          description: Order created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Order'
        '400':
          $ref: '#/components/responses/BadRequest'
```

- Enables automated client SDK generation (openapi-generator).
- Powers interactive documentation (Swagger UI, Redoc).
- Used for API contract testing and mock server generation.