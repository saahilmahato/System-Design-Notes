# Materialized View Pattern
> Cloud Design Patterns → Data Management

---

## 1. Overview

A **Materialized View** is a precomputed, stored snapshot of query results derived from one or more source data stores. Unlike a virtual view (which re-executes the query on every read), a materialized view is physically persisted and updated either on a schedule or on data change events.

The pattern exists to solve a fundamental tension in distributed systems: **data is stored in a format optimized for writes, but queries often need it in a format optimized for reads.**

```
┌─────────────────────────────────────────────────────────────────┐
│                     WITHOUT MATERIALIZED VIEW                   │
│                                                                 │
│  Client → Query → [JOIN orders + products + customers] → Result │
│                        (expensive, every time)                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     WITH MATERIALIZED VIEW                      │
│                                                                 │
│  Write Path:                                                    │
│  Source Tables → Change Event → Refresh Job → Materialized View │
│                                                                 │
│  Read Path:                                                     │
│  Client → Query → [Materialized View] → Result (fast, simple)  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Problem It Solves

| Problem | Without Materialized View | With Materialized View |
|---|---|---|
| Complex aggregations | Re-computed on every read | Pre-computed and stored |
| Cross-store joins | Impossible or very slow | Pre-joined and ready |
| OLTP vs OLAP conflict | Analytical queries degrade transactional DB | Analytical reads offloaded |
| Slow dashboard queries | Seconds to minutes per query | Milliseconds |
| Denormalization cost | Done at read time | Done at write/refresh time |

---

## 3. How It Works

### 3.1 Basic Architecture

```
┌──────────────┐     writes      ┌──────────────────┐
│   Source DB  │ ─────────────►  │  Change Capture   │
│  (OLTP/Raw)  │                 │  (CDC / Triggers) │
└──────────────┘                 └────────┬─────────┘
                                          │ events
                                          ▼
                                 ┌──────────────────┐
                                 │   Refresh Engine  │
                                 │  (batch / stream) │
                                 └────────┬─────────┘
                                          │ upserts
                                          ▼
                                 ┌──────────────────┐
                                 │ Materialized View │◄── Reads (fast)
                                 │  (denormalized)   │
                                 └──────────────────┘
```

### 3.2 Refresh Strategies

```
┌─────────────────────────────────────────────────────────────────────┐
│                        REFRESH STRATEGIES                           │
├──────────────────┬──────────────────────────────────────────────────┤
│  Full Refresh    │ Truncate and rebuild entire view from scratch.    │
│                  │ Simple, consistent. Expensive for large datasets. │
├──────────────────┼──────────────────────────────────────────────────┤
│  Incremental     │ Only apply deltas (inserts/updates/deletes).      │
│  Refresh         │ Fast, but requires change tracking (CDC/logs).    │
├──────────────────┼──────────────────────────────────────────────────┤
│  On Demand       │ Refresh triggered manually or by an API call.     │
│                  │ Good for rarely-changing reference data.          │
├──────────────────┼──────────────────────────────────────────────────┤
│  Scheduled       │ Cron-based refresh (e.g., every 5 mins, hourly). │
│                  │ Simple but introduces a staleness window.         │
├──────────────────┼──────────────────────────────────────────────────┤
│  Real-Time       │ Stream-based (Kafka → Flink/Spark Streaming).     │
│  (Continuous)    │ Near-zero staleness. High operational complexity. │
└──────────────────┴──────────────────────────────────────────────────┘
```

---

## 4. Implementation Patterns

### 4.1 Database-Native Materialized Views

Most relational databases support materialized views natively.

**PostgreSQL:**
```sql
-- Create a materialized view of monthly sales per product
CREATE MATERIALIZED VIEW monthly_sales_summary AS
SELECT
    p.product_id,
    p.name          AS product_name,
    p.category,
    DATE_TRUNC('month', o.created_at) AS month,
    COUNT(oi.id)    AS total_units_sold,
    SUM(oi.quantity * oi.unit_price) AS total_revenue
FROM order_items oi
JOIN orders o      ON oi.order_id = o.id
JOIN products p    ON oi.product_id = p.id
WHERE o.status = 'completed'
GROUP BY p.product_id, p.name, p.category, DATE_TRUNC('month', o.created_at);

-- Index on the view for fast access
CREATE UNIQUE INDEX ON monthly_sales_summary (product_id, month);

