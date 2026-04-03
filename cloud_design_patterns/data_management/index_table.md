# Cloud Design Patterns — Data Management: Index Table

---

## 1. Overview

The **Index Table pattern** involves creating and maintaining separate index tables that allow efficient querying on fields that are not the primary key of the data store. It is the cloud-native equivalent of a database secondary index — explicitly managed at the application layer when the underlying store doesn't support secondary indexing natively (e.g., many NoSQL/key-value stores).

- **Category:** Data Management
- **Also known as:** Secondary Index Pattern, Materialized Index
- **Problem it solves:** Data stores optimized for primary key lookups become inefficient when queries need to filter or sort by non-primary attributes, causing full table scans.

---

## 2. Problem Statement

Most cloud-scale data stores (DynamoDB, Azure Table Storage, Cosmos DB, Cassandra) are designed around a single **partition key** or **primary key**. Queries on any other field require a full scan, which is:

- **O(n)** in cost and time
- Expensive at scale (millions of rows)
- Incompatible with SLA requirements (p99 latency targets)

**Example:** A `Customer` table keyed on `CustomerID`. A query like "find all customers in region `US-WEST` who signed up this month" becomes a full scan unless a separate index exists.

---

## 3. Solution

Create and maintain one or more **index tables** — separate tables whose keys are composed of the query attributes, and whose values reference the primary key(s) of the original entity.

```
Primary Table: Orders
─────────────────────────────────────────────────────────
PK: OrderID | CustomerID | Status | Region | CreatedAt
─────────────────────────────────────────────────────────
ORD-001     | C-123       | SHIPPED | US-WEST | 2024-01-10
ORD-002     | C-456       | PENDING | EU-EAST | 2024-01-11
ORD-003     | C-123       | PENDING | US-WEST | 2024-01-12

Index Table: Orders_by_CustomerID
──────────────────────────────────────
PK: CustomerID | SK: OrderID
──────────────────────────────────────
C-123         | ORD-001
C-123         | ORD-003
C-456         | ORD-002

Index Table: Orders_by_Status_Region
──────────────────────────────────────────────────
PK: Status#Region | SK: CreatedAt | OrderID
──────────────────────────────────────────────────
PENDING#US-WEST   | 2024-01-12   | ORD-003
SHIPPED#US-WEST   | 2024-01-10   | ORD-001
PENDING#EU-EAST   | 2024-01-11   | ORD-002
```

---

## 4. Index Table Variants

### 4.1 Denormalized Index (Full Copy)
The index table stores both the key(s) AND a full or partial copy of the entity's attributes.

```
Index Table: Orders_by_Customer (Denormalized)
────────────────────────────────────────────────────────────
PK: CustomerID | SK: OrderID | Status | CreatedAt | Total
────────────────────────────────────────────────────────────
C-123         | ORD-001     | SHIPPED | 2024-01-10 | $120
C-123         | ORD-003     | PENDING | 2024-01-12 | $85
```

- **Pro:** Single read per query — no need to join back to primary table
- **Con:** Data duplication; updates must propagate to all copies (write amplification)

### 4.2 Reference Index (Pointer Only)
The index table stores only enough information to identify and locate the primary record.

```
Index Table: Orders_by_Customer (Reference)
──────────────────────────────────────
PK: CustomerID | SK: OrderID
──────────────────────────────────────
C-123         | ORD-001
C-123         | ORD-003
```

- **Pro:** No data duplication; primary table is the single source of truth
- **Con:** Two-phase reads required — query index, then fetch primary row(s)

### 4.3 Composite Key Index
Keys are composed of multiple attributes to support multi-dimensional queries.

```
PK: Region#Status | SK: CreatedAt
→ Supports: "Give me all PENDING orders in US-WEST, sorted by date"
```

---

## 5. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Write Path                                    │
│                                                                     │
│   Application ──► Primary Table Write                               │
│        │                                                            │
│        └──► Index Maintenance (sync or async)                       │
│                    │                                                │
│              ┌─────▼──────┐  ┌──────────────┐  ┌───────────────┐  │
│              │ Index by   │  │ Index by     │  │ Index by      │  │
│              │ CustomerID │  │ Status+Region│  │ CreatedAt     │  │
│              └────────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        Read Path                                     │
│                                                                     │
│   Query: "All PENDING orders for C-123"                             │
│        │                                                            │
│        ▼                                                            │
│   Lookup Index_by_Customer (PK = C-123)                             │
│        │                                                            │
│        ▼                                                            │
│   Get [ORD-001, ORD-003]  ──► Batch Get from Primary Table         │
│                                  │                                  │
│                                  ▼                                  │
│                             Return full records                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Implementation Details

### 6.1 Synchronous vs. Asynchronous Index Maintenance

| Approach | Consistency | Throughput | Failure Complexity |
|---|---|---|---|
| **Synchronous (same transaction)** | Strong | Lower | Simple rollback |
| **Async (event/stream-driven)** | Eventual | High | Requires idempotency + retry |
| **Change Data Capture (CDC)** | Eventual | High | Decoupled; stream lag |

