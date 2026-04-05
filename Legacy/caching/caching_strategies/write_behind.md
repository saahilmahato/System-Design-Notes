# Caching: Write-Behind (Write-Back)

---

## 1. What Is Write-Behind?

Write-Behind (also called **Write-Back**) is a caching strategy where writes go to the **cache first**, and the cache asynchronously flushes those writes to the **backing database** later — in the background, on a schedule, or when the cache entry is evicted.

This is the **opposite of Write-Through**, where every write synchronously updates both cache and DB.

```
          Write Request
               │
               ▼
         ┌──────────┐
         │  Cache   │◄──── Write acknowledged immediately to client
         └────┬─────┘
              │  (async, delayed)
              ▼
         ┌──────────┐
         │ Database │
         └──────────┘
```

---

## 2. How It Works

1. **Write arrives** → written to cache only.
2. **Client receives ACK immediately** — no waiting on the DB.
3. **Cache marks the entry "dirty"** (modified but not yet persisted).
4. **Background process** (flush timer, batch job, eviction hook) syncs dirty entries to the DB.
5. **Reads** still hit the cache first (usually combined with Read-Through or Cache-Aside).

### Flush Triggers

| Trigger | Description |
|---|---|
| **Time-based** | Flush all dirty entries every N seconds |
| **Size-based** | Flush when dirty buffer exceeds threshold |
| **Eviction-based** | Flush on cache eviction (LRU/LFU policies) |
| **Explicit** | Application-triggered flush call |

---

## 3. Trade-offs

### Pros

| Benefit | Explanation |
|---|---|
| **Low write latency** | Writes return instantly — client doesn't wait on DB I/O |
| **Write coalescing** | Multiple updates to the same key can be batched into a single DB write |
| **DB offloading** | Reduces write pressure on the database significantly |
| **Throughput boost** | Enables much higher write throughput for bursty workloads |
| **Buffer for spikes** | Cache absorbs sudden write spikes before they hit the DB |

### Cons

| Risk | Explanation |
|---|---|
| **Data loss on cache crash** | Dirty entries not yet flushed are lost if cache node dies |
| **Operational complexity** | Must handle flush failures, retries, and ordering |
| **Stale DB reads** | Direct DB queries (bypassing cache) may see stale data |
| **Consistency window** | Period between write and flush creates an inconsistency gap |
| **Ordering complexity** | Writes to related keys must flush in correct order to avoid corruption |
| **Failure handling** | If flush fails, requires dead-letter queues, alerts, and replay |

### Write-Behind vs. Write-Through vs. Write-Around

| Strategy | Write Path | Read Path | Latency | Durability | Use Case |
|---|---|---|---|---|---|
| **Write-Behind** | Cache only → async DB | Cache first | Lowest | Lowest (risk of loss) | High-write, tolerate eventual consistency |
| **Write-Through** | Cache + DB sync | Cache first | Medium | High | Read-heavy, must be durable |
| **Write-Around** | DB only (skip cache) | Cache miss → DB → cache | Highest | High | Write-once / infrequent re-read data |

---

## 4. Durability Strategies

Because write-behind carries data loss risk, these techniques mitigate it:

### 4.1 Write-Ahead Log (WAL) in Cache
Cache records every incoming write to a persistent log before acknowledging. On crash + restart, replays the WAL to recover dirty entries.

### 4.2 Replication
Dirty entries are replicated across multiple cache nodes. A single node crash doesn't lose data if at least one replica survives.

```
Write ──► Primary Cache ──► Replica Cache
                │
                └──► Async flush to DB
```

### 4.3 Hybrid: Write-Behind + Kafka
Writes go to both the cache and a durable message queue (Kafka). The queue acts as the reliable buffer. Even if the cache dies, the queue guarantees eventual DB writes.

```
Write ──► Cache (fast ACK)
       └──► Kafka (durable log) ──► Consumer ──► DB
```

---

## 5. Implementation Patterns

### 5.1 Dirty Bit Tracking

```
Cache Entry:
┌─────────────────────────────────────────┐
│ Key   | Value  | Dirty | Last-Written   │
│ u:101 | {...}  │  true │ 1704067200000  │
└─────────────────────────────────────────┘
```

A background sweep thread periodically selects all dirty=true entries, batches them, and writes to DB, then clears the dirty bit.

### 5.2 Batch Flush with Upsert

```python
# Pseudo-code: background flush worker
def flush_dirty_entries():
    dirty_keys = cache.scan(filter=lambda e: e.dirty == True)
    batch = [cache.get(k) for k in dirty_keys]
    db.batch_upsert(batch)          # single DB round-trip
    cache.clear_dirty(dirty_keys)
```

### 5.3 Coalescing Writes

```
t=0  → write user:101 { score: 10 }   → dirty
t=1  → write user:101 { score: 15 }   → dirty (overwrites previous)
t=2  → write user:101 { score: 20 }   → dirty
t=5  → flush fires  → DB gets { score: 20 } only
```
Only the latest value is flushed — 3 writes became 1 DB write. This is the most powerful performance benefit.