-- Refresh the view (full refresh)
REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_sales_summary;
```

**Oracle:**
```sql
-- Incremental (fast) refresh using materialized view logs
CREATE MATERIALIZED VIEW LOG ON orders WITH ROWID, SEQUENCE (status, created_at) INCLUDING NEW VALUES;
CREATE MATERIALIZED VIEW LOG ON order_items WITH ROWID, SEQUENCE (order_id, quantity, unit_price) INCLUDING NEW VALUES;

CREATE MATERIALIZED VIEW order_summary
BUILD IMMEDIATE
REFRESH FAST ON COMMIT
AS
SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS lifetime_value
FROM orders o JOIN order_items oi ON o.id = oi.order_id
GROUP BY o.customer_id;
```

### 4.2 Application-Level Materialized View (NoSQL)

When the database doesn't support native views, build them in the application layer.

```python
# Example: Pre-computing user profile views in Redis/DynamoDB
# Source of truth: multiple microservices (user-service, order-service, review-service)

import json
import redis
from dataclasses import dataclass, asdict

r = redis.Redis()

@dataclass
class UserProfileView:
    user_id: str
    name: str
    email: str
    total_orders: int
    total_spent: float
    avg_review_score: float
    last_active: str

def rebuild_user_profile_view(user_id: str):
    """Called on relevant domain events or on a schedule."""
    user    = user_service.get_user(user_id)
    orders  = order_service.get_orders(user_id)
    reviews = review_service.get_reviews_by_user(user_id)

    view = UserProfileView(
        user_id         = user_id,
        name            = user["name"],
        email           = user["email"],
        total_orders    = len(orders),
        total_spent     = sum(o["total"] for o in orders),
        avg_review_score= sum(r["score"] for r in reviews) / len(reviews) if reviews else 0,
        last_active     = user["last_active"]
    )

    # Store in Redis with TTL as safety net
    r.setex(f"user_profile_view:{user_id}", 3600, json.dumps(asdict(view)))
    return view

def get_user_profile(user_id: str) -> UserProfileView:
    cached = r.get(f"user_profile_view:{user_id}")
    if cached:
        return UserProfileView(**json.loads(cached))
    return rebuild_user_profile_view(user_id)
```

### 4.3 Stream-Powered Materialized View (Kafka + Flink)

```
┌────────────────────────────────────────────────────────────────────────┐
│                  STREAMING MATERIALIZED VIEW PIPELINE                  │
│                                                                        │
│  orders topic ──┐                                                      │
│                 ├──► Flink Job ──► Aggregation State ──► View Store    │
│  products topic─┘   (join +                             (Redis/Cassandra│
│                      aggregate)                          /DynamoDB)    │
│                                                                        │
│  Latency: seconds    Freshness: near real-time                         │
└────────────────────────────────────────────────────────────────────────┘
```

```java
// Apache Flink: Streaming materialized view for real-time order analytics
StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();

DataStream<Order>   orders   = env.addSource(new FlinkKafkaConsumer<>("orders", ...));
DataStream<Product> products = env.addSource(new FlinkKafkaConsumer<>("products", ...));

// Join streams and aggregate
DataStream<OrderSummary> view = orders
    .keyBy(Order::getProductId)
    .connect(products.keyBy(Product::getId))
    .process(new OrderProductJoinFunction())
    .keyBy(OrderSummary::getCategoryId)
    .window(TumblingEventTimeWindows.of(Time.minutes(5)))
    .aggregate(new RevenueAggregator());

// Sink to Redis or Cassandra (the materialized view store)
view.addSink(new RedisMaterializedViewSink());
```

### 4.4 CQRS + Materialized View

Materialized Views are the natural read model in a CQRS architecture.

```
┌─────────────────────────────────────────────────────────────────────┐
│                       CQRS + MATERIALIZED VIEW                      │
│                                                                     │
│  Commands (Writes)                Queries (Reads)                   │
│  ─────────────────                ──────────────                    │
│  POST /orders                     GET /dashboard/sales              │
│       │                                    │                        │
│       ▼                                    ▼                        │
│  Command Handler                   Query Handler                    │
│       │                                    │                        │
│       ▼                                    ▼                        │
│  Write Store              ┌──── Materialized View Store ────┐       │
│  (normalized DB)          │  sales_by_region_view           │       │
│       │                   │  top_products_view              │       │
│       │ domain events     │  customer_lifetime_value_view   │       │
│       └──────────────────►└─────────────────────────────────┘       │
│                  (event bus rebuilds views asynchronously)           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Data Staleness & Consistency