**Recommendation:** Use synchronous updates for transactional stores (RDBMS). For NoSQL at scale, prefer CDC-based async pipelines (DynamoDB Streams → Lambda → Index table).

### 6.2 DynamoDB — Global Secondary Index (GSI) vs. Manual Index Table

| | DynamoDB GSI | Manual Index Table |
|---|---|---|
| Maintenance | Automatic | Application-managed |
| Consistency | Eventually consistent reads | Controllable |
| Cost | WCU charged on GSI | Separate WCU budget |
| Flexibility | Limited projection types | Full control |
| Latency | Single API call | Multi-step (index + fetch) |

### 6.3 Code Example — Writing with Index Maintenance (DynamoDB SDK)

```python
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
orders_table = dynamodb.Table('Orders')
orders_by_customer_table = dynamodb.Table('Orders_by_Customer')

def create_order(order_id, customer_id, status, region, created_at, total):
    # Write to primary table
    orders_table.put_item(Item={
        'OrderID': order_id,
        'CustomerID': customer_id,
        'Status': status,
        'Region': region,
        'CreatedAt': created_at,
        'Total': total
    })
    
    # Write to index table (denormalized — avoids second read)
    orders_by_customer_table.put_item(Item={
        'CustomerID': customer_id,         # PK
        'OrderID': order_id,               # SK
        'Status': status,
        'CreatedAt': created_at,
        'Total': total
    })

def get_orders_by_customer(customer_id):
    response = orders_by_customer_table.query(
        KeyConditionExpression='CustomerID = :cid',
        ExpressionAttributeValues={':cid': customer_id}
    )
    return response['Items']
```

### 6.4 Code Example — CDC-based Async Index (DynamoDB Streams + Lambda)

```python
def lambda_handler(event, context):
    for record in event['Records']:
        if record['eventName'] in ('INSERT', 'MODIFY'):
            new_image = record['dynamodb']['NewImage']
            
            order_id    = new_image['OrderID']['S']
            customer_id = new_image['CustomerID']['S']
            status      = new_image['Status']['S']
            region      = new_image['Region']['S']
            created_at  = new_image['CreatedAt']['S']
            
            # Update index tables asynchronously
            update_customer_index(customer_id, order_id, status, created_at)
            update_status_region_index(status, region, created_at, order_id)

        elif record['eventName'] == 'REMOVE':
            old_image = record['dynamodb']['OldImage']
            delete_from_indexes(old_image)
```

---

## 7. Trade-offs

### 7.1 Benefits

| Benefit | Impact |
|---|---|
| Query performance | O(1) or O(log n) lookups instead of full scans |
| Read scalability | Index tables can be independently partitioned and scaled |
| Cost reduction | Eliminates expensive full-table scan billing in cloud stores |
| Flexibility | Multiple access patterns supported without changing primary schema |

### 7.2 Drawbacks

| Drawback | Mitigation |
|---|---|
| **Write amplification** | Every write touches N+1 tables (primary + N indexes) |
| **Consistency lag** | Async indexes are eventually consistent; reads may see stale data |
| **Storage overhead** | Denormalized indexes duplicate data significantly |
| **Operational complexity** | Index drift/corruption if update logic fails or is inconsistent |
| **Update cascades** | Updating an indexed field requires updating all related index entries |
| **Schema coupling** | Index structure tightly tied to query patterns; refactoring is costly |

### 7.3 When to Use vs. Avoid

| Use When | Avoid When |
|---|---|
| Data store lacks native secondary indexes | RDBMS with native indexes (let the DB handle it) |
| Multiple non-primary access patterns required | Only 1-2 query patterns exist |
| Read-heavy workloads dominate | Write-heavy workloads (amplification too costly) |
| Query latency SLAs are strict | Strong consistency is required across all reads |
| Data store is immutable or append-only | Entities are frequently updated on indexed fields |

---

## 8. Consistency Considerations

```
Synchronous Index Update:
─────────────────────────────────────────────────
Write Primary ──► Write Index ──► Commit
                                      │
                            Strong consistency ✓
                   Risk: Higher write latency
                         Distributed transactions needed
                         
Asynchronous Index Update (CDC):
─────────────────────────────────────────────────
Write Primary ──► Commit
      │
      └──► Stream Event ──► Consumer ──► Write Index
                                              │
                                   Eventual consistency ⚠
                           Risk: Window of inconsistency
                                 Consumer failures = stale index
                                 Must handle idempotent retries
```

**Critical:** Index tables must be treated as projections/views of the primary data. In failure scenarios, the primary table is always authoritative. Provide a **reconciliation job** to detect and repair index drift.

---

## 9. Index Design Guidelines

