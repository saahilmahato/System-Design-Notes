# Performance Antipattern: Extraneous Fetching

---

## 1. What Is Extraneous Fetching?

**Extraneous Fetching** is a performance antipattern where a system retrieves **more data than it actually needs** — either in terms of volume, frequency, or scope — causing unnecessary load on databases, networks, and application servers.

It manifests in three primary dimensions:

| Dimension | Description | Example |
|---|---|---|
| **Over-fetching** | Retrieving more columns/fields than required | `SELECT *` when only 2 columns are needed |
| **N+1 Fetching** | Fetching related data in loops instead of in bulk | Querying DB once per list item |
| **Redundant Fetching** | Fetching the same data repeatedly without caching | Re-reading config on every request |

---

## 2. Root Causes

- **ORM misuse** — ORMs (Hibernate, ActiveRecord, SQLAlchemy) silently generate inefficient queries; lazy loading triggers N+1 without developer awareness
- **Poorly designed APIs** — REST endpoints return entire resource representations regardless of client needs
- **Lack of caching awareness** — repeated identical reads hit the DB because no cache layer exists or is bypassed
- **Premature abstraction** — generic data access layers that always fetch full objects
- **Frontend-driven fetching** — BFF (Backend for Frontend) not tailored to UI data needs; clients over-request
- **Missing query analysis** — teams ship without reviewing `EXPLAIN` plans or monitoring slow query logs

---

## 3. Manifestations

### 3.1 Over-Fetching (Column / Field Level)

```sql
-- BAD: Fetching entire row when only name is needed
SELECT * FROM users WHERE id = 42;

-- GOOD: Fetch only required columns
SELECT name FROM users WHERE id = 42;
```

In REST APIs, returning full resource objects when the client only needs a subset:

```json
// Client needs only: { "id": 1, "name": "Alice" }
// Server returns entire user object with 30+ fields including address, metadata, audit logs
```

### 3.2 N+1 Query Problem

```python
# BAD: N+1 — 1 query to get orders + N queries to get each user
orders = db.query("SELECT * FROM orders")
for order in orders:
    user = db.query(f"SELECT * FROM users WHERE id = {order.user_id}")  # N queries

# GOOD: Single JOIN or batch fetch
orders = db.query("""
    SELECT orders.*, users.name, users.email
    FROM orders
    JOIN users ON orders.user_id = users.id
""")
```

ORM example (Django):

```python
# BAD — triggers N+1
for order in Order.objects.all():
    print(order.user.name)  # Lazy load fires per iteration

# GOOD — prefetch_related / select_related
for order in Order.objects.select_related('user').all():
    print(order.user.name)  # Single JOIN query
```

### 3.3 Redundant / Repeated Fetching

```python
# BAD: Config fetched from DB on every request
def handle_request():
    config = db.query("SELECT * FROM config")  # Runs every time
    ...

# GOOD: Cache the config
config_cache = None

def handle_request():
    global config_cache
    if not config_cache:
        config_cache = db.query("SELECT * FROM config")
    ...
```

### 3.4 Pagination Ignored (Unbounded Fetching)

```sql
-- BAD: Fetching all rows when displaying first 20
SELECT * FROM products;  -- Returns 2 million rows

-- GOOD: Paginate
SELECT * FROM products ORDER BY id LIMIT 20 OFFSET 0;
```

### 3.5 Chatty API Calls (Micro-request Storms)

```
-- BAD: Client makes 50 individual API calls to build one page
GET /api/user/1
GET /api/user/1/orders
GET /api/user/1/preferences
GET /api/user/1/notifications
... (repeated for each user in a list)

-- GOOD: Aggregate in a single GraphQL query or batch endpoint
POST /api/batch
{ "queries": ["user", "orders", "preferences", "notifications"] }
```

---

## 4. Detection Signals

| Signal | Indicator |
|---|---|
| Slow response times under normal load | Excess data being serialized and transferred |
| High DB CPU with low write volume | Repetitive read queries |
| Network bandwidth spikes | Large payload sizes |
| `EXPLAIN` shows full table scans | Missing projections or indexes |
| APM shows N+1 query counts | ORM lazy loading antipattern |
| Memory pressure on app servers | Large object graphs held in memory |

**Tooling for detection:**