### 5.1 Staleness Window

```
Timeline:
─────────────────────────────────────────────────────────►
  T=0          T=5min         T=10min        T=15min
  │            │              │              │
  Write        Refresh        Write          Refresh
  (new data)   (view updated) (new data)     (view updated)
               │              │              │
               └── STALE ─────┘              │
                  (5 min window where view    │
                   does NOT reflect write)   │
```

**Mitigation Strategies:**
- Use incremental/streaming refresh to reduce the window.
- Serve the materialized view for most reads, but allow a **read-through** fallback to the source for latency-sensitive, consistency-critical queries.
- Version your views with a `last_refreshed_at` timestamp and expose it to consumers.

### 5.2 Consistency Models

| Model | Description | When to Use |
|---|---|---|
| **Eventual** | View will converge to source data, but lag exists | Dashboards, reporting, analytics |
| **Read-your-writes** | After a write, user reads from source; others from view | Profile updates, user settings |
| **Bounded Staleness** | View is never more than N seconds stale (enforced by refresh SLA) | Inventory counts, pricing |
| **Strong** | View always matches source (synchronous refresh on commit) | Financial balances — but rarely practical at scale |

---

## 6. Trade-offs

### 6.1 Benefits

| Benefit | Description |
|---|---|
| **Read Performance** | Eliminates expensive JOINs, aggregations at query time; reads become O(1) key lookups |
| **Query Simplification** | Complex multi-table queries become simple SELECT on a flat view |
| **Cross-Store Aggregation** | Can join data from heterogeneous stores (SQL + NoSQL + Kafka) into one view |
| **OLAP Isolation** | Prevents analytical workloads from degrading OLTP performance |
| **Schema Flexibility** | View can expose a different shape than the normalized source schema |
| **Resilience** | Reads continue if source DB is temporarily unavailable (reads from view) |

### 6.2 Drawbacks

| Drawback | Description |
|---|---|
| **Data Staleness** | View is not always current; not suitable for use cases requiring strong consistency |
| **Storage Overhead** | Data is duplicated; multiple views can multiply storage significantly |
| **Refresh Complexity** | Keeping views accurate during schema migrations, deletes, or backfills is hard |
| **Write Amplification** | Every write to source triggers view refresh work; can be expensive at scale |
| **Operational Burden** | Requires monitoring view freshness, handling refresh failures, managing view lifecycle |
| **Consistency Drift** | Bugs in refresh logic can cause views to diverge silently from source truth |

### 6.3 When to Use vs. Avoid

```
USE Materialized Views when:
  ✅ Queries are read-heavy and computationally expensive
  ✅ Data freshness requirements tolerate seconds-to-minutes of lag
  ✅ Data is aggregated from multiple sources or services
  ✅ Reporting and analytics are primary use cases
  ✅ You need to isolate read workloads from write workloads
  ✅ You are implementing CQRS

AVOID Materialized Views when:
  ❌ Strong consistency is required (financial transactions, inventory exactness)
  ❌ Source data changes at an extremely high velocity (thrashing refresh)
  ❌ The view query is simple enough to execute cheaply in real-time
  ❌ Storage cost is a hard constraint
  ❌ Data has complex cascading deletes (hard to propagate to view correctly)
```

---

## 7. Key Design Decisions

### 7.1 Decision Flowchart

```
Is the query expensive (JOINs, aggregations)?
        │
        ├── No ──► Use standard query, no materialized view needed
        │
        └── Yes
              │
              ▼
        Is freshness critical (< 1 second)?
              │
              ├── Yes ──► Use caching (Redis) or synchronous view refresh
              │            (or reconsider the data model)
              │
              └── No
                    │
                    ▼
              Is the data from multiple stores/services?
                    │
                    ├── Yes ──► Application-level or stream-powered view
                    │
                    └── No
                          │
                          ▼
                    Use database-native materialized view
                    Choose refresh strategy based on acceptable lag
```

### 7.2 Granularity Decision

| Granularity | Approach | Trade-off |
|---|---|---|
| **Fine-grained** (per entity) | One view entry per user/product | High storage, cheap per-entity reads |
| **Coarse-grained** (aggregated) | One row per time bucket or category | Low storage, cheap analytical queries |
| **Mixed** | Entity-level view + periodic rollup view | Best of both, most operational complexity |