---

## 6. Real-World Systems & Applications

### 6.1 Gaming Leaderboards — Riot Games / Steam

Player scores update constantly during active gameplay. Writing every score increment synchronously to a DB would be untenable.

**Pattern**: Score updates hit Redis (write-behind). Redis flushes aggregated scores to PostgreSQL every few seconds. A player's rank may lag by a few seconds — fully acceptable.

### 6.2 Session & Event Counters — Twitter / Meta

Page view counts, like counts, impression tracking — these are extremely high-write with low durability requirements.

**Pattern**: Counters live in Redis with write-behind flushing to Cassandra or MySQL. Losing a few counts on cache crash is tolerable; sub-millisecond counter increments are not negotiable.

### 6.3 Shopping Carts — Amazon

Cart updates are frequent and latency-sensitive. Persisting every item add/remove synchronously is expensive.

**Pattern**: Write-behind caches the cart state. The DB is eventually consistent with the cache. At checkout (a critical path), an explicit flush is triggered before the transaction.

### 6.4 IoT / Sensor Data Ingestion — Industrial / Smart Devices

Sensors emit data at very high frequency. Directly writing each data point to a time-series DB is cost-prohibitive.

**Pattern**: Edge cache buffers sensor readings (write-behind). Flush aggregated or sampled data to InfluxDB / TimescaleDB every minute. Individual readings may be lost; aggregate trends are preserved.

### 6.5 User Activity / Analytics — Amplitude / Mixpanel

User events (clicks, hovers, page views) are generated at enormous scale.

**Pattern**: Events written to in-memory cache/buffer. Kafka acts as the durable write-behind log. Consumers flush to columnar stores (Redshift, BigQuery) in micro-batches.

### 6.6 DNS TTL Caching

DNS resolvers cache record updates and flush to authoritative nameservers after TTL expiry. A canonical real-world example of accepted staleness windows.

---

## 7. When to Use Write-Behind

### Use It When:

- Write latency is a primary concern and must be sub-millisecond.
- Losing a small amount of recent data is acceptable (e.g., counters, scores, analytics).
- Write throughput is very high and DB cannot keep up (write coalescing is critical).
- The same key is written many times in a short window (hot keys — coalescing saves massive DB load).
- The workload is write-heavy but read patterns are cache-friendly.

### Avoid It When:

- Data must be immediately durable (financial transactions, order placement, inventory deduction).
- Regulators require audit trails or point-in-time consistency.
- Writes are infrequent and DB latency is acceptable.
- The system cannot afford the operational overhead of flush failure handling.

---

## 8. Decision Framework

```
Is write latency a hard requirement?
├── No  → Consider Write-Through or Write-Around
└── Yes
     │
     Is losing recent data acceptable?
     ├── No  → Use Write-Through or Write-Behind + WAL/Kafka hybrid
     └── Yes
          │
          Are the same keys written frequently?
          ├── Yes → Write-Behind with coalescing (high value)
          └── No  → Write-Behind still valid; evaluate complexity overhead
```

---

## 9. Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **No flush failure handling** | Dirty entries silently dropped on flush error | Retry queue + dead-letter alerting |
| **Unbounded dirty buffer** | Memory exhaustion under sustained write load | Cap dirty buffer size; apply backpressure |
| **Ignoring write ordering** | Dependent writes flushed out of order, corrupt state | Use per-key sequence numbers or event ordering |
| **Bypassing cache for reads** | App reads directly from DB, gets stale data | Enforce all reads go through cache layer |
| **Single cache node, no replication** | One crash = total dirty data loss | Use Redis Sentinel / Cluster with replication |
| **Flush on every eviction** | Eviction-triggered flushes overwhelm DB during memory pressure | Rate-limit flush throughput |

---

## 10. Monitoring & Observability

| Metric | Why It Matters |
|---|---|
| **Dirty entry count** | Growing indefinitely → flush is failing or too slow |
| **Flush lag (p99)** | How far behind is the cache vs. DB |
| **Flush error rate** | Critical: indicates data at risk of loss |
| **Write coalescing ratio** | Writes absorbed / DB writes issued — validates the performance gain |
| **Cache eviction rate** | High evictions → dirty entries being forced to flush; check DB write rate |
| **Dirty entry age** | Max age of unwritten dirty entries — tracks SLA for data persistence |

---

## 11. Summary

Write-Behind is the highest-performance write caching strategy and the most operationally complex. It trades **durability for speed** and **simplicity for throughput**. It excels in workloads where writes are frequent, hot keys are common, and some data loss on failure is tolerable. For critical-path writes — payments, inventory, auth — it should be avoided or paired with a durable queue layer.

> **Golden Rule**: Use write-behind where you'd be comfortable losing the last N seconds of writes. If that sentence makes you nervous, add Kafka.