- **DB**: `EXPLAIN ANALYZE` (PostgreSQL), slow query log (MySQL), Query Store (SQL Server)
- **APM**: Datadog APM, New Relic, Dynatrace — detect N+1 patterns automatically
- **ORM**: Django Debug Toolbar, Hibernate Statistics, Bullet gem (Rails)
- **Profilers**: py-spy, async-profiler (JVM), pprof (Go)

---

## 5. Solutions & Mitigations

### 5.1 Field Projection — Fetch Only What You Need

- Use explicit column lists in SQL (`SELECT id, name` not `SELECT *`)
- Use GraphQL field selection to enforce client-driven projections
- Design REST APIs with sparse fieldsets (`?fields=id,name,email`)

### 5.2 Eager Loading / Query Consolidation

- Use `JOIN` or `IN` clause to batch-fetch related data
- ORM hints: `select_related`, `include`, `with`, `eager_load`
- DataLoader pattern (popularized by Facebook) for batching and deduplication in GraphQL resolvers

### 5.3 Caching

- **Application-level cache**: Redis / Memcached for frequently-read, rarely-changed data
- **HTTP cache**: ETag, `Cache-Control` headers to avoid redundant network fetches
- **Result cache**: Cache full query results for read-heavy aggregations
- **CDN**: Cache static and semi-static API responses at the edge

### 5.4 Pagination & Cursor-Based Fetching

- Always paginate list endpoints; enforce max page size
- Use cursor-based pagination for large, frequently-updated datasets
- Avoid `OFFSET` at large offsets — use keyset pagination instead

### 5.5 API Design Improvements

- **GraphQL**: Clients specify exactly what data they need
- **BFF (Backend for Frontend)**: Tailor API responses to each client's actual needs
- **Batch endpoints**: Group multiple reads into a single request
- **Partial response patterns**: `?fields=`, `?include=`

### 5.6 Database Query Optimization

- Add indexes on frequently filtered / joined columns
- Use covering indexes to avoid table lookups entirely
- Materialized views for expensive aggregations
- Denormalize hot query paths where joins become too costly

---

## 6. Trade-offs

| Solution | Benefit | Cost / Risk |
|---|---|---|
| Field projection | Reduced data transfer, faster queries | More coupling between query and schema; harder to reuse generic methods |
| Eager loading (JOIN) | Eliminates N+1, single round-trip | Can produce large result sets if not careful; cartesian products on multiple JOINs |
| Caching | Drastic reduction in DB load | Stale data risk; cache invalidation complexity; memory overhead |
| GraphQL field selection | Client drives exactly what is fetched | N+1 re-emerges at resolver level without DataLoader; schema complexity |
| Batch endpoints | Fewer round-trips, less overhead | More complex API design; harder to cache individual resources |
| Pagination | Bounded memory & transfer | Requires client-side state management; cursor handling adds complexity |
| Denormalization | Faster reads | Data duplication, higher write complexity, consistency challenges |
| Materialized views | Fast reads for complex aggregations | Refresh cost, potential staleness |

**Core tension**: Optimizing for read performance often increases write complexity, cache invalidation difficulty, and system coupling. Every fix must be weighed against the operational burden it introduces.

---

## 7. Real-World Systems & Examples

### 7.1 Facebook — DataLoader (N+1 in GraphQL)

Facebook's GraphQL layer, when naïvely implemented, triggers N+1 queries — one per resolver per user in a list. They open-sourced **DataLoader**, a batching and caching utility that:
- Collects all IDs requested during a single event loop tick
- Issues one batched DB/service call instead of N individual ones
- Deduplicates repeated requests within the same request lifecycle

This pattern is now standard in virtually every GraphQL server implementation.

### 7.2 Twitter — Timeline Fanout vs. Fanin

Twitter's timeline system originally fetched each tweet on read by joining across follower graphs — classic over-fetching at query time. They eventually moved to **pre-computed timelines** (fanout on write) where tweets are pushed to follower caches on creation, making reads a simple cache lookup. Celebrities (high follower count) use a hybrid: their tweets are fetched on read and merged with the pre-computed feed to avoid catastrophic write fanout.

### 7.3 Shopify — N+1 in GraphQL Storefront API

Shopify's Storefront API is heavily GraphQL-based. Without careful DataLoader usage across their product/variant/inventory resolver graph, every storefront request could trigger hundreds of DB queries per product listing. Shopify implements aggressive DataLoader batching across their Rails-based resolvers and uses read replicas to absorb the read amplification.