---

## 8. Real-World Systems & Applications

### 8.1 Netflix — Content Recommendation Views

Netflix pre-computes personalized content rows (row-level materialized views) per user.

```
Source Data:
  - viewing_history (user × content)
  - content_metadata (genre, cast, tags)
  - user_preferences (explicit ratings)
  - A/B test assignments

Materialized View (per user):
  {
    user_id: "u123",
    rows: [
      { row_title: "Because you watched Stranger Things", content_ids: [...] },
      { row_title: "Top Picks for You",                  content_ids: [...] },
      { row_title: "Trending Now",                       content_ids: [...] }
    ],
    generated_at: "2024-01-15T02:00:00Z"  // batch refresh nightly
  }

Storage: Cassandra (keyed by user_id for O(1) homepage load)
Refresh: Offline batch jobs (Spark) → push to Cassandra
```

### 8.2 Uber — Driver/Rider Supply-Demand Dashboard

```
Source Data:
  - real-time GPS pings (drivers) — Kafka stream
  - trip requests (riders) — Kafka stream
  - geo-cell mappings

Materialized View:
  supply_demand_view (keyed by geo_cell_id, refreshed every 30s):
  {
    cell_id: "h3:8a2a107220fffff",
    available_drivers: 12,
    pending_requests: 4,
    surge_multiplier: 1.8,
    avg_eta_seconds: 240,
    refreshed_at: "..."
  }

Used for: surge pricing engine, driver dispatch, rider ETA estimates
Refresh: Flink streaming aggregation → Redis
```

### 8.3 Shopify — Merchant Analytics Dashboard

```
Source Data:
  - orders table (billions of rows across all merchants)
  - line_items table
  - products table

Materialized Views (per merchant, per time window):
  - daily_revenue_view
  - top_selling_products_view
  - customer_cohort_view

Without MV: Complex GROUP BY + JOIN across billions of rows per merchant query
With MV: Each merchant's dashboard loads from pre-aggregated rows

Refresh Strategy: Incremental refresh triggered by order events via Kafka
Storage: MySQL + Vitess (per merchant sharding)
```

### 8.4 GitHub — Repository Statistics

```
Source Data:
  - commits, pull_requests, issues, stars (high write volume)

Materialized View:
  repo_stats_view {
    repo_id,
    star_count,
    fork_count,
    open_issues_count,
    commit_count_30d,
    contributor_count,
    language_breakdown: { "Python": 62%, "JS": 38% },
    last_commit_at
  }

Used for: Repository homepage, search ranking, trending page
Refresh: Event-driven (star/fork/commit events) + periodic consistency sweeps
Storage: MySQL read replicas + Redis cache layer on top
```

### 8.5 Stripe — Financial Reporting Views

```
Source Data:
  - payment_intents, charges, refunds, transfers (normalized, write-optimized)

Materialized Views:
  - merchant_balance_view (near-real-time, bounded staleness < 10s)
  - monthly_payout_summary_view (batch, refreshed at payout time)
  - dispute_dashboard_view (scheduled hourly refresh)

Key constraint: Financial views require bounded staleness guarantees.
Stripe uses event sourcing — each financial event is immutable and appended,
and views are rebuilt by replaying the event log.
```

### 8.6 Elasticsearch as a Materialized View Store

Many systems use Elasticsearch as the materialized view layer for full-text + aggregation queries:

```
Source: PostgreSQL (normalized, OLTP)
        │
        │ CDC via Debezium
        ▼
      Kafka
        │
        │ Kafka Connect Elasticsearch Sink
        ▼
  Elasticsearch Index
  (denormalized documents, pre-joined, full-text indexed)
        │
        ▼
  API / Dashboard reads (fast full-text search + aggregations)
```

Used by: LinkedIn (people search), Airbnb (listing search), eBay (product catalog search).

---

## 9. Comparison: Materialized View vs. Related Patterns

