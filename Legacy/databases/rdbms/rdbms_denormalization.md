# RDBMS: Denormalization

---

## 1. What is Denormalization?

Denormalization is the deliberate introduction of **redundancy** into a relational database by merging tables, duplicating columns, or pre-computing aggregates — trading write overhead and storage for **faster reads**.

It is the *intentional reversal* of normalization, applied strategically after normalization has been done correctly first.

> **Core Principle:** Move complexity from query time to write time.

---

## 2. When to Consider Denormalization

| Signal | Explanation |
|---|---|
| Read-heavy workload (>80% reads) | Joins are expensive at scale; redundancy pays off |
| Slow queries with many JOINs | Flattening eliminates join overhead |
| Hot aggregation queries | Pre-computing sums/counts avoids repeated scans |
| Horizontal scaling required | Joins across shards are extremely costly |
| Reporting / Analytics workloads | Wide, flat tables suit OLAP access patterns |
| Latency SLAs are tight | Denormalized reads are predictable and fast |

**Do NOT denormalize when:**
- Data changes frequently (high write load invalidates caches and duplicates)
- Data consistency is paramount (financial ledgers, medical records)
- The schema is still evolving
- Query performance problems can be solved with indexes or caching first

---

## 3. Normalization Recap (Starting Point)

Before denormalizing, understand what you're undoing:

| Normal Form | Rule |
|---|---|
| 1NF | Atomic values; no repeating groups |
| 2NF | No partial dependencies on composite keys |
| 3NF | No transitive dependencies |
| BCNF | Every determinant is a candidate key |

Most production OLTP schemas target **3NF** as the normalized baseline.

---

## 4. Denormalization Techniques

### 4.1 Table Merging (Collapsing Joins)

Merge frequently joined tables into a single wide table.

**Normalized:**
```sql
-- users(id, name, email)
-- user_profiles(user_id, bio, avatar_url, location)

SELECT u.name, p.bio, p.location
FROM users u JOIN user_profiles p ON u.id = p.user_id;
```

**Denormalized:**
```sql
-- users(id, name, email, bio, avatar_url, location)

SELECT name, bio, location FROM users;
```

**Use when:** The joined tables always appear together and the extra columns are not huge.

---

### 4.2 Duplicating Columns (Redundant Attributes)

Copy a frequently needed column into a child table to avoid a join.

**Normalized:**
```sql
-- orders(id, user_id, total)
-- users(id, name, email)

SELECT o.id, u.name FROM orders o JOIN users u ON o.user_id = u.id;
```

**Denormalized:**
```sql
-- orders(id, user_id, user_name, total)  -- user_name duplicated

SELECT id, user_name FROM orders;
```

**Caveat:** If `user.name` changes, `orders.user_name` becomes stale. Only safe for **immutable or rarely-changing** attributes (e.g., username at time of order).

---

### 4.3 Pre-computed Aggregates (Materialized Counts / Sums)

Store derived values that would otherwise require expensive aggregation.

**Expensive query (normalized):**
```sql
SELECT post_id, COUNT(*) AS like_count
FROM likes GROUP BY post_id;
```

**Denormalized:**
```sql
-- posts(id, title, content, like_count)  -- maintained via application logic or triggers

SELECT id, title, like_count FROM posts;
```

**Maintenance strategies:**
- Increment/decrement on every write (application-level)
- Database triggers
- Periodic batch recompute (acceptable staleness)
- Event-driven update via message queue

---

### 4.4 Storing Derived / Computed Columns

Persist values that are expensive to compute on-the-fly.

```sql
-- orders table with a stored total
ALTER TABLE orders ADD COLUMN total_price DECIMAL(10,2)
  GENERATED ALWAYS AS (quantity * unit_price) STORED;
```

Alternatively, application code populates it at write time and never recalculates.

---

### 4.5 Array / JSON Columns (Semi-structured Embedding)

Store related one-to-many data as a JSON array within the parent row, avoiding a separate table entirely.

```sql
-- posts table with embedded tags
CREATE TABLE posts (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  content TEXT,
  tags TEXT[],              -- PostgreSQL array
  metadata JSONB            -- arbitrary nested data
);
```