### 7.4 GitHub — REST to GraphQL Migration

GitHub migrated from REST to GraphQL (v4 API) explicitly because REST was causing **over-fetching**. A single page on GitHub's frontend required 10–20 REST API calls, each returning full resource representations. With GraphQL, a single query fetches precisely the fields needed for the page, reducing both the number of requests and the data volume per request.

### 7.5 Netflix — Falcor / Data Fetching Layer

Netflix built **Falcor** (before GraphQL became dominant) to solve the same problem — frontends were making many small REST calls to assemble a page's data. Falcor allows the client to specify a JSON graph of exactly what is needed, batching multiple virtual requests into a single HTTP call, eliminating over-fetching and chatty API patterns.

### 7.6 Airbnb — Search Result Over-Fetching

Airbnb's search system historically fetched full listing objects from their database and serialized them entirely into API responses. As they scaled, they introduced **projection layers** that stripped responses to only the fields needed for the search results page (thumbnail, price, rating, title) — dramatically reducing serialization time, network payload, and client-side parse time.

### 7.7 Uber — Trip Data Fetching

Uber's early systems suffered from chatty internal microservice communication — a single user request triggered cascading calls to User Service, Payment Service, Driver Service, and Map Service individually. They introduced an **aggregation layer** (similar to BFF) and adopted gRPC streaming and batch RPCs to consolidate data fetching, reducing tail latency significantly.

---

## 8. Decision Framework

```
Is the query or API call returning more data than the consumer uses?
    YES → Apply field projection / sparse fieldsets / GraphQL

Is the same data being fetched repeatedly across requests?
    YES → Introduce caching (Redis, HTTP cache headers, CDN)

Are N queries being fired for N items in a list?
    YES → Use JOIN, IN clause, DataLoader, or ORM eager loading

Is the dataset unbounded (no LIMIT)?
    YES → Enforce pagination; use cursor-based paging for large datasets

Are multiple small API calls needed to assemble one response?
    YES → Batch endpoint / GraphQL / BFF layer

Is a complex aggregation re-computed on every read?
    YES → Materialized view or pre-computation with cache warming
```

---

## 9. Key Metrics to Monitor

| Metric | Tool | What It Tells You |
|---|---|---|
| DB query count per request | APM, ORM logging | N+1 presence |
| Avg query response time | Slow query log, Datadog | Query efficiency |
| Response payload size | Network tab, APM | Over-fetching severity |
| Cache hit ratio | Redis INFO, APM | Cache effectiveness |
| DB CPU utilization | Cloud monitoring | Read amplification |
| API calls per page load | Browser devtools, RUM | Chatty API patterns |
| P99 latency | APM | Impact of extraneous fetching under load |

---

## 10. Anti-Patterns Summary

| Anti-Pattern | Symptom | Fix |
|---|---|---|
| `SELECT *` | Wide result sets, slow serialization | Explicit column projection |
| Lazy loading in loops | N+1 queries, high DB connection churn | Eager loading, DataLoader |
| No pagination | Memory exhaustion, slow full-table scans | LIMIT/OFFSET or keyset pagination |
| Repeated identical queries | DB thrashing on reads | Caching layer |
| Chatty microservice calls | High latency, connection overhead | Aggregation layer, batch RPC |
| Full object serialization | Large network payloads | Partial response, BFF, GraphQL |
| Ignoring query plans | Hidden full table scans | `EXPLAIN ANALYZE`, index tuning |

---

## 11. Related Patterns & Concepts

- **CQRS (Command Query Responsibility Segregation)** — separate read and write models; read models can be denormalized to serve exactly what's needed
- **DataLoader Pattern** — batching and caching for N+1 elimination
- **BFF (Backend for Frontend)** — tailored aggregation layer per client type
- **GraphQL** — client-driven field selection to eliminate over-fetching
- **Materialized Views** — pre-computed query results for expensive aggregations
- **Read Replicas** — scale reads horizontally when extraneous fetching cannot be fully eliminated
- **HTTP Caching** — `ETag`, `Last-Modified`, `Cache-Control` to avoid redundant network fetches
- **Projection Pattern** — apply at ORM, API, and DB layer to fetch only required fields