1. **Design indexes around query patterns, not data shape** — understand your access patterns before building indexes.
2. **Minimize indexed fields** — each additional indexed attribute adds a write path and storage cost.
3. **Use composite keys for range queries** — `PK: Region | SK: CreatedAt` enables both point and range reads.
4. **Avoid hot partitions** — don't use low-cardinality fields (e.g., boolean `IsActive`) as sole partition keys.
5. **Bound index fan-out** — entities with unbounded relationships (e.g., a user with millions of orders) need pagination, not full index reads.
6. **Version your indexes** — maintain schema versioning to enable safe index migrations without downtime.

---

## 10. Real-World Systems and Applications

### 10.1 Amazon DynamoDB — E-commerce (Amazon)
Amazon's own internal order management systems use DynamoDB with Global Secondary Indexes (GSIs) and Local Secondary Indexes (LSIs) to support multiple access patterns:
- Primary key: `OrderID`
- GSI 1: `CustomerID` → list all orders for a customer
- GSI 2: `SellerID + Status` → seller dashboard queries
- GSI 3: `ShipmentRegion + CreatedAt` → logistics/fulfillment views

### 10.2 Uber — Trip Data
Uber's trip records are primarily keyed by `TripID` but are queried by `DriverID`, `RiderID`, `City`, and `Time`. Uber maintains separate index structures in Cassandra and Docstore to support:
- `DriverID → [TripIDs]` for driver history
- `RiderID → [TripIDs]` for rider history
- `City + Hour → [TripIDs]` for surge pricing analytics

### 10.3 Stripe — Payment Records
Stripe stores transactions in a primary store keyed by `ChargeID` but merchants query by `CustomerID`, `CardID`, and `MetadataKey`. Stripe maintains application-level index tables that map:
- `MerchantID + CustomerID → [ChargeIDs]` for customer charge history
- `MetadataKey + MetadataValue → [ChargeIDs]` for custom filter lookups

### 10.4 Netflix — Content Metadata
Netflix's Cassandra-based metadata store is partitioned by `ContentID`. To support queries like "all titles available in region X by genre Y", Netflix maintains materialized index tables updated asynchronously via CDC pipelines.

### 10.5 GitHub — Code Search
GitHub's code search infrastructure builds inverted index tables from repository content:
- Primary store: file blobs keyed by SHA
- Index tables: `token → [file_path, repo_id, line_number]`
- Enables full-text search without scanning the primary store

### 10.6 Discord — Message History
Discord's Cassandra message store is keyed on `ChannelID + MessageID (ULID)`. To support user-level queries ("all messages from UserX in any channel"), Discord maintains index tables mapping `UserID + ChannelID → [MessageIDs]`, updated asynchronously.

---

## 11. Related Patterns

| Pattern | Relationship |
|---|---|
| **Materialized View** | Broader pattern — Index Table is a specialized materialized view for lookup |
| **CQRS** | Index tables often serve as the "read model" in CQRS architectures |
| **Event Sourcing** | Index tables are rebuilt from event streams; natural pairing |
| **Sharding** | Index tables must respect sharding boundaries; cross-shard index lookups are expensive |
| **Cache-Aside** | Index tables can be cached; invalidation must be coordinated with index updates |

---

## 12. Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Indexing everything** | Explosive write amplification and storage cost | Index only fields with proven, frequent access patterns |
| **Low-cardinality index keys** | Hot partition (e.g., `Status = 'ACTIVE'` for 90% of data) | Add a secondary discriminator to the key (e.g., `Status + ShardID`) |
| **No reconciliation job** | Index drift over time due to partial failures | Scheduled background job to compare primary vs. index |
| **Mutable indexed fields without cascade** | Stale index entries post-update | Always delete old index entry before writing new one on field change |
| **Synchronous indexes on write-heavy paths** | Write latency spikes under load | Switch to async CDC-based updates for high-throughput paths |
| **Unbounded index partitions** | A single partition key maps to millions of entries (hot read/write) | Use time-bucketed or range-bucketed sort keys; paginate reads |

---

## 13. Interview Cheat Sheet

```
Core Concept:
  Create separate lookup tables keyed on non-primary query attributes
  to enable O(1)/O(log n) reads without full-table scans.

When to Use:
  ✓ NoSQL store with limited native secondary index support
  ✓ Multiple distinct access patterns on same entity
  ✓ Read-heavy workload with strict latency SLAs

Key Decision Points:
  Denormalized index  → Faster reads, write amplification, stale data risk
  Reference index     → Smaller footprint, two-phase reads
  Sync maintenance    → Strong consistency, higher write latency
  Async (CDC)         → Higher throughput, eventual consistency

Write Amplification Formula:
  Total writes = 1 (primary) + N (index tables per write)

Consistency Model:
  Sync  → Strong (within transaction)
  Async → Eventual (stream lag + consumer processing time)

Failure Mode to Highlight:
  Index drift — primary updated but index not; requires reconciliation job

Real-World Anchors:
  DynamoDB GSI/LSI (Amazon)
  Cassandra secondary indexes (Uber, Discord, Netflix)
  Stripe metadata indexes
  GitHub inverted search index

Common Pitfall:
  Low-cardinality partition keys → hot partitions at scale
  → Always salt or composite-key low-cardinality fields
```

---