**Use when:** The nested data is almost always read together with the parent and rarely queried in isolation.

---

### 4.6 Lookup Table Inlining

Instead of joining to a reference/lookup table, embed the value directly.

**Normalized:**
```sql
-- orders(id, status_id) + order_statuses(id, label)
```

**Denormalized:**
```sql
-- orders(id, status)  -- 'pending', 'shipped', 'delivered' stored as string
```

Acceptable when the lookup set is small and stable (enums).

---

## 5. Trade-offs

### 5.1 Benefits

| Benefit | Details |
|---|---|
| **Faster reads** | Eliminates multi-table JOINs; single-table scans are O(n) with better cache locality |
| **Simpler queries** | Application code is cleaner; less SQL complexity |
| **Better sharding compatibility** | Data needed together lives together; no cross-shard joins |
| **Reduced lock contention** | Fewer tables involved per query means fewer row-level locks |
| **Predictable latency** | Avoids query plan variance from join cardinality estimation |

### 5.2 Costs

| Cost | Details |
|---|---|
| **Write amplification** | Every update to duplicated data must be propagated to all copies |
| **Data inconsistency risk** | Stale reads if propagation fails or lags |
| **Increased storage** | Redundant columns and tables consume more disk |
| **Complex writes** | Application must maintain invariants that the DB no longer enforces |
| **Schema rigidity** | Wide, flat tables are harder to evolve |
| **Harder to maintain** | More places to update when requirements change |

### 5.3 Summary Matrix

| Dimension | Normalized | Denormalized |
|---|---|---|
| Read speed | Slower (joins) | Faster (single scan) |
| Write speed | Faster | Slower (propagation) |
| Storage | Efficient | Wasteful |
| Consistency | Strong (enforced by schema) | Eventual / application-managed |
| Query complexity | High | Low |
| Schema flexibility | High | Low |
| Sharding suitability | Poor | Good |

---

## 6. Consistency Maintenance Patterns

When you denormalize, you own the consistency problem. Common approaches:

### Synchronous Update (Application-level)
```python
def add_like(post_id, user_id):
    db.execute("INSERT INTO likes (post_id, user_id) VALUES (?, ?)", post_id, user_id)
    db.execute("UPDATE posts SET like_count = like_count + 1 WHERE id = ?", post_id)
    # Risk: if second query fails, count is wrong
```

### Database Triggers
```sql
CREATE TRIGGER after_like_insert
AFTER INSERT ON likes
FOR EACH ROW
  UPDATE posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
```
*Hidden complexity; hard to debug; can cause performance surprises.*

### Event-Driven / Async Update
```
Write → Publish event to Kafka → Consumer updates denormalized column
```
Accepts **eventual consistency** in exchange for decoupling.

### Batch Reconciliation
Periodic job recomputes aggregates from source of truth. Acceptable for analytics, not for real-time counts shown to users.

---

## 7. Denormalization vs. Related Concepts

| Concept | Relationship to Denormalization |
|---|---|
| **Caching (Redis)** | Preferred first step; denormalization is a persistent form of caching |
| **Materialized Views** | Database-managed denormalization; auto-refreshed on schedule or trigger |
| **CQRS** | Read models are often denormalized projections of write models |
| **Data Warehouses** | Star/Snowflake schemas are intentionally denormalized for OLAP |
| **NoSQL** | Denormalization is the *default* design pattern (embed vs. reference) |

---

## 8. Materialized Views — Managed Denormalization

A materialized view is the database's built-in mechanism for denormalization with automatic refresh.

```sql
-- PostgreSQL materialized view
CREATE MATERIALIZED VIEW post_stats AS
SELECT
  p.id,
  p.title,
  COUNT(l.id) AS like_count,
  COUNT(c.id) AS comment_count
FROM posts p
LEFT JOIN likes l ON l.post_id = p.id
LEFT JOIN comments c ON c.post_id = p.id
GROUP BY p.id, p.title;

-- Refresh (can be scheduled or triggered)
REFRESH MATERIALIZED VIEW CONCURRENTLY post_stats;
```