| Pattern | Similarity | Key Difference |
|---|---|---|
| **Cache** | Both store precomputed results | Cache is ephemeral, evictable, unversioned. MV is durable, managed, and queryable. |
| **Read Replica** | Both serve read traffic | Read replica mirrors entire DB. MV stores a specific, transformed projection. |
| **CQRS Read Model** | Both optimize for reads | CQRS is an architecture. MV is a concrete mechanism used as the CQRS read model. |
| **Data Warehouse** | Both pre-aggregate data | DW is a separate analytical system (ETL, historical). MV lives closer to operational data. |
| **Index** | Both speed up lookups | Index is on a single table/field. MV can span multiple tables/stores with custom logic. |
| **Denormalization** | Both trade storage for speed | Denormalization is a schema choice. MV is a maintained duplicate layer on top of normalized data. |

---

## 10. Anti-Patterns

| Anti-Pattern | Description | Fix |
|---|---|---|
| **Stale View Blindness** | App reads from view without knowing staleness level; serves outdated financial data | Always expose `last_refreshed_at`; route consistency-sensitive reads to source |
| **Over-Materialization** | Creating a new materialized view for every possible query permutation | Design views around access patterns, not queries; use query-time aggregation for low-frequency queries |
| **Synchronous Refresh on Write** | Refreshing the view inline with every write (defeats the purpose) | Decouple refresh via events/queues; accept eventual consistency |
| **Silent Drift** | View diverges from source due to refresh failures, with no alert | Monitor `view_lag_seconds` and `refresh_error_rate`; alert on drift threshold |
| **Missing Delete Propagation** | Source records are deleted, but the view retains orphan rows | Implement hard-delete events in CDC pipeline; periodically run reconciliation jobs |
| **Schema Change Fragility** | Source schema change breaks view refresh job silently | Version view queries; test view rebuild on schema migrations; use schema registry |

---

## 11. Observability & Operations

### Key Metrics to Monitor

```
┌──────────────────────────────────────────────────────────┐
│              MATERIALIZED VIEW HEALTH METRICS            │
├────────────────────────────┬─────────────────────────────┤
│ view_lag_seconds           │ How stale is the view now?  │
│ last_refresh_timestamp     │ When was it last refreshed? │
│ refresh_duration_ms        │ How long does refresh take? │
│ refresh_error_rate         │ % of refresh jobs failing   │
│ view_row_count             │ Detect unexpected truncation│
│ read_latency_p99           │ Is the view serving fast?   │
│ source_write_throughput    │ Are writes outpacing refresh│
└────────────────────────────┴─────────────────────────────┘
```

### Refresh Job Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    ROBUST REFRESH JOB DESIGN                     │
│                                                                  │
│  1. Idempotent: Re-running a refresh produces the same result    │
│  2. Atomic: Full refresh swaps old → new atomically              │
│             (rename temp_view → live_view)                       │
│  3. Observable: Emits metrics + logs at each stage               │
│  4. Backpressure-aware: Pauses if source DB is under load        │
│  5. Reconciliation: Periodic full-refresh to fix drift           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 12. Interview Cheat Sheet

```
┌───────────────────────────────────────────────────────────────────┐
│                MATERIALIZED VIEW — QUICK REFERENCE                │
├───────────────────────────────────────────────────────────────────┤
│ Pattern Type    │ Data Management / Read Optimization             │
│ Core Idea       │ Precompute and persist expensive query results  │
│ Key Benefit     │ O(1) reads instead of O(n log n) query time     │
│ Key Cost        │ Storage duplication + refresh complexity        │
│ Consistency     │ Eventual (by default); bounded staleness if SLA │
│ Refresh Types   │ Full, Incremental, On-Demand, Scheduled, Stream │
│ Storage Targets │ RDBMS (native), Redis, Cassandra, Elasticsearch │
│ Best Fit        │ Dashboards, analytics, CQRS read models,        │
│                 │ cross-service aggregations                      │
│ Avoid When      │ Strong consistency required; simple queries     │
│ Related         │ CQRS, Event Sourcing, Cache-Aside, Read Replica │
│ Real Examples   │ Netflix (recs), Uber (supply/demand), GitHub    │
│                 │ (repo stats), Shopify (merchant analytics)      │
└───────────────────────────────────────────────────────────────────┘

Key talking points in interviews:
  → "I'd use a materialized view here to pre-aggregate the data and
     serve dashboard reads in O(1) instead of joining across 3 tables
     on every request."
  → "The trade-off is staleness — I'd set a refresh interval based
     on the acceptable lag for this use case."
  → "In a CQRS architecture, the materialized view IS the read model."
  → "For freshness guarantees, I'd use CDC + streaming (Kafka/Flink)
     instead of batch refresh."
```