**Pros:** DB manages the denormalized copy; source of truth remains normalized.  
**Cons:** Refresh lag; not real-time without triggers; refresh locks (mitigated by `CONCURRENTLY`).

---

## 9. Real-World Systems & Applications

### 9.1 Twitter / X — Like & Retweet Counts
- Stores `like_count` and `retweet_count` directly on the tweet row rather than counting in real time.
- Counter incremented asynchronously via an internal timeline fanout service.
- Occasional reconciliation jobs correct drift.
- **Why:** Tweets are read orders of magnitude more than they are liked; join-free reads are essential at 500M tweets/day scale.

### 9.2 Instagram — Feed Denormalization
- Post metadata (author username, avatar URL) is duplicated onto feed items.
- Avoids a user-table lookup for every post rendered in a feed.
- Accepts eventual consistency: profile updates propagate asynchronously.

### 9.3 Amazon — Order History
- Order records embed a snapshot of product name, price, and seller at time of purchase.
- Even if the product is updated or deleted, the order record remains accurate.
- Classic use of **point-in-time denormalization** for immutable history.

### 9.4 Stack Overflow — Post & Answer Counts
- `users.answer_count`, `questions.answer_count` maintained as denormalized counters.
- Avoids counting rows in `answers` table on every page render.
- Open-source codebase makes this explicit; counters updated on insert/delete.

### 9.5 Airbnb — Search Index
- Listing search results embed host name, rating, and price directly in the search index record.
- Avoids joins across hosts, reviews, and calendar tables for the high-frequency search path.
- A separate pipeline keeps the index synchronized with source tables.

### 9.6 Uber — Driver Location & Trip Data
- Trip records embed origin/destination city names, driver name, and vehicle info rather than normalizing across multiple tables.
- Enables fast historical trip lookup without costly joins at query time.

### 9.7 Facebook — Social Graph Edge Counts
- Friend counts, follower counts stored as counters on user profiles.
- Underlying graph stored separately; counts are a denormalized projection.
- TAO (Facebook's caching layer) further caches these counts in memory.

---

## 10. Decision Framework

```
Is the query slow due to joins?
    └─ YES → Can indexes or query optimization fix it?
                 └─ YES → Use indexes first (cheaper)
                 └─ NO  → Is the workload read-heavy?
                              └─ YES → Is data relatively stable (infrequent writes)?
                                           └─ YES → DENORMALIZE
                                           └─ NO  → Use caching (Redis) or Materialized Views
                              └─ NO  → Keep normalized; optimize writes
```

**Rule of thumb:**
1. **Normalize first** — always start with 3NF.
2. **Measure before optimizing** — profile actual slow queries.
3. **Cache before denormalizing** — Redis/Memcached is simpler and reversible.
4. **Denormalize specific access paths** — not the entire schema.
5. **Document every denormalization decision** — future maintainers need to know what invariants are being managed manually.

---

## 11. Monitoring & Operational Concerns

| Metric | Why it Matters |
|---|---|
| **Replication lag** (for async updates) | Indicates staleness of denormalized data |
| **Counter drift** | Periodic reconciliation queries to catch inconsistency |
| **Write latency on hot rows** | Wide rows with frequent updates can become contention bottlenecks |
| **Storage growth rate** | Redundant data compounds with data volume |
| **Cache hit rate** (if using Redis alongside) | May indicate denormalization is redundant |

---

## 12. Quick Reference Summary

| Technique | Best For | Risk |
|---|---|---|
| Table merging | Always-joined tables | Wide rows, harder migration |
| Column duplication | Stable attributes needed across tables | Stale data on source update |
| Pre-computed aggregates | Counts, sums, averages | Counter drift on write failures |
| JSON/Array embedding | One-to-few relationships | Loss of relational query power |
| Lookup inlining | Small, stable enums | Inconsistency if values change |
| Materialized views | Complex aggregations | Refresh lag, not real-time |

> **Default stance:** Reach for denormalization *after* indexes, caching, and query optimization have been exhausted. When you do denormalize, do so on specific, high-traffic read paths — not the entire schema.